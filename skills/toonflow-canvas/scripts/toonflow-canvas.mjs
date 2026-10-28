#!/usr/bin/env node
/**
 * toonflow-canvas — 把 novel-* 系列产出的 JSON 转成 Toonflow-app 原生画布数据。
 *
 * 只读上游 JSON（数据契约），不 import 兄弟 skill 的代码，整个目录可单独拷走。
 * 产出一个 bundle（<剧名>-toonflow.json）：每个画布的节点与连线、文本节点正文、业务键 → 节点 id。
 * bundle 本身不是画布（没有 toonflowCanvas 标记），Toonflow 不会把它当画布扫描；
 * 写进工作目录由宿主工具（如 toonflow-assistant 的 tfa import）负责合并、快照与回滚。
 *
 * 节点格式对应 Toonflow-app af6e884，规则见 references/toonflow-format.md。
 */
import { existsSync, readFileSync, readdirSync, realpathSync, writeFileSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';

export const toonflowFormat = 'af6e884';
export const gapX = 460;
export const gapY = 395;
const videoGapY = 560;

export const canvasPaths = {
  script: '画布/剧本.json',
  assets: '画布/资产.json',
  episode: (ep) => `画布/分集/第${String(ep).padStart(3, '0')}集.json`,
};

/** 端口定义与 Toonflow 各节点 defineOptions.handles 一致（APP 也把它写进 data.handles）。 */
export const handles = {
  'remote-textNode': [
    { id: 'in', type: 'target', dataType: ['VIDEO', 'IMAGE', 'STRING', 'FILE'], label: '视频、图片、文本、文件输入' },
    { id: 'text', type: 'source', dataType: 'STRING', label: '文本输出' },
  ],
  'remote-imageGenerationNode': [
    { id: 'in', type: 'target', dataType: ['IMAGE', 'STRING'], label: '图片、文本输入' },
    { id: 'image', type: 'source', dataType: 'IMAGE', label: '图片输出' },
  ],
  'remote-videoGenerationNode': [
    { id: 'in', type: 'target', dataType: ['IMAGE', 'VIDEO', 'AUDIO', 'STRING'], label: '图片、视频、音频、文本输入' },
    { id: 'video', type: 'source', dataType: 'VIDEO', label: '视频输出' },
  ],
  'remote-imageNode': [
    { id: 'in', type: 'target', dataType: 'IMAGE', label: '来源图片' },
    { id: 'image', type: 'source', dataType: 'IMAGE', label: '图片输出' },
  ],
};
const sourceHandle = { 'remote-textNode': 'text', 'remote-imageGenerationNode': 'image', 'remote-videoGenerationNode': 'video', 'remote-imageNode': 'image' };

/** 业务键 → 确定性 UUID：同一剧名同一键永远得到同一 id，重复导入才能原地更新。 */
export function nodeId(title, key) {
  const h = createHash('sha1').update(`toonflow-canvas\u0000${title}\u0000${key}`).digest('hex');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-5${h.slice(13, 16)}-${((parseInt(h[16], 16) & 3) | 8).toString(16)}${h.slice(17, 20)}-${h.slice(20, 32)}`;
}

/** referenceOrder 的键，与 Toonflow useNodeReferences.referenceKey 相同。 */
export const referenceKey = (source, handle) => encodeURIComponent(JSON.stringify([source, handle]));

export const promptModel = (prompt) => prompt.split('\n').map((text) => [{ type: 'Write', text }]);
export const textPathFor = (id) => `assets/${id}/content.md`;

function node(id, type, label, position, extra = {}) {
  return { id, type, initialized: false, position, data: { label, handles: structuredClone(handles[type]), outputs: {}, ...extra } };
}
const textNode = (id, label, position) => node(id, 'remote-textNode', label, position, { textPath: textPathFor(id), promptModel: promptModel('') });
const promptNode = (id, type, label, position, prompt, extra = {}) => node(id, type, label, position, { prompt, promptModel: promptModel(prompt), ...extra });

function edge(title, source, target) {
  return { id: nodeId(title, `edge:${source.id}->${target.id}`), source: source.id, sourceHandle: sourceHandle[source.type], target: target.id, targetHandle: 'in' };
}

const readJson = (path) => JSON.parse(readFileSync(path, 'utf8'));
const clean = (v) => String(v ?? '').trim();

/* ------------------------------------------------------------------ */
/* 输入定位与名称表                                                      */
/* ------------------------------------------------------------------ */

export const inputKinds = ['outline', 'cast', 'art', 'script'];

/** 在目录里找同剧名的上游 JSON；不给 title 时要求目录里只有一个剧名。 */
export function locateInputs(dir, title) {
  const titles = new Set();
  for (const name of readdirSync(dir)) {
    const m = /^(.*)-(outline|cast|art|script)\.json$/.exec(name);
    if (m) titles.add(m[1]);
  }
  if (!title) {
    if (titles.size !== 1) throw new Error(titles.size ? `目录里有多个剧名（${[...titles].join('、')}），请使用 --title 指定` : `${dir} 里没有 <剧名>-outline|cast|art|script.json`);
    title = [...titles][0];
  }
  const inputs = {};
  for (const kind of inputKinds) {
    const path = join(dir, `${title}-${kind}.json`);
    if (existsSync(path)) inputs[kind] = readJson(path);
  }
  if (!Object.keys(inputs).length) throw new Error(`${dir} 里没有 ${title}-outline|cast|art|script.json`);
  return { title, inputs };
}

/**
 * id → 显示名。角色 id 以 outline 为准；cast.json 不带 id，按姓名对回 outline，
 * 没有 outline 时按出场顺序编 C01、C02……（与 novel-characters 的约定一致）。
 */
export function nameTables({ outline, cast, art }) {
  const chars = new Map();
  for (const c of outline?.characters ?? []) chars.set(c.id, { name: c.name });
  (cast?.characters ?? []).forEach((c, i) => {
    const id = [...chars].find(([, v]) => v.name === c.name)?.[0] ?? c.id ?? `C${String(i + 1).padStart(2, '0')}`;
    chars.set(id, { ...chars.get(id), name: c.name, cast: c });
  });
  const scenes = new Map();
  for (const s of outline?.scenes ?? []) scenes.set(s.id, { name: s.name });
  for (const s of art?.scenes ?? []) scenes.set(s.id, { ...scenes.get(s.id), name: s.name, art: s });
  const props = new Map();
  for (const p of outline?.props ?? []) props.set(p.id, { name: p.name });
  for (const p of art?.props ?? []) props.set(p.id, { ...props.get(p.id), name: p.name, art: p });
  return { chars, scenes, props };
}

/* ------------------------------------------------------------------ */
/* 文本节点正文                                                          */
/* ------------------------------------------------------------------ */

export function outlineMarkdown(outline, names) {
  const p = outline.params ?? {};
  const out = [`# 故事大纲｜${outline.source ?? ''}`, ''];
  out.push(`> ${[p.episodes && `${p.episodes} 集`, p.minutesPerEpisode && `每集 ${p.minutesPerEpisode} 分钟`, p.genre, p.adaptMode].filter(Boolean).join(' · ')}`, '');
  if (clean(outline.adaptation?.core)) out.push('## 一句话核心', '', clean(outline.adaptation.core), '');
  if (outline.characters?.length) {
    out.push('## 人物', '', '| ID | 姓名 | 定位 | 人物弧 |', '| --- | --- | --- | --- |');
    for (const c of outline.characters) out.push(`| ${c.id} | ${c.name} | ${clean(c.role)} | ${clean(c.arc)} |`);
    out.push('');
  }
  if (outline.scenes?.length) out.push('## 场景', '', ...outline.scenes.map((s) => `- ${s.id} ${s.name}${s.primary ? '（主场景）' : ''}`), '');
  if (outline.episodes?.length) {
    out.push('## 分集梗概', '');
    for (const e of outline.episodes) {
      out.push(`### 第 ${e.ep} 集`, '', clean(e.synopsis), '');
      if (clean(e.hook)) out.push(`- 【钩子】${clean(e.hook)}`);
      if (clean(e.suspense)) out.push(`- 【悬念】${clean(e.suspense)}`);
      const who = (e.characterIds ?? []).map((id) => names.chars.get(id)?.name ?? id);
      const where = (e.sceneIds ?? []).map((id) => names.scenes.get(id)?.name ?? id);
      if (who.length || where.length) out.push(`- 出场：${who.join('、')}｜场景：${where.join('、')}`);
      out.push('');
    }
  }
  return `${out.join('\n').trim()}\n`;
}

export function scriptMarkdown(episode, names) {
  const out = [`# 第${episode.ep}集剧本`, ''];
  if (clean(episode.hook)) out.push(`> 钩子：${clean(episode.hook)}`);
  if (clean(episode.cliff)) out.push(`> 结尾悬念：${clean(episode.cliff)}`);
  if (clean(episode.hook) || clean(episode.cliff)) out.push('');
  (episode.scenes ?? []).forEach((scene, i) => {
    const place = names.scenes.get(scene.sceneId)?.name ?? scene.sceneId ?? '';
    out.push(`## 第${i + 1}场 · ${place}${clean(scene.lighting) ? `（${clean(scene.lighting)}）` : ''}`, '');
    const who = (scene.characters ?? []).map((id) => names.chars.get(id)?.name ?? id);
    if (who.length) out.push(`出场：${who.join('、')}`, '');
    for (const beat of scene.flow ?? []) {
      if (beat.action !== undefined) out.push(`△ ${clean(beat.action)}`, '');
      else {
        const speaker = beat.speaker === 'VO' ? '画外音' : names.chars.get(beat.speaker)?.name ?? beat.speaker;
        out.push(`**${speaker}**${clean(beat.delivery) ? `（${clean(beat.delivery)}）` : ''}：${clean(beat.line)}`, '');
      }
    }
  });
  return `${out.join('\n').trim()}\n`;
}

/* ------------------------------------------------------------------ */
/* 画布构建                                                              */
/* ------------------------------------------------------------------ */

const withNegative = (image) => [clean(image?.prompt), clean(image?.negativePrompt) && `避免：${clean(image.negativePrompt)}`].filter(Boolean).join('\n');
export const assetLabel = { cast: (n) => `角色-${n}`, scene: (n) => `场景-${n}`, prop: (n) => `道具-${n}` };

function newBundle(title) {
  return { kind: 'toonflow-bundle', version: 1, title, toonflowFormat, canvases: {}, texts: {}, keys: {}, refs: {}, warnings: [] };
}
function canvasOf(bundle, path) {
  return (bundle.canvases[path] ??= { nodes: [], edges: [] });
}
function add(bundle, path, key, make) {
  const id = nodeId(bundle.title, key);
  const created = make(id);
  canvasOf(bundle, path).nodes.push(created);
  bundle.keys[key] = id;
  return created;
}

function buildScript(bundle, { outline, script }, names) {
  const path = canvasPaths.script;
  if (outline) {
    const n = add(bundle, path, 'outline', (id) => textNode(id, `故事大纲｜${bundle.title}`, { x: 0, y: 0 }));
    bundle.texts[n.id] = outlineMarkdown(outline, names);
  }
  (script?.episodes ?? []).forEach((episode, i) => {
    const n = add(bundle, path, `script:${episode.ep}`, (id) => textNode(id, `第${episode.ep}集剧本`, { x: gapX, y: i * gapY }));
    bundle.texts[n.id] = scriptMarkdown(episode, names);
  });
}

function buildAssets(bundle, names, ratio) {
  const path = canvasPaths.assets;
  const assets = new Map();
  let row = 0;
  for (const [id, c] of names.chars) {
    if (!clean(c.cast?.image?.prompt)) continue;
    const n = add(bundle, path, `cast:${id}`, (nid) => promptNode(nid, 'remote-imageGenerationNode', assetLabel.cast(c.name), { x: 0, y: row++ * gapY }, withNegative(c.cast.image), { ratio }));
    assets.set(`cast:${id}`, n);
  }
  row = 0;
  for (const [id, s] of names.scenes) {
    if (!clean(s.art?.image?.prompt)) continue;
    const y = row++ * gapY;
    const base = add(bundle, path, `art:${id}`, (nid) => promptNode(nid, 'remote-imageGenerationNode', assetLabel.scene(s.name), { x: gapX, y }, withNegative(s.art.image), { ratio }));
    assets.set(`art:${id}`, base);
    (s.art.lighting ?? []).forEach((l, i) => {
      if (!clean(l.prompt) || !clean(l.state)) return;
      const prompt = `参考 {{ref 1}} 的同一空间与陈设，只改变光照：\n${clean(l.prompt)}`;
      const v = add(bundle, path, `art:${id}:${clean(l.state)}`, (nid) => promptNode(nid, 'remote-imageGenerationNode', `${assetLabel.scene(s.name)}-${clean(l.state)}`, { x: gapX * (2 + i), y }, prompt, { ratio, referenceOrder: { in: [referenceKey(base.id, 'image')] } }));
      canvasOf(bundle, path).edges.push(edge(bundle.title, base, v));
    });
  }
  const propX = gapX * (2 + Math.max(0, ...[...names.scenes.values()].map((s) => (s.art?.lighting ?? []).length)));
  row = 0;
  for (const [id, p] of names.props) {
    if (!clean(p.art?.image?.prompt)) continue;
    const n = add(bundle, path, `prop:${id}`, (nid) => promptNode(nid, 'remote-imageGenerationNode', assetLabel.prop(p.name), { x: propX, y: row++ * gapY }, withNegative(p.art.image), { ratio: '1:1' }));
    assets.set(`prop:${id}`, n);
  }
  return assets;
}

/** seedance 附件标签 → 资产键。不给 --names 导出时标签就是 id（S02/C01/P01），给了就是显示名。 */
export function resolveAttachment(label, names) {
  const l = clean(label);
  if (names.chars.has(l)) return { key: `cast:${l}`, name: names.chars.get(l).name, kind: 'cast' };
  if (names.scenes.has(l)) return { key: `art:${l}`, name: names.scenes.get(l).name, kind: 'scene' };
  if (names.props.has(l)) return { key: `prop:${l}`, name: names.props.get(l).name, kind: 'prop' };
  for (const [map, prefix, kind] of [[names.chars, 'cast', 'cast'], [names.scenes, 'art', 'scene'], [names.props, 'prop', 'prop']]) {
    for (const [id, v] of map) if (v.name === l) return { key: `${prefix}:${id}`, name: v.name, kind };
  }
  return undefined;
}

/** seedance.md 分隔线以下是提示词正文；@图片k / @[图片k] 改写成 Toonflow 的 {{ref n}}。 */
export function seedanceBody(markdown) {
  const at = markdown.indexOf('\n---\n');
  return (at >= 0 ? markdown.slice(at + 5) : markdown).trim();
}
export function rewriteRefs(body, mapping, labels = {}) {
  return body
    .replace(/^@\[图片(\d+)\] = .*$/gm, (m, k) => (mapping.has(Number(k)) ? `{{ref ${mapping.get(Number(k))}}} = ${labels[k] ?? ''}`.trimEnd() : m))
    .replace(/@\[?图片(\d+)\]?/g, (m, k) => (mapping.has(Number(k)) ? `{{ref ${mapping.get(Number(k))}}}` : m));
}

function buildEpisodes(bundle, seedanceDir, names, assets, ratio) {
  const manifest = readJson(join(seedanceDir, 'seedance-manifest.json'));
  const rows = new Map();
  for (const seg of manifest) {
    const ep = Number(/^E(\d+)-/.exec(seg.segment)?.[1]);
    if (!Number.isInteger(ep)) { bundle.warnings.push({ level: 'error', message: `段号 ${seg.segment} 无法解析集数` }); continue; }
    const path = canvasPaths.episode(ep);
    const state = rows.get(ep) ?? { refs: new Map(), videos: 0 };
    rows.set(ep, state);
    const body = seedanceBody(readFileSync(join(seedanceDir, seg.segment, 'seedance.md'), 'utf8'));
    const mapping = new Map();
    const labels = {};
    const order = [];
    const sources = [];
    for (const a of seg.attachments ?? []) {
      const k = Number(/图片(\d+)/.exec(a.ref ?? '')?.[1]);
      if (a.kind === 'frame') { bundle.warnings.push({ level: 'error', message: `${seg.segment} ${a.ref} 是分镜图，第一版不建节点；请去掉分镜图后重新 export，或在 APP 里手动接线` }); continue; }
      const hit = resolveAttachment(a.label, names);
      if (!hit) { bundle.warnings.push({ level: 'error', message: `${seg.segment} ${a.ref} 的「${a.label}」对不上 cast/art/outline 里的任何角色、场景或道具` }); continue; }
      let ref = state.refs.get(hit.key);
      if (!ref) {
        const label = `引用-${assetLabel[hit.kind](hit.name)}`;
        ref = add(bundle, path, `ref:${ep}:${hit.key}`, (id) => node(id, 'remote-imageNode', label, { x: 0, y: state.refs.size * gapY }));
        state.refs.set(hit.key, ref);
        const asset = assets.get(hit.key);
        if (asset) bundle.refs[ref.id] = asset.id;
        else bundle.warnings.push({ level: 'warn', message: `资产画布没有「${label.slice(3)}」的生成节点（缺 cast/art 提示词），引用节点需要在 APP 里手动选图` });
      }
      const refKeyValue = referenceKey(ref.id, 'image');
      if (!order.includes(refKeyValue)) { order.push(refKeyValue); sources.push(ref); }
      mapping.set(k, order.indexOf(refKeyValue) + 1);
      labels[k] = ref.data.label;
    }
    const prompt = rewriteRefs(body, mapping, labels);
    const video = add(bundle, path, `seg:${seg.segment}`, (id) => promptNode(id, 'remote-videoGenerationNode', `第${ep}集-${seg.segment}`, { x: gapX * 1.5, y: state.videos++ * videoGapY }, prompt, {
      duration: Math.ceil(Number(seg.seconds) || 0) || undefined, ratio, referenceOrder: { in: order },
    }));
    for (const ref of sources) canvasOf(bundle, path).edges.push(edge(bundle.title, ref, video));
  }
}

export function build(dir, { title, ratio = '16:9', seedance } = {}) {
  const located = locateInputs(dir, title);
  const bundle = newBundle(located.title);
  const names = nameTables(located.inputs);
  buildScript(bundle, located.inputs, names);
  const assets = buildAssets(bundle, names, ratio);
  if (seedance) buildEpisodes(bundle, seedance, names, assets, ratio);
  return bundle;
}

/* ------------------------------------------------------------------ */
/* 校验                                                                  */
/* ------------------------------------------------------------------ */

const uuidRe = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export function validate(bundle) {
  const errors = [];
  if (bundle?.kind !== 'toonflow-bundle' || bundle.version !== 1) return ['不是 toonflow-bundle v1'];
  if (!clean(bundle.title)) errors.push('缺 title');
  const all = new Map();
  for (const [path, canvas] of Object.entries(bundle.canvases ?? {})) {
    if (!/\.json$/.test(path) || path.split('/').some((p) => p === '..' || p === 'assets' || p === '.agent') || path.startsWith('/')) errors.push(`画布路径不合法：${path}`);
    for (const n of canvas.nodes ?? []) {
      if (!uuidRe.test(n.id ?? '')) errors.push(`${path} 节点 id 不是 UUID：${n.id}`);
      if (all.has(n.id)) errors.push(`节点 id 重复：${n.id}`);
      all.set(n.id, { node: n, path });
      if (!handles[n.type]) errors.push(`${path} 节点 ${n.data?.label ?? n.id} 的类型不支持：${n.type}`);
      if (!clean(n.data?.label)) errors.push(`${path} 节点 ${n.id} 缺 label`);
    }
  }
  const ids = new Set();
  for (const [path, canvas] of Object.entries(bundle.canvases ?? {})) {
    const local = new Map((canvas.nodes ?? []).map((n) => [n.id, n]));
    const incoming = new Map();
    for (const e of canvas.edges ?? []) {
      if (ids.has(e.id)) errors.push(`连线 id 重复：${e.id}`);
      ids.add(e.id);
      const s = local.get(e.source);
      const t = local.get(e.target);
      if (!s || !t) { errors.push(`${path} 连线 ${e.id} 的端点不在同一画布`); continue; }
      if (e.sourceHandle !== sourceHandle[s.type] || e.targetHandle !== 'in') errors.push(`${path} 连线 ${s.data.label} → ${t.data.label} 端口不对`);
      (incoming.get(t.id) ?? incoming.set(t.id, []).get(t.id)).push(referenceKey(e.source, e.sourceHandle));
    }
    for (const n of canvas.nodes ?? []) {
      const label = n.data?.label ?? n.id;
      if (n.type === 'remote-textNode') {
        if (n.data.textPath !== textPathFor(n.id)) errors.push(`${label} 的 textPath 应为 ${textPathFor(n.id)}`);
        if (!clean(bundle.texts?.[n.id])) errors.push(`${label} 没有正文`);
      }
      if (n.type === 'remote-imageGenerationNode' || n.type === 'remote-videoGenerationNode') {
        if (!clean(n.data.prompt)) errors.push(`${label} 提示词为空`);
        if (JSON.stringify(n.data.promptModel) !== JSON.stringify(promptModel(n.data.prompt ?? ''))) errors.push(`${label} 的 promptModel 与 prompt 不一致`);
      }
      const order = n.data?.referenceOrder?.in ?? [];
      const inbound = incoming.get(n.id) ?? [];
      if (order.length !== inbound.length || order.some((k) => !inbound.includes(k))) errors.push(`${label} 的 referenceOrder 与入边不一致`);
      for (const m of String(n.data?.prompt ?? '').matchAll(/\{\{ref (\d+)\}\}/g)) {
        if (Number(m[1]) < 1 || Number(m[1]) > order.length) errors.push(`${label} 的 {{ref ${m[1]}}} 没有对应的连线`);
      }
    }
  }
  for (const id of Object.keys(bundle.texts ?? {})) if (all.get(id)?.node.type !== 'remote-textNode') errors.push(`texts 里的 ${id} 不是文本节点`);
  for (const [ref, asset] of Object.entries(bundle.refs ?? {})) {
    if (all.get(ref)?.node.type !== 'remote-imageNode') errors.push(`refs 的键 ${ref} 不是图片素材节点`);
    if (all.get(asset)?.node.type !== 'remote-imageGenerationNode') errors.push(`refs 的值 ${asset} 不是资产生成节点`);
  }
  for (const w of bundle.warnings ?? []) if (w.level === 'error') errors.push(w.message);
  return errors;
}

/* ------------------------------------------------------------------ */
/* CLI                                                                   */
/* ------------------------------------------------------------------ */

const usage = `用法：
  node toonflow-canvas.mjs build <目录> [--title 剧名] [--ratio 16:9] [--seedance <export 目录>] [--out <bundle.json>]
  node toonflow-canvas.mjs validate <bundle.json>

build 读 <目录> 下同剧名的 -outline / -cast / -art / -script.json（缺哪个就不产出对应节点），
--seedance 读 novel-storyboard export --protocol seedance 的输出目录；默认写到 <目录>/<剧名>-toonflow.json。`;

function summary(bundle) {
  return Object.entries(bundle.canvases).map(([path, c]) => {
    const count = {};
    for (const n of c.nodes) count[n.type] = (count[n.type] ?? 0) + 1;
    const parts = Object.entries(count).map(([t, k]) => `${t.replace('remote-', '')} ×${k}`);
    return `  ${path}：${parts.join('，')}${c.edges.length ? `，连线 ×${c.edges.length}` : ''}`;
  }).join('\n');
}

function main(argv) {
  const [command, target, ...rest] = argv;
  const opt = {};
  for (let i = 0; i < rest.length; i += 2) {
    const k = rest[i]?.replace(/^--/, '');
    if (!['title', 'ratio', 'seedance', 'out'].includes(k) || rest[i + 1] === undefined) throw new Error(`未知参数 ${rest[i]}\n${usage}`);
    opt[k] = rest[i + 1];
  }
  if (command === 'build' && target) {
    const bundle = build(resolve(target), { title: opt.title, ratio: opt.ratio, seedance: opt.seedance && resolve(opt.seedance) });
    const out = resolve(opt.out ?? join(target, `${bundle.title}-toonflow.json`));
    writeFileSync(out, `${JSON.stringify(bundle, null, 2)}\n`);
    const errors = validate(bundle);
    console.log(`${errors.length ? '✗' : '✓'} ${basename(out)}\n${summary(bundle)}`);
    for (const w of bundle.warnings.filter((w) => w.level === 'warn')) console.log(`  ⚠️ ${w.message}`);
    for (const e of errors) console.log(`  ✗ ${e}`);
    return errors.length ? 1 : 0;
  }
  if (command === 'validate' && target) {
    const errors = validate(readJson(resolve(target)));
    if (!errors.length) { console.log('✓ 通过校验'); return 0; }
    console.log(`✗ ${errors.length} 处违规：\n${errors.map((e) => `  ${e}`).join('\n')}`);
    return 1;
  }
  console.log(usage);
  return command ? 1 : 0;
}

// 两边都取 realpath：软链安装时 argv[1] 是链接路径，而 import.meta.url 是真实路径
const isMain = () => {
  try {
    return !!process.argv[1] && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
};
if (isMain()) {
  try {
    process.exitCode = main(process.argv.slice(2));
  } catch (error) {
    console.error(`✗ ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  }
}
