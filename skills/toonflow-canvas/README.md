# toonflow-canvas

把 novel-* 系列 skill 的产出转成 [Toonflow-app](https://github.com/HBAI-Ltd/Toonflow-app) 的原生画布数据，打开 Toonflow 就能直接点生成：

| 上游 | Toonflow 画布 | 节点 |
| --- | --- | --- |
| novel-outline | `画布/剧本.json` | 大纲文本节点 |
| novel-script | `画布/剧本.json` | 每集一个剧本文本节点 |
| novel-characters | `画布/资产.json` | 每个角色一个图片生成节点（形象提示词 + 反向提示词） |
| novel-art | `画布/资产.json` | 每个场景、光照变体、道具一个图片生成节点；变体连线自母场景 |
| novel-storyboard（Seedance 投产包） | `画布/分集/第NNN集.json` | 每段一个视频生成节点，连好引用资产的图片素材节点，`{{ref N}}` 与连线顺序一致 |

产物是一个 bundle 文件 `<剧名>-toonflow.json`，由宿主工具合并写入 Toonflow 工作目录（Toonflow 运行时会自动保存覆盖外部改动，写入前要先关闭它）。节点 id 由「剧名 + 业务键」确定性生成，上游改完再转换只更新提示词与正文，APP 里的布局与生成结果保留。

## 命令行直接使用

```bash
# 可选：先导出分镜的 Seedance 投产包
node ../novel-storyboard/scripts/novel-storyboard.mjs export 渡口-storyboard.json --script 渡口-script.json --protocol seedance --out seedance

node scripts/toonflow-canvas.mjs build <目录> [--title 剧名] [--ratio 16:9] [--seedance <目录>/seedance]
node scripts/toonflow-canvas.mjs validate <目录>/<剧名>-toonflow.json
node scripts/selftest.mjs
```

格式依据见 [references/toonflow-format.md](references/toonflow-format.md)，bundle 结构见 [references/schema.md](references/schema.md)。

零依赖（Node.js ≥ 18 标准库），不调模型、不出图。
