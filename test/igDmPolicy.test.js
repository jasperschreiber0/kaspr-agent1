const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

// Execute the production handlers with isolated env and offline API doubles.
function harness(blocked = '111', onGenerate = () => {}) {
  const env = { IG_DM_BLOCKED_ACCOUNT_IDS: blocked };
  const calls = { generate: 0, send: 0, log: 0 };
  const cache = {};
  function load(name) {
    if (cache[name]) return cache[name];
    const module = { exports: {} };
    const context = {
      module, process: { env }, console: { log() {}, warn() {}, error() {} },
      require(dependency) {
        if (dependency === '@anthropic-ai/sdk') return class {
          messages = { create: async () => {
            calls.generate++;
            await onGenerate(env);
            return { content: [{ text: 'A reply' }] };
          } };
        };
        if (dependency === './conversationLog') return {
          logConversationEvent: async () => { calls.log++; },
        };
        return load(dependency.slice(2));
      },
      fetch: async (url, options) => {
        calls.send++;
        calls.lastSend = { url, body: JSON.parse(options.body) };
        return { ok: true, json: async () => ({ message_id: 'test' }) };
      },
    };
    vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../src', name + '.js'), 'utf8'), context);
    return (cache[name] = module.exports);
  }
  return { calls, env, ...load('igDmHandler'), ...load('igCommentHandler'), ...load('igDmPolicy') };
}

const client = id => ({ id: 'client-test', instagram_account_id: id, instagram_access_token: 'test' });
const message = { sender: { id: 'sender-test' }, recipient: { id: '111' }, message: { text: 'Hello' } };
const comment = { id: 'comment-test', text: 'Hello', from: { id: 'sender-test' } };

test('blocked account skips generation, sends and conversation logging for both DM formats and comments', async () => {
  const h = harness();
  await h.handleDm({ client: client('111'), value: { messaging: message } });
  await h.handleDm({ client: client('111'), value: message });
  await h.handleComment({ client: client('111'), value: comment });
  assert.deepEqual(h.calls, { generate: 0, send: 0, log: 0 });
});

test('other accounts retain DM and comment automation even when sender ID matches blocked account', async () => {
  const h = harness();
  const otherMessage = { ...message, sender: { id: '111' }, recipient: { id: '222' } };
  await h.handleDm({ client: client('222'), value: { messaging: otherMessage } });
  await h.handleDm({ client: client('222'), value: otherMessage });
  await h.handleComment({ client: client('222'), value: comment });
  assert.equal(h.calls.generate, 3);
  assert.equal(h.calls.send, 3);
  assert.equal(h.calls.log, 3);
  assert.equal(h.calls.lastSend.url, 'https://graph.facebook.com/v19.0/222/messages');
});

test('direct sends cannot bypass policy', async () => {
  const h = harness();
  await assert.rejects(h.sendIgDm({ igAccountId: '111' }), /Automated DMs disabled/);
  assert.equal(h.calls.send, 0);
});

test('policy is checked again after generation, with no false sent log in database', async () => {
  const h = harness('', env => { env.IG_DM_BLOCKED_ACCOUNT_IDS = '111'; });
  await h.handleDm({ client: client('111'), value: message });
  assert.deepEqual(h.calls, { generate: 1, send: 0, log: 0 });
});

test('empty policy preserves behavior and removing an ID reverses a block', async () => {
  const h = harness();
  await h.handleDm({ client: client('111'), value: message });
  h.env.IG_DM_BLOCKED_ACCOUNT_IDS = '';
  await h.handleDm({ client: client('111'), value: message });
  assert.equal(h.calls.generate, 1);
  assert.equal(h.calls.send, 1);
  assert.equal(h.calls.log, 1);
});

test('IDs match exactly, with comma whitespace support and no handle matching', () => {
  const h = harness(' 111, 222 , ,111 ');
  assert.equal(h.isIgDmBlocked('111'), true);
  assert.equal(h.isIgDmBlocked('222'), true);
  for (const id of ['11', '1111', 'kaspr_social', 'kasprsocial', '', null, undefined]) {
    assert.equal(h.isIgDmBlocked(id), false);
  }
});
