from PIL import Image
import sys
from pathlib import Path


def get_bounding_box(img):
    """
    获取图像中非透明像素的边界框
    返回 (left, top, right, bottom) 或 None（如果图像完全透明）
    """
    # 确保是 RGBA 模式
    if img.mode != "RGBA":
        img = img.convert("RGBA")
    
    # 获取 alpha 通道
    alpha = img.split()[3]
    
    # 获取非透明像素的边界框
    bbox = alpha.getbbox()
    return bbox


def trim_gif(input_path, output_path=None, padding=0):
    """
    裁剪 GIF 中所有帧的透明像素边缘
    
    参数:
        input_path: 输入 GIF 文件路径
        output_path: 输出 GIF 文件路径（None 则覆盖原文件）
        padding: 裁剪后保留的边距像素数（默认 0）
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
    
    print(f"输入文件: {input_path}")
    print(f"原始尺寸: {gif.size[0]}x{gif.size[1]}")
    print(f"帧数: {n_frames}")
    
    # 第一遍：遍历所有帧，找到包含所有非透明像素的最小边界框
    global_bbox = None
    
    for i in range(n_frames):
        gif.seek(i)
        frame = gif.convert("RGBA")
        bbox = get_bounding_box(frame)
        
        if bbox is not None:
            if global_bbox is None:
                global_bbox = bbox
            else:
                # 扩展边界框以包含当前帧的内容
                global_bbox = (
                    min(global_bbox[0], bbox[0]),
                    min(global_bbox[1], bbox[1]),
                    max(global_bbox[2], bbox[2]),
                    max(global_bbox[3], bbox[3])
                )
    
    if global_bbox is None:
        print("警告：GIF 中所有帧都是完全透明的，无法裁剪")
        return
    
    # 添加 padding
    orig_w, orig_h = gif.size
    left = max(0, global_bbox[0] - padding)
    top = max(0, global_bbox[1] - padding)
    right = min(orig_w, global_bbox[2] + padding)
    bottom = min(orig_h, global_bbox[3] + padding)
    
    crop_bbox = (left, top, right, bottom)
    new_w = right - left
    new_h = bottom - top
    
    print(f"裁剪区域: left={left}, top={top}, right={right}, bottom={bottom}")
    print(f"新尺寸: {new_w}x{new_h}")
    
    # 如果尺寸没有变化，跳过
    if new_w == orig_w and new_h == orig_h:
        print("图像已经是最小尺寸，无需裁剪")
        return
    
    # 第二遍：裁剪所有帧
    cropped_frames = []
    durations = []
    
    for i in range(n_frames):
        gif.seek(i)
        frame = gif.convert("RGBA")
        cropped = frame.crop(crop_bbox)
        cropped_frames.append(cropped)
        
        # 获取帧持续时间
        duration = gif.info.get('duration', 100)
        durations.append(duration)
    
    # 保存裁剪后的 GIF
    output_path.parent.mkdir(parents=True, exist_ok=True)
    
    if len(cropped_frames) == 1:
        # 单帧图像
        cropped_frames[0].save(output_path, format="GIF")
    else:
        # 动画 GIF
        cropped_frames[0].save(
            output_path,
            format="GIF",
            save_all=True,
            append_images=cropped_frames[1:],
            duration=durations,
            loop=gif.info.get('loop', 0),
            disposal=2  # 清除前一帧
        )
    
    # 计算节省的空间
    orig_size = input_path.stat().st_size
    new_size = output_path.stat().st_size
    saved = orig_size - new_size
    saved_percent = (saved / orig_size) * 100 if orig_size > 0 else 0
    
    print(f"\n✓ 裁剪后的 GIF 已保存到: {output_path.resolve()}")
    print(f"  原始尺寸: {orig_w}x{orig_h} -> 新尺寸: {new_w}x{new_h}")
    print(f"  文件大小: {orig_size:,} bytes -> {new_size:,} bytes")
    print(f"  节省空间: {saved:,} bytes ({saved_percent:.1f}%)")


if __name__ == "__main__":
    if len(sys.argv) < 2:
        print("用法: python trim_gif.py <输入GIF文件> [输出GIF文件] [padding]")
        print("\n参数:")
        print("  输入GIF文件: 要裁剪的 GIF 文件路径")
        print("  输出GIF文件: 输出文件路径（可选，默认覆盖原文件）")
        print("  padding: 裁剪后保留的边距像素数（可选，默认 0）")
        print("\n示例:")
        print("  python trim_gif.py input.gif")
        print("  python trim_gif.py input.gif output.gif")
        print("  python trim_gif.py input.gif output.gif 5")
        sys.exit(1)
    
    input_path = sys.argv[1]
    output_path = sys.argv[2] if len(sys.argv) > 2 else None
    padding = int(sys.argv[3]) if len(sys.argv) > 3 else 0
    
    trim_gif(input_path, output_path, padding)
