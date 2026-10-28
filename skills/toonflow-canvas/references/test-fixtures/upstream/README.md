# 上游产物夹具

这几份文件是上游 skill 样例的**拷贝**，只给 `scripts/selftest.mjs` 和 `examples/` 当输入使用，让本 skill 单独拷走也能跑自测。

- `渡口-outline.json` ← `novel-outline/examples/渡口-outline.json`
- `渡口-cast.json` ← `novel-characters/examples/渡口-cast.json`
- `渡口-art.json` ← `novel-art/examples/渡口-art.json`
- `渡口-script.json` ← `novel-script/examples/渡口-script.json`
- `渡口-storyboard.json` ← `novel-storyboard/examples/渡口-storyboard.json`
- `seedance/` ← 在本目录执行 `node <novel-storyboard>/scripts/novel-storyboard.mjs export 渡口-storyboard.json --script 渡口-script.json --protocol seedance --out seedance`

上游样例改了字段，这里不会自动跟上。需要时整份重新拷贝、重新 export，再跑自测并重新生成 `examples/渡口-toonflow.json`。
