# Toonflow 原生画布格式（对应 Toonflow-app af6e884）

学习来源：[HBAI-Ltd/Toonflow-app](https://github.com/HBAI-Ltd/Toonflow-app) 源码，提交 af6e884。下文的路径都指该仓库。Toonflow 改版后先对照这些位置复核，再改脚本。

## 工作目录

- 画布是 JSON：`{ "toonflowCanvas": true, "nodes": [], "edges": [], "viewport": { "x": 0, "y": 0, "zoom": 1 } }`。APP 递归扫描工作目录里除 `assets/`、`.agent/` 外的所有 `*.json`，带 `toonflowCanvas: true` 的就是画布（`apps/web/src/pages/workspace/panels/canvas/canvasFiles.ts`）
- 节点素材在 `assets/<节点 id>/`；文本节点正文是 `assets/<节点 id>/content.md`
- 内置 v118workflow 的画布习惯：`画布/剧本.json`（大纲与每集剧本）、`画布/资产.json`（全项目唯一资产画布）、`画布/分集/第001集.json`（按进度建）（`packages/skills/v118workflow/references/projectSetup.md`）
- Toonflow 没有文件监听：运行中的画布会被自动保存整份覆盖，外部改动必须在 APP 关闭时写入

## 节点

```json
{ "id": "<uuid>", "type": "remote-imageGenerationNode", "initialized": false, "position": { "x": 0, "y": 0 },
  "data": { "label": "角色-沈知微", "handles": [], "outputs": {}, "prompt": "…", "promptModel": [[{ "type": "Write", "text": "…" }]], "ratio": "16:9" } }
```

| 类型 | 端口（入 / 出） | 本 skill 写入的 data |
| --- | --- | --- |
| `remote-textNode` | `in` / `text` | `label`、`handles`、`outputs`、`textPath`、`promptModel` |
| `remote-imageGenerationNode` | `in`（IMAGE、STRING）/ `image` | 另加 `prompt`、`promptModel`、`ratio`、`referenceOrder` |
| `remote-videoGenerationNode` | `in`（IMAGE、VIDEO、AUDIO、STRING）/ `video` | 另加 `prompt`、`promptModel`、`duration`、`ratio`、`referenceOrder` |
| `remote-imageNode` | `in`（IMAGE）/ `image` | `label`、`handles`、`outputs` |

依据：

- 端口：各节点 `packages/nodes/*/src/index.vue` 的 `defineOptions.handles`；APP 自己保存的画布也把它写进 `data.handles`
- 缺省值：节点挂载时 `prompt`、`promptModel`、`model`、`mode` 等用 `??=` 补默认值；`model` 为空时自动选第一个可用模型；`mode` 按参考素材数量自动选；`duration` 不在模型支持列表里会被重置为最短时长（`packages/nodes/videoGenerationNode/src/index.vue`）。所以本 skill 不写 `model`、`mode`、`size`、`resolution`
- `outputs` 会持久化，加载时按端口与类型过滤（`packages/nodeScaffold/src/useNode.ts`）。图片输出结构 `{ "dataType": "IMAGE", "value": { "url": "assets/<id>/xxx.png", "mimeType": "image/png" } }`
- 画布自动保存只排除运行态字段，其他自定义字段保留（`apps/web/src/pages/workspace/panels/canvas/index.vue`）

## 提示词

`promptModel` 是按行的标签数组；纯文本提示词就是每行一个 Write 标签：`prompt.split("\n").map(text => [{ type: "Write", text }])`。APP 自己的 `setPrompt` 工具也是这样写的（`packages/nodes/videoGenerationNode/src/index.vue`）。生成时 `promptModel` 只有 Write 标签就原样拼回文本。

## 引用与 `{{ref N}}`

- 连线只能在同一画布内；跨画布复用资产的做法是在分集画布放图片素材节点，指向资产画布已生成的同一文件（`packages/skills/v118workflow/references/canvasOperations.md`）
- 连线：`{ "id": "<uuid>", "source": "<源 id>", "sourceHandle": "image", "target": "<目标 id>", "targetHandle": "in" }`
- 目标节点按 `in` 端口收集入边；`data.referenceOrder.in` 是键数组，键为 `encodeURIComponent(JSON.stringify([源 id, 源端口]))`。按它排序后第 N 项就是提示词里的 `{{ref N}}`，从 1 开始；未登记的入边排在最后（`packages/nodeShared/src/useNodeReferences.ts`）
- 引用的素材节点没有输出时，APP 拒绝生成并提示「引用节点暂无内容」
- 服务端只对白名单里的供应商转换 `{{ref N}}`（`apps/server/src/utils/media/generation.ts`），新接入的视频供应商需要加进白名单
