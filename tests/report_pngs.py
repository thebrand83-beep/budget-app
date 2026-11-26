# PNG previews from the generated PDFs: <tag>-sheet.png (all pages, contact sheet) + png/<tag>/page-N.png
import sys, os, subprocess, glob, pathlib
from PIL import Image
OUT = pathlib.Path(sys.argv[1] if len(sys.argv) > 1 else '/workspace/budget-app-preview/reports')
for pdf in sorted(OUT.glob('*.pdf')):
    tag = pdf.stem; d = OUT / 'png' / tag; d.mkdir(parents=True, exist_ok=True)
    for f in d.glob('*.png'): f.unlink()
    subprocess.run(['pdftoppm', '-r', '90', '-png', str(pdf), str(d / 'page')], check=True)
    pages = sorted(d.glob('page-*.png'), key=lambda p: int(p.stem.split('-')[1]))
    ims = [Image.open(p).convert('RGB') for p in pages]; w, h = ims[0].size; k = 0.45; tw, th = int(w * k), int(h * k); cols = min(5, len(ims)); rows = (len(ims) + cols - 1) // cols
    sheet = Image.new('RGB', (cols * (tw + 12) + 12, rows * (th + 12) + 12), '#3a372f')
    for i, im in enumerate(ims): sheet.paste(im.resize((tw, th), Image.LANCZOS), (12 + (i % cols) * (tw + 12), 12 + (i // cols) * (th + 12)))
    sheet.save(OUT / f'{tag}-sheet.png'); print(tag, len(ims), 'pages')
