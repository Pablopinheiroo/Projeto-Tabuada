#!/usr/bin/env python3
from pathlib import Path
import math
from PIL import Image

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

    # Movimento leve e contínuo: a imagem balança e salta sem apagar ou piscar.
    frames = []
    count = 24
    for i in range(count):
        phase = (2 * math.pi * i) / count
        scale = 1.0 + 0.035 * (0.5 + 0.5 * math.sin(phase * 2))
        angle = 6.0 * math.sin(phase)
        bob = round(3 * math.sin(phase * 2))
        size = (round(96 * scale), round(96 * scale))
        frame = base.resize(size, Image.Resampling.LANCZOS)
        frame = frame.rotate(
            angle, resample=Image.Resampling.BICUBIC,
            expand=False, fillcolor=(7, 11, 24)
        )
        canvas = Image.new("RGB", (96, 96), (7, 11, 24))
        canvas.paste(frame, ((96-size[0])//2, (96-size[1])//2 + bob))
        frames.append(canvas)

    # Uma paleta única evita mudanças de cor entre os quadros do GIF.
    contact = Image.new("RGB", (96 * len(frames), 96))
    for i, frame in enumerate(frames):
        contact.paste(frame, (i * 96, 0))
    palette = contact.quantize(colors=256, method=Image.Quantize.MEDIANCUT)
    indexed = [
        frame.quantize(palette=palette, dither=Image.Dither.NONE)
        for frame in frames
    ]

    indexed[0].save(
        DEST, save_all=True, append_images=indexed[1:],
        duration=90, loop=0, optimize=True, disposal=2
    )
    verify = Image.open(DEST)
    if verify.n_frames != count or verify.size != (96, 96):
        raise SystemExit("O GIF gerado não passou na verificação.")
    print(
        f"GIF criado sem piscar: {verify.n_frames} quadros, "
        f"{verify.size[0]}x{verify.size[1]}, 90 ms por quadro."
    )

if __name__ == "__main__":
    main()
