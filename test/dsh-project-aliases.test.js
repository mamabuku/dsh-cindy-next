import test from 'node:test';
import assert from 'node:assert/strict';
import { createDshProjectAliases, MAX_PROJECT_ALIAS_LENGTH } from '../src/dsh-project-aliases.js';
import { createChannelRouter } from '../src/cindy-channels.js';

function fixture(rows = [
  { id: '1', path: '/Users/me/投资', title: '财务', updatedAt: '2026-11-01T00:00:00.000Z' },
  { id: '2', path: '/Users/me/default-workspace', title: 'default-workspace', updatedAt: '2026-11-02T00:00:00.000Z' },
  { id: '3', path: '/Users/me/untitled', title: '   ', updatedAt: '2026-11-03T00:00:00.000Z' },
]) {
  let current = rows;
  let owner = { dataOwnerId: 'verified-account-device-source', ownerGeneration: 1 };
  const listeners = new Set();
  const registry = { list: () => current };
  const port = createDshProjectAliases({
    getRegistry: () => registry,
    getOwner: () => owner,
    subscribeChanged: fn => { listeners.add(fn); return () => listeners.delete(fn); },
  });
  return { port, listeners, replace: value => { current = value; }, setOwner: value => { owner = value; } };
}

test('workspace titles become local: aliases and untitled workspaces fall back to the client basename', () => {
  const f = fixture();
  const snapshot = f.port.read();
  assert.deepEqual(snapshot.aliases, [
    { projectKey: 'local:/Users/me/投资', alias: '财务' },
    { projectKey: 'local:/Users/me/default-workspace', alias: '默认工作区' },
  ]);
  assert.equal(snapshot.platform, process.platform);
  assert.deepEqual(snapshot.ownerStamp, { dataOwnerId: 'verified-account-device-source', ownerGeneration: 1 });
});

test('alias text is flattened, capped at the controller limit, and never invented', () => {
  const long = '项'.repeat(MAX_PROJECT_ALIAS_LENGTH + 20);
  const f = fixture([
    { id: '1', path: '/a', title: '  财务\n\t平台  ' },
    { id: '2', path: '/b', title: long },
    { id: '3', path: '/c', title: '' },
    { id: '4', path: '/d', title: undefined },
  ]);
  const aliases = f.port.read().aliases;
  assert.deepEqual(aliases[0], { projectKey: 'local:/a', alias: '财务 平台' });
  assert.equal([...aliases[1].alias].length, MAX_PROJECT_ALIAS_LENGTH);
  assert.equal(aliases.length, 2, 'an empty or missing title is skipped, not replaced by the path');
});

test('unkeyable and duplicate paths are skipped instead of guessed', () => {
  const f = fixture([
    { id: '1', path: 'relative/path', title: 'Relative' },
    { id: '2', path: '/same', title: 'First' },
    { id: '3', path: '/same/', title: 'Duplicate' },
  ]);
  assert.deepEqual(f.port.read().aliases, [{ projectKey: 'local:/same', alias: 'First' }]);
});

test('a registry that is not mounted yields the empty shape rather than an error', () => {
  const port = createDshProjectAliases({ getRegistry: () => undefined, getOwner: () => undefined });
  assert.deepEqual(port.read(), { aliases: [], platform: process.platform });
  assert.deepEqual(port.list(), []);
});

test('an unverified owner omits the stamp', () => {
  const f = fixture();
  f.setOwner(undefined);
  assert.equal(Object.hasOwn(f.port.read(), 'ownerStamp'), false);
});

test('list rows carry updatedAt when the registry exposes it', () => {
  const f = fixture();
  assert.deepEqual(f.port.list()[0], { projectKey: 'local:/Users/me/投资', alias: '财务', updatedAt: '2026-11-01T00:00:00.000Z' });
});

test('onChange announces a real title change only', () => {
  const f = fixture();
  const events = [];
  const close = f.port.onChange(snapshot => events.push(snapshot));
  for (const fn of f.listeners) fn();
  assert.equal(events.length, 0, 'no change, no push');
  f.replace([{ id: '1', path: '/Users/me/投资', title: '投资', updatedAt: '2026-11-04T00:00:00.000Z' }]);
  for (const fn of f.listeners) fn();
  assert.equal(events.length, 1);
  assert.deepEqual(events[0].aliases, [{ projectKey: 'local:/Users/me/投资', alias: '投资' }]);
  close();
  assert.equal(f.listeners.size, 0);
});

test('the official RPCs answer the alias snapshot and the alias list', async () => {
  const f = fixture();
  const router = createChannelRouter({ listSessions: async () => [], subscribers: new Set(), resolveCapabilities: () => ({ projectAliases: f.port }) });
  const call = (channel, args) => router({ v: 1, id: channel, src: 'phone', kind: 'invoke', payload: { channel, args } });
  const snapshot = await call('sidebar-settings:get-project-aliases', []);
  assert.equal(snapshot.payload.ok, true);
  assert.deepEqual(snapshot.payload.result.aliases[0], { projectKey: 'local:/Users/me/投资', alias: '财务' });
  const list = await call('local-db:project-aliases:list', []);
  assert.equal(list.payload.ok, true);
  assert.equal(list.payload.result[0].alias, '财务');
});

test('an uncomposed alias port answers the empty shapes, not CHANNEL_NOT_ALLOWED', async () => {
  const router = createChannelRouter({ listSessions: async () => [], subscribers: new Set(), resolveCapabilities: () => ({}) });
  const call = (channel, args) => router({ v: 1, id: channel, src: 'phone', kind: 'invoke', payload: { channel, args } });
  assert.deepEqual((await call('sidebar-settings:get-project-aliases', [])).payload.result, { aliases: [], platform: process.platform });
  assert.deepEqual((await call('local-db:project-aliases:list', [])).payload.result, []);
});

test('wrong argument counts are refused', async () => {
  const f = fixture();
  const router = createChannelRouter({ listSessions: async () => [], subscribers: new Set(), resolveCapabilities: () => ({ projectAliases: f.port }) });
  const call = (channel, args) => router({ v: 1, id: channel, src: 'phone', kind: 'invoke', payload: { channel, args } });
  for (const channel of ['sidebar-settings:get-project-aliases', 'local-db:project-aliases:list']) {
    const answer = await call(channel, ['extra']);
    assert.equal(answer.payload.ok, false);
    assert.equal(answer.payload.error.code, 'BAD_REQUEST');
  }
});

test('the default workspace is shown with the same name the DSH sidebar uses', () => {
  const f = fixture([
    { id: '1', path: '/Users/me/default-workspace', title: 'default-workspace' },
    { id: '2', path: '/Users/me/finance', title: '财务' },
  ]);
  assert.deepEqual(f.port.read().aliases, [
    { projectKey: 'local:/Users/me/default-workspace', alias: '默认工作区' },
    { projectKey: 'local:/Users/me/finance', alias: '财务' },
  ]);
});
