#!/usr/bin/env python3
"""Table cards with a QR code for each branded app. python3 tools/qr.py [outdir]"""
import sys, pathlib, qrcode
from PIL import Image, ImageDraw, ImageFont

CARDS = [('qr-mahjong-parlour.png', 'Mahjong Parlour', 'https://mahjongparlour.pages.dev', '#1D5C47'),
         ('qr-kawa-mahjong.png', 'Kawa Mahjong', 'https://kawamahjong.pages.dev', '#7A2E2E')]
OUT = pathlib.Path(sys.argv[1] if len(sys.argv) > 1 else '.')

def font(size, bold=False):
    for p in (['/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf'] if bold else ['/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf']):
        if pathlib.Path(p).exists(): return ImageFont.truetype(p, size)
    return ImageFont.load_default()

for fname, brand, url, colour in CARDS:
    W, H = 1240, 1754  # A5-ish at 300dpi
    img = Image.new('RGB', (W, H), '#F6F3EA')
    d = ImageDraw.Draw(img)
    d.rectangle([0, 0, W, 260], fill=colour)
    f = font(92, True); tw = d.textlength(brand, font=f); d.text(((W - tw) / 2, 78), brand, font=f, fill='white')
    q = qrcode.QRCode(error_correction=qrcode.constants.ERROR_CORRECT_Q, box_size=18, border=2)
    q.add_data(url); q.make(fit=True)
    qi = q.make_image(fill_color=colour, back_color='#F6F3EA').convert('RGB')
    qi = qi.resize((820, 820)); img.paste(qi, ((W - 820) // 2, 330))
    y = 1190
    for line, size, bold in (('Scan to keep score at this table', 48, True), (url.replace('https://', ''), 44, False),
                             ('Tap Game ID → New Game ID, then share the ID.', 36, False),
                             ('Same Game ID on every phone = one scorebook. No accounts.', 36, False),
                             ('Tables unused for 7 days are deleted — save the recap image.', 36, False)):
        f = font(size, bold); tw = d.textlength(line, font=f); d.text(((W - tw) / 2, y), line, font=f, fill='#222' if bold else '#444'); y += size + 34
    img.save(OUT / fname); print('wrote', OUT / fname)
