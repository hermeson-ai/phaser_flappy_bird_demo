from PIL import Image
import sys
from pathlib import Path


def resize_gif(input_path, output_path=None, width=None, height=None, scale=None):
    """
    按比例缩放 GIF，保持原始宽高比
    
    参数:
        input_path: 输入 GIF 文件路径
        output_path: 输出 GIF 文件路径（None 则覆盖原文件）
        width: 目标宽度（像素）。如果指定此项，高度会自动计算
        height: 目标高度（像素）。如果指定此项，宽度会自动计算
        scale: 缩放因子（0-1）。例如 0.5 表示缩小到 50%
               优先级低于 width/height
    """
    input_path = Path(input_path)
    
    if output_path is None:
        output_path = input_path
    else:
        output_path = Path(output_path)
    
    # 打开 GIF
    try:
        gif = Image.open(input_path)
    except Exception as e:
        print(f"错误：无法打开 GIF 文件: {e}")
        sys.exit(1)
    
    # 检查是否为动画 GIF
    is_animated = hasattr(gif, 'is_animated') and gif.is_animated
    n_frames = gif.n_frames if is_animated else 1
    
    orig_w, orig_h = gif.size
    aspect_ratio = orig_w / orig_h
    
    print(f"输入文件: {input_path}")
    print(f"原始尺寸: {orig_w}x{orig_h}")
    print(f"帧数: {n_frames}")
    print(f"宽高比: {aspect_ratio:.2f}")
    
    # 计算目标尺寸
    if width and height:
        # 两个都指定，选择更小的缩放因子（防止变形）
        scale_w = width / orig_w
        scale_h = height / orig_h
        scale_factor = min(scale_w, scale_h)
    elif width:
        scale_factor = width / orig_w
    elif height:
        scale_factor = height / orig_h
    elif scale:
        scale_factor = scale
    else:
        print("错误：必须指定 width、height 或 scale 中的至少一个")
        sys.exit(1)
    
    # 确保缩放因子有效
    if scale_factor <= 0:
        print("错误：缩放因子必须大于 0")
        sys.exit(1)
    
    new_w = int(orig_w * scale_factor)
    new_h = int(orig_h * scale_factor)
    
    # 至少 1 像素
    new_w = max(1, new_w)
    new_h = max(1, new_h)
    
    print(f"缩放因子: {scale_factor:.2%}")
    print(f"新尺寸: {new_w}x{new_h}")
    
    # 如果尺寸没有变化，跳过
    if new_w == orig_w and new_h == orig_h:
        print("尺寸已经是目标尺寸，无需缩放")
        return
    
    # 缩放所有帧
    resized_frames = []
    durations = []
    
    for i in range(n_frames):
        gif.seek(i)
        frame = gif.convert("RGBA")
        
        # 使用高质量的 LANCZOS 缩放
        resized = frame.resize((new_w, new_h), Image.LANCZOS)
        resized_frames.append(resized)
        
        # 获取帧持续时间
        duration = gif.info.get('duration', 100)
        durations.append(duration)
    
    # 保存缩放后的 GIF
    output_path.parent.mkdir(parents=True, exist_ok=True)
    
    if len(resized_frames) == 1:
        # 单帧图像
        resized_frames[0].save(output_path, format="GIF")
    else:
        # 动画 GIF
        resized_frames[0].save(
            output_path,
            format="GIF",
            save_all=True,
            append_images=resized_frames[1:],
            duration=durations,
            loop=gif.info.get('loop', 0),
            disposal=2  # 清除前一帧
        )
    
    # 计算文件大小变化
    orig_size = input_path.stat().st_size
    new_size = output_path.stat().st_size
    saved = orig_size - new_size
    saved_percent = (saved / orig_size) * 100 if orig_size > 0 else 0
    
    print(f"\n✓ 缩放后的 GIF 已保存到: {output_path.resolve()}")
    print(f"  尺寸: {orig_w}x{orig_h} -> {new_w}x{new_h}")
    print(f"  文件大小: {orig_size:,} bytes -> {new_size:,} bytes")
    if saved > 0:
        print(f"  节省空间: {saved:,} bytes ({saved_percent:.1f}%)")
    else:
        print(f"  增加大小: {abs(saved):,} bytes ({abs(saved_percent):.1f}%)")


if __name__ == "__main__":
    if len(sys.argv) < 2:
        print("用法: python resize_gif.py <输入GIF文件> [输出GIF文件] [--width <宽> | --height <高> | --scale <缩放因子>]")
        print("\n参数:")
        print("  输入GIF文件: 要缩放的 GIF 文件路径")
        print("  输出GIF文件: 输出文件路径（可选，默认覆盖原文件）")
        print("  --width <宽>: 目标宽度（像素），高度自动计算")
        print("  --height <高>: 目标高度（像素），宽度自动计算")
        print("  --scale <缩放因子>: 缩放因子，如 0.5 表示缩小到 50%")
        print("\n示例:")
        print("  python resize_gif.py input.gif --scale 0.5")
        print("  python resize_gif.py input.gif output.gif --width 100")
        print("  python resize_gif.py input.gif output.gif --height 200")
        print("  python resize_gif.py input.gif output.gif --scale 2")
        sys.exit(1)
    
    input_path = sys.argv[1]
    output_path = None
    width = None
    height = None
    scale = None
    
    # 解析参数
    i = 2
    while i < len(sys.argv):
        arg = sys.argv[i]
        
        if arg in ['--width', '-w']:
            if i + 1 < len(sys.argv):
                width = int(sys.argv[i + 1])
                i += 2
            else:
                print(f"错误：{arg} 需要一个值")
                sys.exit(1)
        elif arg in ['--height', '-h']:
            if i + 1 < len(sys.argv):
                height = int(sys.argv[i + 1])
                i += 2
            else:
                print(f"错误：{arg} 需要一个值")
                sys.exit(1)
        elif arg in ['--scale', '-s']:
            if i + 1 < len(sys.argv):
                scale = float(sys.argv[i + 1])
                i += 2
            else:
                print(f"错误：{arg} 需要一个值")
                sys.exit(1)
        else:
            # 假设是输出文件路径
            if output_path is None:
                output_path = arg
            i += 1
    
    resize_gif(input_path, output_path, width, height, scale)
