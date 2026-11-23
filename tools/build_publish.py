#!/usr/bin/env python3
"""Builds the copy of Quaver that is published on claude.ai.

  fonts/embed.css      the three typefaces as data: URIs, so PNG and video exports keep
                       their music symbols (a published page can't fetch from Google)
  publish/quaver.html  index.html without the <html>/<head>/<body> wrapper, which the
                       host adds itself; the js/ and fonts/ files are published beside it

Run from anywhere:  python3 tools/build_publish.py   (add --refresh-fonts to re-download)
"""
import base64
import pathlib
import re
import sys
import urllib.request

ROOT = pathlib.Path(__file__).resolve().parent.parent
# Google Fonts only serves WOFF2 to browsers it recognises.
UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36'


def get(url):
    req = urllib.request.Request(url, headers={'User-Agent': UA})
    with urllib.request.urlopen(req, timeout=30) as r:
        return r.read()


def build_fonts(html):
    out = ROOT / 'fonts' / 'embed.css'
    if out.exists() and '--refresh-fonts' not in sys.argv:
        return
    href = re.search(r'id="fontcss" rel="stylesheet" href="([^"]+)"', html).group(1).replace('&amp;', '&')
    css = get(href).decode()
    blocks = re.findall(r'@font-face\s*{[^}]*}', css)
    # same choice as embedFonts() in js/io.js: all of Noto Music, Latin for the text faces
    keep = [b for b in blocks if 'Noto Music' in b or (('Newsreader' in b or 'Instrument Sans' in b) and re.search(r'unicode-range:\s*U\+0000-00FF', b))]
    # variable fonts: Google lists one file once per weight, so merge those into one weight range
    merged = {}
    for b in keep:
        url = re.search(r'url\((https:[^)]+)\)', b).group(1)
        w = int(re.search(r'font-weight:\s*(\d+)', b).group(1))
        if url in merged:
            merged[url][1].append(w)
        else:
            merged[url] = [b, [w]]
    parts = []
    for url, (b, ws) in merged.items():
        b = re.sub(r'font-weight:\s*\d+', f'font-weight: {min(ws)} {max(ws)}' if len(ws) > 1 else f'font-weight: {ws[0]}', b)
        parts.append(b.replace(url, 'data:font/woff2;base64,' + base64.b64encode(get(url)).decode()))
    out.parent.mkdir(exist_ok=True)
    out.write_text('\n'.join(parts))
    print(f'fonts/embed.css: {len(parts)} faces, {out.stat().st_size // 1024} KB')


def build_page(html):
    head = re.search(r'<head>(.*?)</head>', html, re.S).group(1)
    body = re.search(r'<body>(.*?)</body>', html, re.S).group(1)
    head = re.sub(r'\s*<meta (charset|name="viewport")[^>]*>', '', head)
    head = head.replace('</title>', '</title>\n<meta name="claude:viewport-fit-sides" content="cover">', 1)
    page = (head.strip() + '\n' + body.strip() + '\n')
    page = re.sub(r'(\.js)\?v=\d+"', r'\1"', page)
    out = ROOT / 'publish' / 'quaver.html'
    out.parent.mkdir(exist_ok=True)
    out.write_text(page)
    print(f'publish/quaver.html: {len(page) // 1024} KB')


if __name__ == '__main__':
    src = (ROOT / 'index.html').read_text()
    build_fonts(src)
    build_page(src)
