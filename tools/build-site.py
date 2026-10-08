#!/usr/bin/env python3
"""Build the standalone website (index.html at the repo root, served by GitHub Pages)
from src/index.html, which is the page body as published on claude.ai."""
from pathlib import Path

root = Path(__file__).resolve().parent.parent
body = (root / "src" / "index.html").read_text(encoding="utf-8")
head = (
    '<!doctype html><html lang="uk"><head><meta charset="utf-8">'
    '<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">'
    '<meta name="description" content="Air Chains: браслети з натурального каміння. Зберіть свій браслет у конструкторі.">'
    '<style>:root{color-scheme:light;padding-top:env(safe-area-inset-top,0px);padding-bottom:env(safe-area-inset-bottom,0px)}'
    'body{margin:0;font:14px system-ui,sans-serif}img{max-width:100%}[hidden]{display:none!important}</style>'
    '</head><body>'
)
(root / "index.html").write_text(head + body + "</body></html>\n", encoding="utf-8")
(root / ".nojekyll").write_text("", encoding="utf-8")
print("built index.html")
