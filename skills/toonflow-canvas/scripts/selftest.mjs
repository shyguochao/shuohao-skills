#!/usr/bin/env node
// 自测：覆盖 toonflow-canvas.mjs 的映射、确定性 id、{{ref}} 改写与每条校验规则。
// 不调用任何模型，不花额度。
//   node scripts/selftest.mjs

import assert from 'node:assert/strict';
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  build, canvasPaths, locateInputs, nameTables, nodeId, promptModel, referenceKey,
  resolveAttachment, rewriteRefs, seedanceBody, textPathFor, validate,
} from './toonflow-canvas.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const upstream = join(here, '..', 'references', 'test-fixtures', 'upstream');
const seedance = join(upstream, 'seedance');

let passed = 0;
const ok = (cond, msg) => { assert.ok(cond, msg); passed++; };
const eq = (a, b, msg) => { assert.deepStrictEqual(a, b, msg); passed++; };
const breaks = (bundle, pattern, msg) => {
  const errors = validate(bundle);
  ok(errors.some((e) => pattern.test(e)), `${msg} — 期望违规 ${pattern}，实际 ${JSON.stringify(errors)}`);
};

const bundle = build(upstream, { seedance });
const clone = () => structuredClone(bundle);
const nodesOf = (b, path) => b.canvases[path].nodes;
const byKey = (b, key) => Object.values(b.canvases).flatMap((c) => c.nodes).find((n) => n.id === b.keys[key]);

// —— 确定性 id
eq(nodeId('渡口', 'cast:C01'), nodeId('渡口', 'cast:C01'), '同剧名同键得到同一 id');
ok(nodeId('渡口', 'cast:C01') !== nodeId('渡口', 'cast:C02'), '不同键 id 不同');
ok(nodeId('渡口', 'cast:C01') !== nodeId('别的剧', 'cast:C01'), '不同剧名 id 不同');
ok(/^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(nodeId('渡口', 'x')), 'id 是 v5 格式 UUID');
eq(JSON.stringify(build(upstream, { seedance })), JSON.stringify(bundle), '重复 build 结果完全一致');

// —— 引用键与 promptModel 与 Toonflow 一致
eq(referenceKey('a', 'image'), encodeURIComponent('["a","image"]'), 'referenceKey 与 useNodeReferences 相同');
eq(promptModel('甲\n乙'), [[{ type: 'Write', text: '甲' }], [{ type: 'Write', text: '乙' }]], 'promptModel 按行 Write');

// —— 输入定位与名称表
eq(locateInputs(upstream).title, '渡口', '目录只有一个剧名时自动识别');
const names = nameTables(locateInputs(upstream).inputs);
eq(names.chars.get('C01')?.name, '沈知微', 'cast 按姓名对回 outline 的 id');
ok(names.chars.get('C01')?.cast, '对回后带上 cast 数据');
eq(nameTables({ cast: { characters: [{ name: '甲' }, { name: '乙' }] } }).chars.get('C02')?.name, '乙', '没有 outline 时按顺序编号');

// —— 剧本画布
const script = nodesOf(bundle, canvasPaths.script);
eq(script.length, 7, '大纲 1 + 剧本 6');
ok(script.every((n) => n.type === 'remote-textNode' && n.data.textPath === textPathFor(n.id)), '文本节点 textPath 正确');
ok(bundle.texts[bundle.keys.outline].startsWith('# 故事大纲｜渡口'), '大纲正文');
ok(/\*\*老周\*\*（[^）]+）：上船喽/.test(bundle.texts[bundle.keys['script:1']]), '剧本台词带说话人姓名与语气');

// —— 资产画布
const assets = nodesOf(bundle, canvasPaths.assets);
eq(assets.filter((n) => n.data.label.startsWith('角色-')).length, 4, '4 个角色节点');
eq(assets.filter((n) => n.data.label.startsWith('道具-')).length, 2, '2 个道具节点');
const variant = byKey(bundle, 'art:S01:晨雾');
ok(variant && variant.data.prompt.startsWith('参考 {{ref 1}}'), '光照变体以 {{ref 1}} 引用母场景');
eq(variant.data.referenceOrder.in, [referenceKey(bundle.keys['art:S01'], 'image')], '变体 referenceOrder 指向母场景');
ok(bundle.canvases[canvasPaths.assets].edges.some((e) => e.source === bundle.keys['art:S01'] && e.target === variant.id), '母场景连线到变体');
ok(/\n避免：/.test(byKey(bundle, 'cast:C01').data.prompt), '反向提示词追加为「避免」行');
eq(byKey(bundle, 'prop:P01').data.ratio, '1:1', '道具 1:1');

