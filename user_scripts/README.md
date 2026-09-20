# 油猴脚本

装好 [Tampermonkey](https://www.tampermonkey.net/)，然后点：[**安装线程撕裂者**](https://raw.githubusercontent.com/NiseMonox/Bilibili-thread-ripper/main/user_scripts/bilibili-thread-ripper.user.js)

设置：点油猴图标 → 线程撕裂者设置

- `bilibili-thread-ripper.user.js`：脚本本体，由 `scripts/build-userscript.ps1` 生成，别手改
- `adapter/`：让扩展代码能在油猴里跑的三个小文件（存设置、设置页、启动）
