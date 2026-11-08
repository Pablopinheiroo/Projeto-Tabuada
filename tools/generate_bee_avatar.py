#!/usr/bin/env python3
from pathlib import Path
import math
from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parent.parent
SOURCE = ROOT / "assets/avatars/avatar-abelhinha-imagem.jpg"
DEST = ROOT / "assets/avatars/avatar-abelhinha-dancando.gif"

def main():
    if not SOURCE.exists():
        raise SystemExit("A imagem-base da abelhinha não foi encontrada.")
    original = Image.open(SOURCE).convert("RGB")
    original.thumbnail((88, 88), Image.Resampling.LANCZOS)
    base = Image.new("RGB", (96, 96), (7, 11, 24))
    base.paste(original, ((96-original.width)//2, (96-original.height)//2))

    frames = []
    count = 16
    for i in range(count):
        phase = (2 * math.pi * i) / count
        scale = 1.0 + 0.025 * math.cos(phase * 2)
        angle = 4.0 * math.sin(phase)
        bob = round(2 * math.sin(phase * 2))
        size = (round(96 * scale), round(96 * scale))
        frame = base.resize(size, Image.Resampling.LANCZOS)
        frame = frame.rotate(angle, resample=Image.Resampling.BICUBIC,
                             expand=False, fillcolor=(7, 11, 24))
        canvas = Image.new("RGB", (96, 96), (7, 11, 24))
        canvas.paste(frame, ((96-size[0])//2, (96-size[1])//2 + bob))
        # Luzes pequenas alternam de posição para dar movimento sem piscar a imagem inteira.
        draw = ImageDraw.Draw(canvas)
        spark_x = 8 + ((i * 11) % 80)
        spark_y = 8 + ((i * 7) % 18)
        draw.ellipse((spark_x, spark_y, spark_x+2, spark_y+2), fill=(255, 218, 95))
        frames.append(canvas.quantize(colors=96, method=Image.Quantize.MEDIANCUT))

    frames[0].save(DEST, save_all=True, append_images=frames[1:],
                   duration=110, loop=0, optimize=True, disposal=2)
    verify = Image.open(DEST)
    if verify.n_frames < 12 or verify.size != (96, 96):
        raise SystemExit("O GIF gerado não passou na verificação.")
    print(f"GIF criado: {verify.n_frames} quadros, {verify.size[0]}x{verify.size[1]}, 110 ms por quadro.")

if __name__ == "__main__":
    main()