// —— 分集画布
const ep1 = bundle.canvases[canvasPaths.episode(1)];
eq(ep1.nodes.filter((n) => n.type === 'remote-videoGenerationNode').length, 10, '10 段视频节点');
eq(ep1.nodes.filter((n) => n.type === 'remote-imageNode').length, 7, '每个资产一集只建一个引用节点');
const seg = byKey(bundle, 'seg:E01-01');
eq(seg.data.duration, 15, 'duration 取整秒');
eq(seg.data.referenceOrder.in.length, 5, '5 个附件 → 5 个引用');
ok(seg.data.prompt.startsWith('{{ref 1}} = 引用-场景-渡口栈桥'), '附件头改写为 {{ref}} = 引用节点名');
ok(!/@\[?图片\d/.test(seg.data.prompt), '正文不再有 @图片');
eq(bundle.refs[bundle.keys['ref:1:cast:C01']], bundle.keys['cast:C01'], '引用节点对回资产节点');
eq(validate(bundle), [], '样例通过校验');

// —— {{ref}} 改写与正文截取
eq(seedanceBody('头\n---\n\n正文'), '正文', '取分隔线以下');
eq(rewriteRefs('@[图片2] = C01\n看 @图片2 和 @图片3', new Map([[2, 1]]), { 2: '引用-角色-甲' }), '{{ref 1}} = 引用-角色-甲\n看 {{ref 1}} 和 @图片3', '只改写已映射的编号');
eq(resolveAttachment('沈知微', names)?.key, 'cast:C01', '显示名也能匹配');
eq(resolveAttachment('不存在', names), undefined, '匹配不到返回 undefined');

// —— 匹配失败与分镜图附件 → error
const tmp = mkdtempSync(join(tmpdir(), 'toonflow-canvas-'));
try {
  cpSync(upstream, tmp, { recursive: true });
  const manifestPath = join(tmp, 'seedance', 'seedance-manifest.json');
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  manifest[0].attachments[1].label = 'C99';
  manifest[1].attachments.push({ ref: '@图片9', label: '分镜图 #1', kind: 'frame' });
  writeFileSync(manifestPath, JSON.stringify(manifest));
  const broken = build(tmp, { seedance: join(tmp, 'seedance') });
  breaks(broken, /C99.*对不上/, '附件对不上要拦');
  breaks(broken, /分镜图/, '分镜图附件要拦');
  const onlyOutline = mkdtempSync(join(tmpdir(), 'toonflow-canvas-'));
  cpSync(join(upstream, '渡口-outline.json'), join(onlyOutline, '渡口-outline.json'));
  const b = build(onlyOutline);
  eq(Object.keys(b.canvases), [canvasPaths.script], '只有大纲时只产出剧本画布');
  eq(validate(b), [], '只有大纲也通过校验');
  rmSync(onlyOutline, { recursive: true, force: true });
} finally {
  rmSync(tmp, { recursive: true, force: true });
}

// —— 每条校验规则的击穿用例
{ const b = clone(); b.kind = 'x'; breaks(b, /不是 toonflow-bundle/, 'kind'); }
{ const b = clone(); b.title = ''; breaks(b, /缺 title/, 'title'); }
{ const b = clone(); b.canvases['../x.json'] = { nodes: [], edges: [] }; breaks(b, /画布路径不合法/, '路径穿越'); }
{ const b = clone(); b.canvases['assets/x.json'] = { nodes: [], edges: [] }; breaks(b, /画布路径不合法/, 'assets 下不能放画布'); }
{ const b = clone(); nodesOf(b, canvasPaths.script)[0].id = 'abc'; breaks(b, /不是 UUID/, 'id 格式'); }
{ const b = clone(); const n = structuredClone(nodesOf(b, canvasPaths.assets)[0]); nodesOf(b, canvasPaths.script).push(n); breaks(b, /id 重复/, 'id 唯一'); }
{ const b = clone(); nodesOf(b, canvasPaths.assets)[0].type = 'remote-foo'; breaks(b, /类型不支持/, '类型'); }
{ const b = clone(); nodesOf(b, canvasPaths.assets)[0].data.label = ' '; breaks(b, /缺 label/, 'label'); }
{ const b = clone(); nodesOf(b, canvasPaths.script)[0].data.textPath = 'x.md'; breaks(b, /textPath/, 'textPath'); }
{ const b = clone(); delete b.texts[b.keys.outline]; breaks(b, /没有正文/, '正文'); }
{ const b = clone(); b.texts[b.keys['cast:C01']] = 'x'; breaks(b, /不是文本节点/, 'texts 只给文本节点'); }
{ const b = clone(); byKey(b, 'cast:C01').data.prompt = ''; breaks(b, /提示词为空/, '提示词非空'); }
{ const b = clone(); byKey(b, 'cast:C01').data.prompt += '!'; breaks(b, /promptModel 与 prompt 不一致/, 'promptModel 一致'); }
{ const b = clone(); const e = b.canvases[canvasPaths.assets].edges; e.push({ ...e[0] }); breaks(b, /连线 id 重复/, '连线 id 唯一'); }
{ const b = clone(); b.canvases[canvasPaths.assets].edges[0].target = b.keys.outline; breaks(b, /端点不在同一画布/, '跨画布连线'); }
{ const b = clone(); b.canvases[canvasPaths.assets].edges[0].sourceHandle = 'video'; breaks(b, /端口不对/, '端口'); }
{ const b = clone(); byKey(b, 'seg:E01-01').data.referenceOrder.in.pop(); breaks(b, /referenceOrder 与入边不一致/, 'referenceOrder'); }
{ const b = clone(); const n = byKey(b, 'seg:E01-01'); n.data.prompt += '\n{{ref 9}}'; n.data.promptModel = promptModel(n.data.prompt); breaks(b, /\{\{ref 9\}\} 没有对应的连线/, '{{ref}} 越界'); }
{ const b = clone(); b.refs[b.keys.outline] = b.keys['cast:C01']; breaks(b, /不是图片素材节点/, 'refs 键'); }
{ const b = clone(); b.refs[b.keys['ref:1:cast:C01']] = b.keys.outline; breaks(b, /不是资产生成节点/, 'refs 值'); }
{ const b = clone(); b.warnings.push({ level: 'error', message: '人为错误' }); breaks(b, /人为错误/, 'warnings error'); }

console.log(`✓ ${passed} 项断言全部通过`);
