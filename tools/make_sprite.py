from PIL import Image
import sys
from pathlib import Path

def make_sprite(output, *inputs):
    if len(inputs) != 3:
        raise ValueError("必须传入 3 张图片文件路径")

    # 打开三张图片
    imgs = [Image.open(p).convert("RGBA") for p in inputs]

    # 以第一张为基准尺寸，其他图片统一缩放到相同大小（可按需要去掉这一步）
    base_w, base_h = imgs[0].size
    resized = [imgs[0]] + [im.resize((base_w, base_h), Image.LANCZOS) for im in imgs[1:]]

    # 创建目标雪碧图：横向 3 帧
    sheet_w = base_w * 3
    sheet_h = base_h
    sheet = Image.new("RGBA", (sheet_w, sheet_h), (0, 0, 0, 0))

    # 依次粘贴
    for i, im in enumerate(resized):
        sheet.paste(im, (i * base_w, 0))

    # 保存
    out_path = Path(output)
    out_path.parent.mkdir(parents=True, exist_ok=True)
    sheet.save(out_path, format="PNG")
    print(f"sprite saved to: {out_path.resolve()}")
    print(f"single frame size: {base_w}x{base_h}, total size: {sheet_w}x{sheet_h}")

if __name__ == "__main__":
    # 用法：python make_sprite.py 输出.png 图1.png 图2.png 图3.png
    if len(sys.argv) != 5:
        print("用法: python make_sprite.py 输出.png 图1.png 图2.png 图3.png")
        sys.exit(1)

    output = sys.argv[1]
    img1, img2, img3 = sys.argv[2], sys.argv[3], sys.argv[4]
    make_sprite(output, img1, img2, img3)