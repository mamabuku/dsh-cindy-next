import test from 'node:test';
import assert from 'node:assert/strict';
import { renderGenuiFencesAsText, summarizeGenuiCard, flattenGenuiRows, flattenGenuiMessage } from '../src/genui-fence.js';
import { toCindyMessageRows } from '../src/cindy-message-row.js';

const CARD = {
  title: 'GenUI 手机端渲染测试',
  items: [
    { type: 'hero', title: 'GenUI 渲染测试', subtitle: '如果手机支持原生渲染…' },
    { type: 'row', items: [
      { type: 'stat', label: '接入耗时', value: '约 5 分钟' },
      { type: 'stat', label: '已验证链路', value: '3/3 全通' },
    ] },
    { type: 'chart', kind: 'donut', data: [{ label: '布局容器', value: 3 }, { label: '展示组件', value: 2 }] },
    { type: 'table', columns: ['组件', '期望渲染效果'], rows: [['封面', '带底色标题块'], ['圆环图', '彩色环']] },
    { type: 'list', items: [{ title: '全部正常渲染', desc: '卡片可用' }] },
  ],
};

test('a dsh-ui fence becomes readable text instead of raw JSON', () => {
  const text = `先看卡片：\n\n\`\`\`dsh-ui\n${JSON.stringify(CARD)}\n\`\`\`\n\n结果告诉我。`;
  const shown = renderGenuiFencesAsText(text);
  assert.match(shown, /先看卡片/);
  assert.match(shown, /GenUI 手机端渲染测试/);
  assert.match(shown, /接入耗时：约 5 分钟/);
  assert.match(shown, /图表：布局容器 3 · 展示组件 2/);
  assert.match(shown, /表格（2 列 × 2 行）：组件 \/ 期望渲染效果/);
  assert.match(shown, /• 全部正常渲染：卡片可用/);
  assert.match(shown, /结果告诉我/);
  assert.equal(shown.includes('"type"'), false, 'no JSON leaks into the phone text');
});

test('an unparseable card is one short notice, not a code dump', () => {
  const shown = renderGenuiFencesAsText('x\n```dsh-ui\n{ not json }\n```\ny');
  assert.match(shown, /手机端无法渲染/);
  assert.equal(shown.includes('{ not json }'), false);
});

test('other fences and prose are untouched', () => {
  const text = 'before\n```js\nconst a = 1;\n```\nafter';
  assert.equal(renderGenuiFencesAsText(text), text);
  assert.equal(renderGenuiFencesAsText('plain'), 'plain');
});

test('read results are flattened only for mobile platforms', () => {
  const fence = `\`\`\`dsh-ui\n${JSON.stringify(CARD)}\n\`\`\``;
  const rows = [{ id: 'a', role: 'assistant', content: fence }, { id: 'u', role: 'user', content: fence }];
  const mobile = flattenGenuiRows(rows, 'ios');
  assert.match(mobile[0].content, /GenUI 手机端渲染测试/);
  assert.doesNotMatch(mobile[0].content, /"type"/);
  assert.equal(mobile[1].content, fence, 'a user who pasted a fence sees what they pasted');
  assert.equal(flattenGenuiRows(rows, 'darwin'), rows, 'a desktop controller keeps the card');
  assert.equal(flattenGenuiRows(rows, null), rows);
});

test('the live push payload is flattened for a phone and kept for a desktop', () => {
  const fence = `\`\`\`dsh-ui\n${JSON.stringify(CARD)}\n\`\`\``;
  const message = { role: 'assistant', content: [{ type: 'text', text: fence }] };
  assert.match(flattenGenuiMessage(message, 'android').content[0].text, /GenUI 手机端渲染测试/);
  assert.equal(flattenGenuiMessage(message, 'darwin'), message);
  assert.equal(flattenGenuiMessage({ role: 'user', content: [{ type: 'text', text: fence }] }, 'ios').content[0].text, fence);
});

test('a card with only a title still yields something readable', () => {
  assert.equal(summarizeGenuiCard({ title: '空卡片' }), '「空卡片」');
  assert.equal(summarizeGenuiCard({ items: [] }), null);
});
