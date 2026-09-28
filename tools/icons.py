#!/usr/bin/env python3
"""Generate the PWA icons (the app's red 麻雀 seal on a felt-green tile). Needs Pillow and a CJK font."""
import pathlib, glob
from PIL import Image, ImageDraw, ImageFont

ROOT = pathlib.Path(__file__).resolve().parent.parent
OUT = ROOT / 'docs' / 'icons'
OUT.mkdir(parents=True, exist_ok=True)

def font(size):
    for pat in ('/usr/share/fonts/**/NotoSerifCJK*Bold*', '/usr/share/fonts/**/NotoSansCJK*Bold*', '/usr/share/fonts/**/*CJK*', '/System/Library/Fonts/PingFang.ttc'):
        for f in glob.glob(pat, recursive=True):
            try: return ImageFont.truetype(f, size, index=0)
            except Exception: continue
    return ImageFont.load_default()

def draw(size, pad_frac, bg='#1D5C47'):
    S = 4  # supersample
    W = size * S
    img = Image.new('RGBA', (W, W), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    d.rounded_rectangle([0, 0, W - 1, W - 1], radius=int(W * 0.22), fill=bg)
    # bone tile
    pad = int(W * pad_frac)
    tw, th = int(W - 2 * pad), int(W - 2 * pad)
    x0, y0 = pad, pad
    d.rounded_rectangle([x0, y0 + int(W * 0.03), x0 + tw, y0 + th], radius=int(W * 0.12), fill='#2D7A5B')
    d.rounded_rectangle([x0, y0, x0 + tw, y0 + th - int(W * 0.03)], radius=int(W * 0.12), fill='#F6F0DF', outline='#DCD2B8', width=S * 2)
    # red seal with 麻雀
    sw = int(tw * 0.62)
    sx, sy = x0 + (tw - sw) // 2, y0 + (th - int(W * 0.03) - sw) // 2
    d.rounded_rectangle([sx, sy, sx + sw, sy + sw], radius=int(sw * 0.14), fill='#C43B2C')
    d.rounded_rectangle([sx + int(sw * 0.06), sy + int(sw * 0.06), sx + sw - int(sw * 0.06), sy + sw - int(sw * 0.06)], radius=int(sw * 0.1), outline='#FFF3E8', width=int(sw * 0.035))
    f = font(int(sw * 0.44))
    for i, ch in enumerate('麻雀'):
        bbox = d.textbbox((0, 0), ch, font=f)
        cw, chh = bbox[2] - bbox[0], bbox[3] - bbox[1]
        cx = sx + sw / 2 - cw / 2 - bbox[0]
        cy = sy + sw * (0.27 + 0.46 * i) - chh / 2 - bbox[1]
        d.text((cx, cy), ch, font=f, fill='#FFF3E8')
    return img.resize((size, size), Image.LANCZOS)

draw(192, 0.10).save(OUT / 'icon-192.png')
draw(512, 0.10).save(OUT / 'icon-512.png')
draw(512, 0.20).save(OUT / 'maskable-512.png')
draw(180, 0.10).convert('RGB').save(OUT / 'apple-touch-icon.png')
print('icons written to', OUT)
