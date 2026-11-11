import { refusalError } from './cindy-channels.js';
import { projectOrderKey } from './dsh-project-order.js';
import { UNFILED_PROJECT_PATH } from './dsh-session-source.js';

/**
 * Project display names, as Cindy's sidebar expects them.
 *
 * The Cindy controllers group sessions by working directory and key each group with
 * `local:<grouped path>` — the same key the project-order channel already speaks. A
 * DSH desktop additionally knows a human title for each registered Workspace (the
 * name the Desktop sidebar shows, e.g. 财务 / 标匠｜平台). Without this channel the
 * controller has no way to learn that title and falls back to the folder's basename,
 * so a Chinese project shows up as `ai-briefs` or a bare UUID.
 *
 * This is a *read* adapter over the native Workspace registry. It never invents an
 * alias: a Workspace without a title, a path that cannot be keyed, and a duplicate
 * key are all skipped rather than guessed. Aliases are display-only; nothing here
 * changes a session, a path, or a workspace.
 *
 * Reference shape (Cindy `readHostProjectAliasesSnapshot`):
 *   { aliases: [{ projectKey, alias }], platform, ownerStamp? }
 * and `local-db:project-aliases:list` answers rows with `updatedAt` as well.
 */

/** Cindy caps an alias at 80 characters before it stores one. */
export const MAX_PROJECT_ALIAS_LENGTH = 80;
/** Same response budget as the project-order snapshot: a sidebar page, not a corpus. */
const MAX_SNAPSHOT_BYTES = 256 * 1024;

const unavailable = () => ({ aliases: [], platform: process.platform });

/**
 * Titles DSH itself shows in another language.
 *
 * The default Workspace is stored as `default-workspace` but the desktop sidebar
 * renders it as 「默认工作区」; the phone should read the same thing the user sees,
 * not the storage key.
 */
const DISPLAY_TITLE_OVERRIDES = new Map([["default-workspace", "默认工作区"]]);

function displayTitle(value) {
  const title = cleanAlias(value);
  return DISPLAY_TITLE_OVERRIDES.get(title) ?? title;
}

function cleanAlias(value) {
  if (typeof value !== 'string') return '';
  // Titles are user text: flatten line breaks/control characters and cap the length
  // the same way the controller does, so the two sides agree on what was shown.
  const flat = value.replace(/[\u0000-\u001f\u007f\u2028\u2029]+/gu, ' ').replace(/\s+/gu, ' ').trim();
  if (flat === '') return '';
  const chars = [...flat];
  return chars.length > MAX_PROJECT_ALIAS_LENGTH ? chars.slice(0, MAX_PROJECT_ALIAS_LENGTH).join('').trimEnd() : flat;
}

/**
 * @param getRegistry - () => ctx.get('workspaceRegistry'), resolved per call.
 * @param getOwner - () => { dataOwnerId, ownerGeneration } | undefined.
 * @param maxWorkspaces - registry size guard, matching the project-order adapter.
 */
export function createDshProjectAliases({ getRegistry, getOwner, subscribeChanged, maxWorkspaces = 500 } = {}) {
  let disposed = false;

  function collect() {
    const registry = getRegistry?.();
    if (typeof registry?.list !== 'function') return undefined;
    const rows = registry.list();
    if (!Array.isArray(rows) || rows.length > maxWorkspaces) throw refusalError('NOT_AVAILABLE', 'Native Workspace registry is invalid or over budget');
    const seen = new Set();
    const aliases = [];
    const list = [];
    for (const row of rows) {
      if (typeof row?.id !== 'string' || !row.id) throw refusalError('NOT_AVAILABLE', 'Invalid native Workspace identity');
      let projectKey;
      try { projectKey = projectOrderKey(row.path); } catch { continue; } // relative / unkeyable path: skip, never guess
      if (seen.has(projectKey)) continue; // ambiguous grouping: first registered wins, the rest are dropped
      const alias = displayTitle(row.title);
      if (alias === '') continue; // no human title: the controller's own basename fallback is correct
      seen.add(projectKey);
      aliases.push({ projectKey, alias });
      const updatedAt = row.updatedAt instanceof Date ? row.updatedAt.toISOString() : (typeof row.updatedAt === 'string' ? row.updatedAt : null);
      list.push({ projectKey, alias, updatedAt });
    }
    // Sessions in no Workspace are shown as one 「未分组」 project, like the sidebar.
    const unfiledKey = projectOrderKey(UNFILED_PROJECT_PATH);
    if (!seen.has(unfiledKey)) aliases.push({ projectKey: unfiledKey, alias: "未分组" });
    const owner = getOwner?.();
    const ownerStamp = owner && typeof owner.dataOwnerId === 'string' && owner.dataOwnerId !== '' && Number.isSafeInteger(owner.ownerGeneration) && owner.ownerGeneration >= 0
      ? { dataOwnerId: owner.dataOwnerId, ownerGeneration: owner.ownerGeneration }
      : undefined;
    return { aliases, list, ownerStamp };
  }

  function read() {
    if (disposed) return unavailable();
    const collected = collect();
    if (collected === undefined) return unavailable();
    const snapshot = { aliases: collected.aliases, platform: process.platform, ...(collected.ownerStamp ? { ownerStamp: collected.ownerStamp } : {}) };
    if (Buffer.byteLength(JSON.stringify(snapshot)) > MAX_SNAPSHOT_BYTES) throw refusalError('NOT_AVAILABLE', 'Native project-alias snapshot exceeds the response byte budget');
    return snapshot;
  }

  function list() {
    if (disposed) return [];
    const collected = collect();
    if (collected === undefined) return [];
    const rows = collected.list.map(row => ({ projectKey: row.projectKey, alias: row.alias, ...(row.updatedAt ? { updatedAt: row.updatedAt } : {}) }));
    if (Buffer.byteLength(JSON.stringify(rows)) > MAX_SNAPSHOT_BYTES) throw refusalError('NOT_AVAILABLE', 'Native project-alias list exceeds the response byte budget');
    return rows;
  }

  function onChange(listener) {
    if (disposed || typeof subscribeChanged !== 'function') return () => {};
    let closed = false;
    let previous;
    try { previous = JSON.stringify(read().aliases); } catch { previous = undefined; }
    const stop = subscribeChanged(() => {
      if (closed || disposed) return;
      try {
        const next = read();
        const signature = JSON.stringify(next.aliases);
        if (signature === previous) return;
        previous = signature;
        listener(next);
      } catch { /* the reader surfaces the real error; never announce a fabricated alias */ }
    });
    const close = () => { if (!closed) { closed = true; if (typeof stop === 'function') stop(); } };
    return close;
  }

  return { read, list, onChange, dispose: () => { disposed = true; } };
}
