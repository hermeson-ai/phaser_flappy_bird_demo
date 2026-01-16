# 项目使用说明（中文）

本项目基于 Phaser 3，实现了多个小游戏场景，并配套了一套 GIF/雪碧图处理工具。本文档只介绍 `tools/` 目录下的实用脚本，以及如何安装依赖并启动项目。

---

## 一、工具脚本说明（tools/）

| 脚本 | 用途 | 典型用法 |
| ---- | ---- | ---- |
| `trim_gif.py` | 自动裁剪 GIF 四周透明像素，可指定保留边距 | `python tools/trim_gif.py input.gif output.gif 5` |
| `resize_gif.py` | 按等比缩放 GIF，支持指定目标宽/高或缩放系数，保留全部帧 | `python tools/resize_gif.py input.gif output.gif --scale 0.5` |
| `gif_to_sprite.py` | 将 GIF 指定起始帧后的若干帧转成雪碧图，支持控制每行帧数 | `python tools/gif_to_sprite.py walk.gif walk_sprite.png 20 5 60` |
| `batch_gif_to_sprite.sh` | 批量转换目录下所有 GIF 为雪碧图，命名为 `sprite_*.png` | `./tools/batch_gif_to_sprite.sh ./assets 40 8` |
| `make_sprite.py` | 根据帧图片生成雪碧图（按序号拼接），适合同尺寸 PNG 序列 | `python tools/make_sprite.py ./frames sprite.png --cols 8` |

> 说明：
> - Python 脚本默认使用 `python` 或 `python3` 执行，依赖 Pillow (`pip install pillow`).
> - `batch_gif_to_sprite.sh` 需要可执行权限 `chmod +x tools/batch_gif_to_sprite.sh`。

---

## 二、安装依赖与部署

1. **安装静态服务器**（仅需一次）：
   ```bash
   npm install -g http-server
   ```

2. **进入项目目录并启动**（建议禁用缓存，方便看到最新修改）：
   ```bash
   cd flappy-bird
   http-server -c-1
   # 或者
   npx http-server -c-1
   ```

3. **访问游戏**：浏览器打开 `http://localhost:8080`（默认端口）。

如需部署到生产环境，可将 `http-server` 命令替换为任意静态托管方式（例如 Vercel、Netlify），原则是确保产物文件都可通过 HTTP 直接访问。
