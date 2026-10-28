# bundle 结构（`<剧名>-toonflow.json`）

本 skill 唯一的产物。它不是 Toonflow 画布（没有 `toonflowCanvas` 标记），Toonflow 扫描工作目录时会跳过它。

```json
{
  "kind": "toonflow-bundle",
  "version": 1,
  "title": "渡口",
  "toonflowFormat": "af6e884",
  "canvases": {
    "画布/剧本.json": { "nodes": [], "edges": [] },
    "画布/资产.json": { "nodes": [], "edges": [] },
    "画布/分集/第001集.json": { "nodes": [], "edges": [] }
  },
  "texts": { "<文本节点 id>": "# 第1集剧本\n…" },
  "keys": { "outline": "<id>", "cast:C01": "<id>", "seg:E01-01": "<id>" },
  "refs": { "<引用节点 id>": "<资产生成节点 id>" },
  "warnings": [{ "level": "warn", "message": "…" }]
}
```

| 字段 | 说明 |
| --- | --- |
| `canvases` | 画布相对路径 → 节点与连线。节点、连线的格式见 `toonflow-format.md`，不含 `viewport`（由宿主新建画布时补） |
| `texts` | 文本节点 id → 正文 Markdown，宿主写到 `assets/<id>/content.md` |
| `keys` | 业务键 → 节点 id |
| `refs` | 分集画布的图片素材节点 → 资产画布里对应的生成节点。资产出图后，宿主可把生成节点的 `outputs.image` 回填到素材节点 |
| `warnings` | `level: "error"` 会让 `validate` 失败；`warn` 只是提示 |

## 业务键

节点 id = 由 `剧名 + 业务键` 经 sha1 截成的 UUID（版本位固定为 5）。同一剧名同一键永远得到同一 id。

| 业务键 | 节点 |
| --- | --- |
| `outline` | 大纲文本节点 |
| `script:<集>` | 每集剧本文本节点 |
| `cast:<角色 id>` | 角色图片生成节点 |
| `art:<场景 id>` | 场景图片生成节点 |
| `art:<场景 id>:<光照状态>` | 场景光照变体，连线自母场景，提示词以 `{{ref 1}}` 引用母场景 |
| `prop:<道具 id>` | 道具图片生成节点（`ratio` 固定 1:1） |
| `seg:<段号>` | 分镜段视频生成节点 |
| `ref:<集>:<资产键>` | 分集画布里引用该资产的图片素材节点，同一集内每个资产只建一个 |

连线 id 同样确定性生成，键为 `edge:<源 id>-><目标 id>`。

## 角色 id

outline.json 的 `characters[].id` 为准；cast.json 不带 id，按姓名对回 outline。没有 outline 时按 cast.json 的顺序编 `C01`、`C02`……

## 校验规则（`validate`）

- `kind` / `version` / `title`
- 画布路径以 `.json` 结尾，不在 `assets/`、`.agent/` 下，不含 `..`
- 节点 id 是 UUID 且全 bundle 唯一；类型只限 text / imageGeneration / videoGeneration / image 四种；`label` 非空
- 文本节点 `textPath = assets/<id>/content.md`，且 `texts` 里有正文；`texts` 的键都是文本节点
- 生成节点提示词非空，`promptModel` 与 `prompt` 逐行一致
- 连线 id 唯一，两端在同一画布，源端口与节点类型匹配，目标端口为 `in`
- 每个节点的 `referenceOrder.in` 与入边一一对应；提示词里每个 `{{ref N}}` 都在 1..入边数之内
- `refs` 的键是图片素材节点、值是图片生成节点
- `warnings` 里没有 `error`
