# Genera le icone pixel-art (build/icon.png, icon.ico, tray.png, tray@2x.png)
from PIL import Image, ImageDraw
import os
OUT = os.path.join(os.path.dirname(__file__), '..', 'build')
def px(d, x, y, w, h, c): d.rectangle([x, y, x + w - 1, y + h - 1], fill=c)

def big():
    im = Image.new('RGBA', (32, 32), (0, 0, 0, 0)); d = ImageDraw.Draw(im)
    px(d, 1, 3, 30, 28, '#1D2B53'); px(d, 2, 2, 28, 30, '#1D2B53')      # fondo
    px(d, 2, 28, 28, 3, '#5F574F')
    px(d, 5, 9, 18, 15, '#d8d2c0'); px(d, 22, 10, 1, 14, '#a39d8a')    # monitor
    px(d, 7, 11, 13, 10, '#002b16')
    for i, w in enumerate([8, 5, 10, 3]): px(d, 8, 12 + i * 2, w, 1, '#00E436')
    px(d, 11, 24, 6, 2, '#a39d8a'); px(d, 9, 26, 10, 1, '#8b8574')
    px(d, 17, 3, 13, 8, '#FFF1E8'); px(d, 18, 2, 11, 10, '#FFF1E8')      # fumetto
    px(d, 19, 11, 2, 2, '#FFF1E8'); px(d, 19, 13, 1, 1, '#FFF1E8')
    for i in range(3): px(d, 19 + i * 3, 6, 2, 2, '#FF004D' if i == 2 else '#1D2B53')
    px(d, 24, 21, 5, 4, '#FFCCAA'); px(d, 24, 20, 5, 1, '#7E2553'); px(d, 23, 25, 7, 5, '#FF77A8')  # omino
    return im

def small():
    im = Image.new('RGBA', (16, 16), (0, 0, 0, 0)); d = ImageDraw.Draw(im)
    px(d, 1, 3, 12, 10, '#d8d2c0'); px(d, 2, 4, 10, 7, '#002b16')
    px(d, 3, 5, 5, 1, '#00E436'); px(d, 3, 7, 7, 1, '#00E436'); px(d, 3, 9, 3, 1, '#00E436')
    px(d, 5, 13, 4, 2, '#a39d8a')
    px(d, 10, 0, 6, 5, '#FF77A8'); px(d, 11, 5, 1, 1, '#FF77A8')
    return im

b = big()
b.resize((256, 256), Image.NEAREST).save(os.path.join(OUT, 'icon.png'))
b.resize((256, 256), Image.NEAREST).save(os.path.join(OUT, 'icon.ico'), sizes=[(16, 16), (24, 24), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)])
s = small()
s.save(os.path.join(OUT, 'tray.png'))
s.resize((32, 32), Image.NEAREST).save(os.path.join(OUT, 'tray@2x.png'))
print('icone generate')
