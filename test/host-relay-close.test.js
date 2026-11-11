import test from 'node:test';
import assert from 'node:assert/strict';
import { isRelaySignInClose, RELAY_SIGN_IN_CLOSE_CODES } from '../src/host.js';

test('a removed device or dead token ends in the sign-in form, not an endless reconnect ladder', () => {
  // 4410: the relay's "device removed; sign in again to register".
  // 4401: the same dead end for an expired/revoked token.
  assert.equal(isRelaySignInClose(4410), true);
  assert.equal(isRelaySignInClose(4401), true);
  assert.deepEqual([...RELAY_SIGN_IN_CLOSE_CODES].sort(), [4401, 4410]);
});

test('ordinary socket losses stay retryable', () => {
  for (const code of [1000, 1001, 1005, 1006, 1011, 1012, 1013, 0]) {
    assert.equal(isRelaySignInClose(code), false, String(code));
  }
  assert.equal(isRelaySignInClose(undefined), false, 'a close without a code is an ordinary loss');
});
