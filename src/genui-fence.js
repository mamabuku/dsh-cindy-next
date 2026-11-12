/**
 * Turn a ```dsh-ui fence into something a text-only client can read.
 *
 * `dsh-ui` is a *client* rendering contract: DSH's own Web shell loads the GenUI
 * renderer and draws the card. Cindy mobile has no such renderer, so the same
 * message arrived there as a wall of JSON inside a code block — technically the
 * honest bytes, practically unreadable.
 *
 * This module is a presentation fallback for that second client: keep what the
 * card *says* (title, numbers, rows, bullets), drop the structure only a renderer
 * can use. It never invents content: an unparseable fence becomes one short
 * notice, and everything outside the fences is left byte-for-byte.
 */

const FENCE = /^```[ \t]*dsh-ui[ \t]*\r?\n([\s\S]*?)^```[ \t]*$/gm;
const MAX_SUMMARY_CHARS = 700;

const clean = (value) => {
  if (typeof value === 'string') return value.replace(/\s+/g, ' ').trim();
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return '';
};

function line(text) {
  return text === '' ? null : text;
}

function walk(node, out) {
  if (node === null || typeof node !== 'object') return;
  if (Array.isArray(node)) {
    for (const item of node) walk(item, out);
    return;
  }
  switch (node.type) {
    case 'hero':
      out.push(line(clean(node.title)));
      out.push(line(clean(node.content ?? node.desc)));
      return;
    case 'stat':
      out.push(line(`${clean(node.label)}：${clean(node.value)}`.replace(/^：/, '')));
      return;
    case 'keyvalue':
      for (const pair of Array.isArray(node.pairs) ? node.pairs : []) {
        out.push(line(`${clean(pair?.key)}：${clean(pair?.value)}`));
      }
      return;
    case 'list':
      for (const item of Array.isArray(node.items) ? node.items : []) {
        const title = clean(item?.title ?? item?.label);
        const desc = clean(item?.desc ?? item?.content);
        out.push(line(title && desc ? `• ${title}：${desc}` : title ? `• ${title}` : desc ? `• ${desc}` : ''));
      }
      return;
    case 'steps':
      (Array.isArray(node.steps) ? node.steps : []).forEach((step, index) => {
        const title = clean(step?.title ?? step?.label);
        const desc = clean(step?.desc ?? step?.content);
        out.push(line(title ? `${index + 1}. ${title}${desc ? `：${desc}` : ''}` : ''));
      });
      return;
    case 'table': {
      const columns = Array.isArray(node.columns) ? node.columns.map(clean) : [];
      const rows = Array.isArray(node.rows) ? node.rows : [];
      out.push(line(`表格（${columns.length} 列 × ${rows.length} 行）：${columns.join(' / ')}`));
      return;
    }
    case 'chart': {
      const data = Array.isArray(node.data) ? node.data : [];
      const parts = data.slice(0, 6).map((point) => `${clean(point?.label)} ${clean(point?.value)}`).filter((part) => part.trim() !== '');
      out.push(line(parts.length > 0 ? `图表：${parts.join(' · ')}` : ''));
      return;
    }
    case 'callout':
      out.push(line(clean(node.content)));
      return;
    case 'text':
      out.push(line(clean(node.content)));
      return;
    case 'divider':
    case 'spacer':
    case 'code':
    case 'json':
      return;
    default:
      // Unknown container: look inside rather than guessing at its meaning.
      if (node.items) walk(node.items, out);
      if (node.children) walk(node.children, out);
      if (node.content && typeof node.content === 'string') out.push(line(clean(node.content)));
  }
}

/** Readable text for one parsed dsh-ui document. */
export function summarizeGenuiCard(card) {
  const out = [];
  if (card && typeof card === 'object') {
    if (clean(card.title)) out.push(`「${clean(card.title)}」`);
    walk(card.items, out);
  }
  const lines = out.filter((entry) => entry !== null && entry !== '');
  if (lines.length === 0) return null;
  let text = lines.join('\n');
  if (text.length > MAX_SUMMARY_CHARS) text = text.slice(0, MAX_SUMMARY_CHARS).trimEnd() + '…';
  return text;
}

/**
 * Replace every complete `dsh-ui` fence in one message with its text summary.
 * @param text - the assistant's markdown.
 * @returns the same text, with renderable cards flattened; other fences untouched.
 */
export function renderGenuiFencesAsText(text) {
  if (typeof text !== 'string' || !text.includes('```')) return text;
  return text.replace(FENCE, (whole, body) => {
    let summary;
    try { summary = summarizeGenuiCard(JSON.parse(body)); } catch { summary = null; }
    const heading = summary ?? '（这张卡片手机端无法渲染）';
    return `${heading}\n\n（图形卡片在电脑端查看）`;
  });
}

const MOBILE = new Set(['ios', 'android']);

export function clientNeedsTextFallback(platform) {
  return MOBILE.has(platform);
}

/**
 * Flatten every assistant text row in a read result for a mobile client.
 * Walks objects/arrays so it applies to a bare row array and to the paged
 * history view alike, without either caller describing its shape here.
 */
export function flattenGenuiRows(value, platform) {
  if (!clientNeedsTextFallback(platform)) return value;
  const walk = (node) => {
    if (Array.isArray(node)) return node.map(walk);
    if (node === null || typeof node !== 'object') return node;
    if (node.role === 'assistant') {
      if (typeof node.content === 'string') return { ...node, content: renderGenuiFencesAsText(node.content) };
      if (node.content && typeof node.content.text === 'string') return { ...node, content: { ...node.content, text: renderGenuiFencesAsText(node.content.text) } };
    }
    let changed = false;
    const out = {};
    for (const [key, item] of Object.entries(node)) { const next = walk(item); out[key] = next; if (next !== item) changed = true; }
    return changed ? out : node;
  };
  return walk(value);
}

/** Flatten a raw DSH message's text blocks before it is pushed to a mobile client. */
export function flattenGenuiMessage(message, platform) {
  if (!clientNeedsTextFallback(platform)) return message;
  if (!message || message.role !== 'assistant' || !Array.isArray(message.content)) return message;
  let changed = false;
  const content = message.content.map((block) => {
    if (block && block.type === 'text' && typeof block.text === 'string') {
      const text = renderGenuiFencesAsText(block.text);
      if (text !== block.text) { changed = true; return { ...block, text }; }
    }
    return block;
  });
  return changed ? { ...message, content } : message;
}
