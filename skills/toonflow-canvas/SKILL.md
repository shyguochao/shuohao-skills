---
name: toonflow-canvas
version: 1.0.0
description: |
  把 novel-outline / novel-characters / novel-art / novel-script / novel-storyboard 的产出
  转成 Toonflow-app 的原生画布数据：大纲与剧本进文本节点，角色、场景、道具进图片生成节点，
  分镜段进视频生成节点并连好参考图，提示词里的 {{ref N}} 与连线顺序一致。
  产出一个 bundle（<剧名>-toonflow.json），由宿主工具合并写入工作目录，打开 Toonflow 即可直接生成。
  节点 id 由业务键确定性生成，改完上游再次转换只更新提示词与正文。
  校验全部由脚本确定性检查（id、端口、textPath、promptModel、referenceOrder 与入边、{{ref N}} 对应连线）。
  零依赖、零 API key，不出图。
  Use when asked to 导入 Toonflow、转成 Toonflow 画布、生成 Toonflow 节点、toonflow canvas、export to Toonflow。
allowed-tools:
  - Read
  - Write
  - Bash
  - Glob
triggers:
  - toonflow-canvas
  - Toonflow 画布
  - 导入 Toonflow
  - 转成 Toonflow
  - toonflow canvas
metadata:
  license: Apache-2.0
  requires:
    bins:
      - node          # >= 18，只使用标准库，无 npm 依赖
  runtimes:
    - claude-code
    - codex
---

## toonflow-canvas

`{baseDir}` = 本文件所在目录。脚本 `{baseDir}/scripts/toonflow-canvas.mjs`，零依赖，`node` 直接运行。

**边界**：本 skill 只做格式转换，不改剧情、不写提示词、不出图。提示词质量由上游 skill 负责；本 skill 原样搬运，只把 `@图片k` 改写成 Toonflow 的 `{{ref n}}`。不直接写 Toonflow 工作目录里的画布——Toonflow 运行时会自动保存整份画布，外部写入会被覆盖，写入交给宿主工具（例如 toonflow-assistant 的 `tfa import`）。

### Step 1 — 确认输入

数据放在同一个目录（通常是 `<Toonflow 工作目录>/shuohao/`），文件名 `<剧名>-<outline|cast|art|script>.json`，缺哪个就不产出对应节点：

| 输入 | 产出 |
| --- | --- |
| outline.json | `画布/剧本.json` 的大纲文本节点 |
| script.json | `画布/剧本.json` 每集一个剧本文本节点 |
| cast.json | `画布/资产.json` 每个角色一个图片生成节点 |
| art.json | `画布/资产.json` 每个场景、每个光照变体、每个道具一个图片生成节点 |
| seedance 投产包 | `画布/分集/第NNN集.json` 每段一个视频生成节点 + 引用资产的图片素材节点 |

要转分镜，先用 novel-storyboard 导出 Seedance 投产包（分镜图还没出时不要加 `--frames`）：

```bash
node <novel-storyboard>/scripts/novel-storyboard.mjs export <剧名>-storyboard.json --script <剧名>-script.json --protocol seedance --out seedance
```

### Step 2 — 转换

```bash
node {baseDir}/scripts/toonflow-canvas.mjs build <目录> [--title 剧名] [--ratio 16:9] [--seedance <目录>/seedance]
```

默认写到 `<目录>/<剧名>-toonflow.json`，并打印每个画布的节点数。`✗` 开头的行是违规，逐条修上游数据后重新 build；`⚠️` 是提示，不阻止写入。

常见违规：

- 附件对不上：seedance 的附件标签（S02/C01/P01 或显示名）在 outline/cast/art 里找不到——补齐上游数据或修正 id
- 分镜图附件：第一版只引用设定图，带分镜图的投产包请去掉 `--frames` 重新 export

### Step 3 — 校验 ⛔ 不能跳

```bash
node {baseDir}/scripts/toonflow-canvas.mjs validate <目录>/<剧名>-toonflow.json
```

通过才交给宿主工具写入。使用 toonflow-assistant 时：先停掉 Toonflow，执行 `tfa import --from shuohao/<剧名>-toonflow.json` 预览，确认后加 `--apply`。

### Step 4 — 汇报

一句话说清：几个画布、各多少节点和连线、有哪些提示与违规、bundle 路径。

## 再次转换

上游改了就重新 build。节点 id 由「剧名 + 业务键」确定性生成（`cast:C01`、`art:S01:晨雾`、`seg:E01-03`……），同一份数据重复转换得到同样的 id，宿主工具按 id 原地更新，APP 里移动过的位置和已生成的图片、视频保留。改了剧名等于换了一套 id。

## 参考

- `references/schema.md` — bundle 结构与业务键
- `references/toonflow-format.md` — Toonflow 原生节点、连线、引用规则（对应 Toonflow-app af6e884）

## 自测

```bash
node {baseDir}/scripts/selftest.mjs
```

不调模型、不花额度。每条校验规则都有击穿用例。

## 自带样例

`{baseDir}/examples/渡口-toonflow.json`：短故事《渡口》的大纲、角色、美术、剧本和 10 段分镜转换结果——剧本画布 7 个文本节点，资产画布 13 个图片生成节点，第 1 集画布 10 个视频节点、7 个引用节点、42 条连线，全部通过校验。
