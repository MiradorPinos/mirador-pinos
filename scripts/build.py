#!/usr/bin/env python3
"""Build per-language static pages from index.html + assets/js/i18n.json.

Produces:
  <out>/index.html       — ES (canonical at /)
  <out>/en/index.html    — EN (canonical at /en/)

Both files have all data-i18n placeholders resolved server-side so
search engines see the localized content directly. The data-i18n
attributes are kept in the markup so the client-side JS still re-applies
translations to dynamically-rendered content (review dates, summary
strings, etc.).

Usage:
  python3 scripts/build.py [output_dir]    # default: ./_site

Requires: beautifulsoup4
"""
import datetime
import json
import sys
from pathlib import Path

from bs4 import BeautifulSoup

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / "index.html"
I18N_PATH = ROOT / "assets" / "js" / "i18n.json"
OUT = Path(sys.argv[1]) if len(sys.argv) > 1 else (ROOT / "_site")


LANG_CONFIG = {
    "es": {
        "subdir": "",  # canonical at /
        "html_lang": "es",
        "canonical": "https://miradorpinos.com/",
        "og_locale": "es_MX",
        "og_locale_alt": "en_US",
    },
    "en": {
        "subdir": "en",  # canonical at /en/
        "html_lang": "en",
        "canonical": "https://miradorpinos.com/en/",
        "og_locale": "en_US",
        "og_locale_alt": "es_MX",
    },
}


def render(template_html: str, lang: str, i18n: dict) -> str:
    cfg = LANG_CONFIG[lang]
    t = i18n[lang]
    soup = BeautifulSoup(template_html, "html.parser")
    year = str(datetime.date.today().year)

    # 1. <html lang="...">
    if soup.html is not None:
        soup.html["lang"] = cfg["html_lang"]

    # 2. Resolve every data-i18n element. If there's a data-i18n-attr, set
    #    that attribute; otherwise replace the element's text content.
    for el in soup.find_all(attrs={"data-i18n": True}):
        key = el["data-i18n"]
        value = t.get(key, key)
        if "{year}" in value:
            value = value.replace("{year}", year)
        attr = el.get("data-i18n-attr")
        if attr:
            el[attr] = value
        else:
            # Replace text content. .string only works for text-only
            # elements; data-i18n is only used on those.
            el.string = value

    # 3. Canonical URL
    canonical = soup.find("link", attrs={"rel": "canonical"})
    if canonical is not None:
        canonical["href"] = cfg["canonical"]

    # 4. og:url, og:locale, og:locale:alternate
    for prop, value in (
        ("og:url", cfg["canonical"]),
        ("og:locale", cfg["og_locale"]),
        ("og:locale:alternate", cfg["og_locale_alt"]),
    ):
        m = soup.find("meta", attrs={"property": prop})
        if m is not None:
            m["content"] = value

    # 5. JSON-LD: localize description and url to match the page
    ld = soup.find("script", id="ld-business")
    if ld is not None and ld.string:
        try:
            data = json.loads(ld.string)
            data["description"] = t.get("site.description", data.get("description", ""))
            data["url"] = cfg["canonical"]
            ld.string = json.dumps(data, ensure_ascii=False, indent=2)
        except json.JSONDecodeError:
            pass

    return str(soup)


def main() -> int:
    template = SRC.read_text(encoding="utf-8")
    i18n = json.loads(I18N_PATH.read_text(encoding="utf-8"))
    OUT.mkdir(parents=True, exist_ok=True)

    for lang, cfg in LANG_CONFIG.items():
        out_dir = OUT / cfg["subdir"] if cfg["subdir"] else OUT
        out_dir.mkdir(parents=True, exist_ok=True)
        out_file = out_dir / "index.html"
        rendered = render(template, lang, i18n)
        out_file.write_text(rendered, encoding="utf-8")
        rel = out_file.relative_to(OUT)
        print(f"  wrote {rel} ({len(rendered):,} bytes)")

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
