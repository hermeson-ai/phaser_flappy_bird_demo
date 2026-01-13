from PIL import Image
import sys
from pathlib import Path
import math

def gif_to_sprite(gif_path, output_path, max_frames=40, frames_per_row=None):
    """
    将 GIF 的前 N 帧提取并拼接成雪碧图
    
    参数:
        gif_path: GIF 文件路径
        output_path: 输出 PNG 文件路径
        max_frames: 提取的最大帧数（默认 40）
        frames_per_row: 每行放置的帧数（None 表示自动计算，尽量接近正方形）
    """
    # 打开 GIF
    try:
        gif = Image.open(gif_path)
    except Exception as e:
        print(f"错误：无法打开 GIF 文件: {e}")
        sys.exit(1)
    
    # 检查是否为 GIF
    if not hasattr(gif, 'is_animated') or not gif.is_animated:
        print("警告：该文件不是动画 GIF，将只提取第一帧")
        frames_to_extract = 1
    else:
        frames_to_extract = min(max_frames, gif.n_frames)
    
    print(f"GIF 总帧数: {gif.n_frames}")
    print(f"将提取前 {frames_to_extract} 帧")
    
    # 提取所有帧
    frames = []
    for i in range(frames_to_extract):
        gif.seek(i)
        # 转换为 RGBA 模式以支持透明背景
        frame = gif.convert("RGBA")
        frames.append(frame.copy())
    
    # 获取第一帧的尺寸（假设所有帧尺寸相同）
    base_w, base_h = frames[0].size
    print(f"单帧尺寸: {base_w}x{base_h}")
    
    # 如果所有帧尺寸不一致，统一缩放到第一帧的尺寸
    resized_frames = []
    for i, frame in enumerate(frames):
        if frame.size != (base_w, base_h):
            print(f"警告：第 {i+1} 帧尺寸为 {frame.size}，将缩放至 {base_w}x{base_h}")
            frame = frame.resize((base_w, base_h), Image.LANCZOS)
        resized_frames.append(frame)
    
    # 计算布局：如果未指定每行帧数，自动计算（尽量接近正方形）
    if frames_per_row is None:
        # 计算最接近正方形的布局
        frames_per_row = int(math.ceil(math.sqrt(frames_to_extract)))
    
    rows = math.ceil(frames_to_extract / frames_per_row)
    
    # 创建雪碧图
    sheet_w = base_w * frames_per_row
    sheet_h = base_h * rows
    sheet = Image.new("RGBA", (sheet_w, sheet_h), (0, 0, 0, 0))
    
    # 依次粘贴每一帧
    for i, frame in enumerate(resized_frames):
        row = i // frames_per_row
        col = i % frames_per_row
        x = col * base_w
        y = row * base_h
        sheet.paste(frame, (x, y), frame)  # 使用 frame 作为 mask 以支持透明
    
    # 保存
    out_path = Path(output_path)
    out_path.parent.mkdir(parents=True, exist_ok=True)
    sheet.save(out_path, format="PNG")
    
    print(f"\n✓ 雪碧图已保存到: {out_path.resolve()}")
    print(f"  单帧尺寸: {base_w}x{base_h}")
    print(f"  总帧数: {frames_to_extract}")
    print(f"  布局: {frames_per_row} 帧/行 × {rows} 行")
    print(f"  总尺寸: {sheet_w}x{sheet_h}")

if __name__ == "__main__":
    if len(sys.argv) < 3:
        print("用法: python gif_to_sprite.py <输入GIF文件> <输出PNG文件> [最大帧数] [每行帧数]")
        print("\n示例:")
        print("  python gif_to_sprite.py input.gif output.png")
        print("  python gif_to_sprite.py input.gif output.png 40")
        print("  python gif_to_sprite.py input.gif output.png 40 10")
        sys.exit(1)
    
    gif_path = sys.argv[1]
    output_path = sys.argv[2]
    max_frames = int(sys.argv[3]) if len(sys.argv) > 3 else 40
    frames_per_row = int(sys.argv[4]) if len(sys.argv) > 4 else None
    
    gif_to_sprite(gif_path, output_path, max_frames, frames_per_row)

