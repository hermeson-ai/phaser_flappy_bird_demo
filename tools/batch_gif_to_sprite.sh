#!/bin/bash

# 批量将 GIF 文件转换为雪碧图
# 用法: ./batch_gif_to_sprite.sh <目录路径> [最大帧数] [每行帧数]

set -e

# 检查参数
if [ $# -lt 1 ]; then
    echo "用法: ./batch_gif_to_sprite.sh <目录路径> [最大帧数] [每行帧数]"
    echo ""
    echo "参数:"
    echo "  目录路径: 包含 GIF 文件的目录"
    echo "  最大帧数: 提取的最大帧数（可选，默认 40）"
    echo "  每行帧数: 每行放置的帧数（可选，默认自动计算）"
    echo ""
    echo "示例:"
    echo "  ./batch_gif_to_sprite.sh ./assets"
    echo "  ./batch_gif_to_sprite.sh ./assets 40"
    echo "  ./batch_gif_to_sprite.sh ./assets 40 10"
    exit 1
fi

DIR_PATH="$1"
MAX_FRAMES="${2:-40}"
FRAMES_PER_ROW="${3:-}"

# 检查目录是否存在
if [ ! -d "$DIR_PATH" ]; then
    echo "错误：目录不存在: $DIR_PATH"
    exit 1
fi

# 获取脚本所在目录
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# 获取 Python 脚本路径
GIF_TO_SPRITE_PY="$SCRIPT_DIR/gif_to_sprite.py"

if [ ! -f "$GIF_TO_SPRITE_PY" ]; then
    echo "错误：找不到 gif_to_sprite.py: $GIF_TO_SPRITE_PY"
    exit 1
fi

# 统计处理结果
total=0
success=0
failed=0

echo "开始批量转换 GIF 为雪碧图..."
echo "目录: $DIR_PATH"
echo "最大帧数: $MAX_FRAMES"
[ -n "$FRAMES_PER_ROW" ] && echo "每行帧数: $FRAMES_PER_ROW"
echo ""

# 遍历所有 GIF 文件
while IFS= read -r -d '' gif_file; do
    total=$((total + 1))
    
    # 获取文件名（不含路径和扩展名）
    filename=$(basename "$gif_file" .gif)
    filename="${filename%.gif}"  # 处理可能的 .GIF 大写
    
    # 生成输出路径
    output_file="$(dirname "$gif_file")/sprite_${filename}.png"
    
    echo "[$total] 处理: $(basename "$gif_file")"
    
    # 调用 gif_to_sprite.py
    if [ -n "$FRAMES_PER_ROW" ]; then
        if python3 "$GIF_TO_SPRITE_PY" "$gif_file" "$output_file" "$MAX_FRAMES" "$FRAMES_PER_ROW"; then
            echo "     ✓ 成功: $output_file"
            success=$((success + 1))
        else
            echo "     ✗ 失败: 处理出错"
            failed=$((failed + 1))
        fi
    else
        if python3 "$GIF_TO_SPRITE_PY" "$gif_file" "$output_file" "$MAX_FRAMES"; then
            echo "     ✓ 成功: $output_file"
            success=$((success + 1))
        else
            echo "     ✗ 失败: 处理出错"
            failed=$((failed + 1))
        fi
    fi
    echo ""
    
done < <(find "$DIR_PATH" -maxdepth 1 -type f \( -iname "*.gif" \) -print0)

# 输出统计结果
echo "========================================"
echo "处理完成！"
echo "总计: $total 个文件"
echo "成功: $success 个"
echo "失败: $failed 个"
echo "========================================"

if [ $failed -gt 0 ]; then
    exit 1
fi
