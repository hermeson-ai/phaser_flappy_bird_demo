from PIL import Image
import sys
from pathlib import Path


def _clean_path(p):
    """去掉路径前可能带的 @ 前缀"""
    if isinstance(p, str) and p.startswith('@'):
        return p[1:]
    return p


def black_to_transparent(input_path, output_path=None, threshold=0):
    """把 PNG 里"黑色/近黑色"像素改成透明像素。

    判定规则：当 (R<=threshold 且 G<=threshold 且 B<=threshold) 且 alpha>0 时，将 alpha 置为 0。

    参数:
        input_path: 输入图片路径
        output_path: 输出图片路径（None 则默认在同目录生成 *_transparent.png）
        threshold: 近黑阈值（0 表示仅纯黑）
    """
    input_path = Path(_clean_path(input_path))
    if output_path is None:
        output_path = input_path.with_name(f"{input_path.stem}_transparent{input_path.suffix}")
    else:
        output_path = Path(_clean_path(output_path))

    # 打开并转 RGBA
    try:
        img = Image.open(input_path).convert("RGBA")
    except Exception as e:
        print(f"错误：无法打开图片: {input_path} ({e})")
        sys.exit(1)

    w, h = img.size
    pixels = img.load()

    changed = 0
    total = w * h

    for y in range(h):
        for x in range(w):
            r, g, b, a = pixels[x, y]
            if a == 0:
                continue
            if r <= threshold and g <= threshold and b <= threshold:
                pixels[x, y] = (r, g, b, 0)
                changed += 1

    output_path.parent.mkdir(parents=True, exist_ok=True)
    img.save(output_path, format="PNG")

    ratio = (changed / total) * 100 if total else 0
    print(f"输入: {input_path}")
    print(f"输出: {output_path.resolve()}")
    print(f"阈值: {threshold}")
    print(f"已透明化像素: {changed:,} / {total:,} ({ratio:.2f}%)")


def remove_black_background_glow(input_path, output_path=None, feather=0):
    """
    移除黑色背景并保留光晕效果（适用于在任意背景上叠加）。

    核心思路：
    光晕图的特点是「黑底 + 发光色」。我们需要把它变成「透明底 + 发光色」。
    
    关键：**把颜色"提亮"到最大饱和度，用原始亮度作为透明度**
    
    这样：
    - 原本暗淡的边缘（如 RGB=(20,30,15)）会变成 亮绿色 + 低透明度
    - 原本明亮的中心（如 RGB=(200,255,100)）会变成 亮绿色 + 高透明度
    - 纯黑变成完全透明
    
    在任何背景上，光晕都会以「加法」的方式叠加，不会出现暗色边缘。

    参数:
        input_path: 输入图片路径
        output_path: 输出图片路径
        feather: 边缘羽化像素数，让图片边缘平滑过渡到透明（默认 0）
    """
    input_path = Path(_clean_path(input_path))
    if output_path is None:
        output_path = input_path.with_name(f"{input_path.stem}_glow{input_path.suffix}")
    else:
        output_path = Path(_clean_path(output_path))

    try:
        img = Image.open(input_path).convert("RGBA")
    except Exception as e:
        print(f"错误：无法打开图片: {input_path} ({e})")
        sys.exit(1)

    w, h = img.size
    pixels = img.load()

    changed = 0
    total = w * h

    for y in range(h):
        for x in range(w):
            r, g, b, a = pixels[x, y]

            # 用 RGB 最大值作为亮度/alpha
            max_val = max(r, g, b)
            
            if max_val == 0:
                # 纯黑 -> 完全透明
                pixels[x, y] = (0, 0, 0, 0)
                changed += 1
            else:
                # 关键：把颜色"提亮"到最大亮度
                # 这样 (20, 30, 15) 会变成 (170, 255, 127)
                # 原始的"暗"会体现在 alpha 上，而不是颜色上
                scale = 255.0 / max_val
                new_r = min(255, int(r * scale))
                new_g = min(255, int(g * scale))
                new_b = min(255, int(b * scale))
                
                # alpha = 原始亮度
                new_alpha = max_val
                
                # 如果启用了边缘羽化
                if feather > 0:
                    dist_to_edge = min(x, y, w - 1 - x, h - 1 - y)
                    if dist_to_edge < feather:
                        edge_factor = dist_to_edge / feather
                        new_alpha = int(new_alpha * edge_factor)
                
                pixels[x, y] = (new_r, new_g, new_b, new_alpha)
                changed += 1

    output_path.parent.mkdir(parents=True, exist_ok=True)
    img.save(output_path, format="PNG")

    ratio = (changed / total) * 100 if total else 0
    print(f"输入: {input_path}")
    print(f"输出: {output_path.resolve()}")
    print(f"模式: 光晕提取 (--glow)")
    if feather > 0:
        print(f"边缘羽化: {feather}px")
    print(f"已处理像素: {changed:,} / {total:,} ({ratio:.2f}%)")


if __name__ == "__main__":
    if len(sys.argv) < 2:
        print("用法: python3 black_to_transparent.py <输入PNG> [输出PNG] [选项]")
        print("\n选项:")
        print("  --threshold, -t <0-255>  近黑阈值（默认 0，仅纯黑）[默认模式]")
        print("  --glow, -g               光晕模式：移除黑底并保留半透明光晕效果")
        print("  --feather, -f <像素>     边缘羽化：让图片边缘平滑过渡到透明（配合 --glow 使用）")
        print("\n说明:")
        print("  默认模式：把纯黑/近黑像素直接变透明（适合有明确边界的图）")
        print("  光晕模式：适用于「黑底 + 光晕」的图片")
        print("           将亮度转换为透明度，使光晕能与任意背景自然融合")
        print("           如果光晕在图片边缘被截断，使用 --feather 添加羽化效果")
        print("\n示例:")
        print("  python3 tools/black_to_transparent.py 'input.png' 'output.png'")
        print("  python3 tools/black_to_transparent.py 'input.png' --threshold 10")
        print("  python3 tools/black_to_transparent.py 'glow.png' 'out.png' --glow")
        print("  python3 tools/black_to_transparent.py 'glow.png' 'out.png' --glow --feather 30")
        sys.exit(1)

    input_path = sys.argv[1]

    output_path = None
    threshold = 0
    glow_mode = False
    feather = 0

    i = 2
    while i < len(sys.argv):
        arg = sys.argv[i]
        if arg in ["--threshold", "-t"]:
            if i + 1 < len(sys.argv):
                threshold = int(sys.argv[i + 1])
                if threshold < 0 or threshold > 255:
                    print("错误：threshold 必须在 0-255 之间")
                    sys.exit(1)
                i += 2
            else:
                print(f"错误：{arg} 需要一个值")
                sys.exit(1)
        elif arg in ["--feather", "-f"]:
            if i + 1 < len(sys.argv):
                feather = int(sys.argv[i + 1])
                if feather < 0:
                    print("错误：feather 必须 >= 0")
                    sys.exit(1)
                i += 2
            else:
                print(f"错误：{arg} 需要一个值")
                sys.exit(1)
        elif arg in ["--glow", "-g"]:
            glow_mode = True
            i += 1
        elif arg in ["--black", "-b"]:
            # 兼容旧参数，但现在忽略
            if i + 1 < len(sys.argv):
                i += 2
            else:
                i += 1
        else:
            if output_path is None:
                output_path = arg
            else:
                print(f"错误：无法识别的参数: {arg}")
                sys.exit(1)
            i += 1

    if glow_mode:
        remove_black_background_glow(input_path, output_path, feather)
    else:
        black_to_transparent(input_path, output_path, threshold)
