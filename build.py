#!/usr/bin/env python3
"""Build the skill-library page from its source repositories.

Why this exists: the first version of this page built all 482 cards in
JavaScript. That produced a page with 858 characters of text for a crawler and
nothing at all with JS disabled, which is the wrong architecture for a public,
indexable page. Every card is now prerendered into index.html at build time and
JavaScript only attaches motion to markup that is already there.

    build.py --check   verify index.html matches the sources (used by CI)
    build.py --write   regenerate index.html and data.js
    build.py --refresh clone the upstreams fresh, then write

Standard library only, so CI needs nothing installed.

Exit codes
    0  generated output matches the sources (--check) or was written (--write)
    1  index.html is stale, or a source is missing
    2  usage or environment error
"""

from __future__ import annotations

import argparse
import collections
import html
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent
INDEX = ROOT / "index.html"
DATA = ROOT / "data.js"
SOURCES = ROOT / "sources.json"

MARKERS = {
    "main": (
        "<!-- BEGIN GENERATED: main (build.py) -- do not edit by hand -->",
        "<!-- END GENERATED: main -->",
    ),
    "credits": (
        "<!-- BEGIN GENERATED: credits (build.py) -- do not edit by hand -->",
        "<!-- END GENERATED: credits -->",
    ),
}

# Human labels for directory names. A category with no entry falls back to its
# directory name, which is visible and therefore self-correcting.
LABELS = {
    "engineering": "Engineering",
    "c-level-advisor": "C-level advisory",
    "engineering-team": "Engineering team",
    "marketing-skill": "Marketing",
    "pstack": "Engineering rigor",
    "design": "Design",
    "creative-writing": "Creative writing",
    "productivity": "Productivity",
    "product-team": "Product",
    "ra-qm-team": "Regulatory and quality",
    "job-hunt": "Job search",
    "compliance-os": "Compliance",
    "project-management": "Project management",
    "commercial": "Commercial",
    "research": "Research",
    "business-operations": "Business operations",
    "business-growth": "Business growth",
    "markdown-html": "Markdown and HTML",
    "research-ops": "Research ops",
    "shuohao": "Short-drama production",
    "finance": "Finance",
    "loop-library": "Agent loops",
    "start-github-repo": "Repo scaffolding",
    "marketing": "Landing pages",
}

SKIP_NAMES = {"sample-skill"}  # a test fixture, not a skill


def fail(msg: str, code: int = 2):
    print(f"error: {msg}", file=sys.stderr)
    raise SystemExit(code)


def load_sources() -> list:
    if not SOURCES.exists():
        fail(f"missing {SOURCES}")
    return json.loads(SOURCES.read_text(encoding="utf-8"))["sources"]


def frontmatter(path: Path) -> "tuple[str, str]":
    text = path.read_text(encoding="utf-8", errors="replace")
    match = re.match(r"\A---[ \t]*\r?\n(.*?)\r?\n---", text, re.S)
    name = desc = None
    if match:
        block = match.group(1)
        for key in ("name", "description"):
            m = re.search(rf"^{key}:[ \t]*(.*)$", block, re.M)
            if m:
                value = m.group(1).strip().strip("\"'")
                if key == "name":
                    name = value
                else:
                    desc = value
    return (name or path.parent.name), re.sub(r"\s+", " ", desc or "").strip()


def trim(text: str, limit: int = 170) -> str:
    if len(text) <= limit:
        return text
    cut = text[:limit]
    stop = cut.rfind(". ")
    return cut[: stop + 1] if stop > 90 else cut.rstrip() + "..."


def collect(checkouts: dict) -> list:
    rows = []
    for src in load_sources():
        root = checkouts[src["id"]]
        if src.get("subpath"):
            root = root / src["subpath"]
        if not root.is_dir():
            fail(f"[{src['id']}] path not found: {root}")

        found = []
        for dirpath, dirnames, filenames in os.walk(root):
            dirnames[:] = [d for d in dirnames if d != ".git"]
            if "SKILL.md" in filenames:
                found.append(Path(dirpath) / "SKILL.md")
        # Shallowest path wins, so a repo that mirrors the same skill into two
        # directories contributes it once.
        found.sort(key=lambda p: (len(p.parts), str(p)))

        seen = set()
        for path in found:
            name, desc = frontmatter(path)
            if name in seen or name in SKIP_NAMES:
                continue
            seen.add(name)
            parts = Path(os.path.relpath(path.parent, root)).parts
            if src.get("flat_category"):
                category = src["flat_category"]
            else:
                category = parts[0] if parts and parts[0] != "." else "core"
            rows.append(
                {
                    "n": name,
                    "d": trim(desc),
                    "dom": category,
                    "repo": src["repo"],
                    "lic": src["license"],
                    "url": src["url"],
                }
            )
    return rows


def fetch(refresh: bool) -> dict:
    """Return {source id: checkout path}. Uses a sibling clone when present."""
    checkouts, tmp = {}, None
    for src in load_sources():
        local = ROOT.parent / src["id"]
        if local.is_dir() and not refresh:
            checkouts[src["id"]] = local
            continue
        if tmp is None:
            tmp = Path(tempfile.mkdtemp(prefix="skill-src-"))
        dest = tmp / src["id"]
        subprocess.run(
            ["git", "clone", "--quiet", "--depth", "1", src["url"] + ".git", str(dest)],
            check=True,
        )
        checkouts[src["id"]] = dest
    return checkouts


# ------------------------------------------------------------------ rendering


def esc(s: str) -> str:
    return html.escape(s, quote=True)


def render(rows: list) -> "tuple[dict, str]":
    counts = collections.Counter(r["dom"] for r in rows)
    order = [c for c, _ in counts.most_common()]
    total = len(rows)

    by = collections.defaultdict(list)
    for r in rows:
        by[r["dom"]].append(r)
    for k in by:
        by[k].sort(key=lambda r: r["n"])

    out = []

    # category rail
    out.append('    <nav class="rail" id="rail" aria-label="Categories">')
    for cat in order:
        out.append(
            f'      <a href="#cat-{esc(cat)}">{esc(LABELS.get(cat, cat))}'
            f"<span>{counts[cat]}</span></a>"
        )
    out.append("    </nav>")

    # hero. One mosaic tile per skill, first tile of each category accented, so
    # the opening image is the shape of the actual library.
    tiles = []
    for cat in order:
        for i, _ in enumerate(by[cat]):
            tiles.append('<i class="on"></i>' if i == 0 else "<i></i>")
    out.append('    <header class="hero" id="top">')
    out.append('      <div class="mosaic" id="mosaic" aria-hidden="true">')
    out.append("        " + "".join(tiles))
    out.append("      </div>")
    out.append('      <div class="hero__veil" aria-hidden="true"></div>')
    out.append('      <div class="hero__inner">')
    out.append('        <p class="eyebrow">Agent skill library</p>')
    out.append(
        f'        <h1><span class="hero__num" id="herocount">{total}</span>'
        f"skills, {len(order)} categories</h1>"
    )
    out.append(
        '        <p class="hero__sub">Keep scrolling. You travel through one category at a '
        "time, and every skill in it arrives with what it does, where it came from, and how it "
        "is licensed.</p>"
    )
    out.append('        <p class="cue" id="cue"><span></span>Scroll</p>')
    out.append("      </div>")
    out.append("    </header>")

    # chapters
    out.append('    <main id="chapters">')
    before = 0
    for di, cat in enumerate(order):
        label = LABELS.get(cat, cat)
        n = counts[cat]
        out.append(
            f'      <section class="chapter" id="cat-{esc(cat)}" '
            f'aria-labelledby="h-{esc(cat)}" data-before="{before}" data-count="{n}" '
            f'data-label="{esc(label)}">'
        )
        out.append('        <div class="chapter__stage">')
        out.append(f'          <div class="chapter__ghost" aria-hidden="true">{esc(label)}</div>')
        out.append('          <div class="chapter__head">')
        out.append(f'            <p class="chapter__idx">{di + 1:02d} / {len(order):02d}</p>')
        out.append(f'            <h2 class="chapter__name" id="h-{esc(cat)}">{esc(label)}</h2>')
        out.append(
            f'            <p class="chapter__tally"><b>{n}</b> '
            f'{"skill" if n == 1 else "skills"}</p>'
        )
        out.append("          </div>")
        out.append('          <div class="strip__mask"><div class="strip">')
        for i, s in enumerate(by[cat]):
            desc = s["d"] or "No description declared in this skill's frontmatter."
            out.append('            <article class="card">')
            out.append(
                f'              <div class="card__top"><span class="card__no">'
                f"{before + i + 1:03d}</span>"
                f'<span class="card__cmd">/{esc(s["n"])}</span></div>'
            )
            out.append(f'              <h3>{esc(s["n"])}</h3>')
            out.append(f"              <p>{esc(desc)}</p>")
            out.append(
                f'              <footer><a href="{esc(s["url"])}" rel="noopener">'
                f'{esc(s["repo"])}</a><span class="lic">{esc(s["lic"])}</span></footer>'
            )
            out.append("            </article>")
        out.append("          </div></div>")
        out.append("        </div>")
        out.append("      </section>")
        before += n
    out.append("    </main>")

    # credits, generated so the per-repo counts cannot drift from the tree
    per_repo = collections.Counter(r["repo"] for r in rows)
    lic_of = {r["repo"]: r["lic"] for r in rows}
    url_of = {r["repo"]: r["url"] for r in rows}
    cred = ['      <div class="credits" id="credits">']
    for repo, n in per_repo.most_common():
        cred.append(
            f'        <div><strong><a href="{esc(url_of[repo])}" rel="noopener">{esc(repo)}</a>'
            f'</strong><span class="lic">{esc(lic_of[repo])}</span>'
            f'<span class="n">{n} skills</span></div>'
        )
    cred.append("      </div>")

    data = (
        "window.SKILLDATA="
        + json.dumps({"total": total, "categories": len(order)}, separators=(",", ":"))
        + ";\n"
    )
    return {"main": "\n".join(out), "credits": "\n".join(cred)}, data


def splice(page: str, blocks: dict, total: int, cats: int) -> str:
    for key, (begin, end) in MARKERS.items():
        if page.count(begin) != 1 or page.count(end) != 1:
            fail(
                f"index.html has {page.count(begin)} BEGIN and {page.count(end)} END "
                f"markers for '{key}'; exactly one of each is required"
            )
        head = page.split(begin)[0]
        tail = page.split(end, 1)[1]
        page = head + begin + "\n" + blocks[key] + "\n    " + end + tail
    # the counts in the hand-written copy are claims about the data, so keep them true
    page = re.sub(
        r"\b\d+ agent skills across \d+ categories",
        f"{total} agent skills across {cats} categories",
        page,
    )
    page = re.sub(r"\b\d+ / \d+</div>", f"000 / {total}</div>", page)
    return page


def main(argv: list) -> int:
    ap = argparse.ArgumentParser(description="Build the skill-library page.")
    mode = ap.add_mutually_exclusive_group(required=True)
    mode.add_argument("--check", action="store_true")
    mode.add_argument("--write", action="store_true")
    ap.add_argument("--refresh", action="store_true", help="clone the upstreams fresh")
    args = ap.parse_args(argv)

    if not shutil.which("git"):
        fail("git is required")

    rows = collect(fetch(args.refresh))
    if not rows:
        fail("no skills collected; check sources.json", 1)
    blocks, data = render(rows)
    counts = collections.Counter(r["dom"] for r in rows)

    current = INDEX.read_text(encoding="utf-8")
    updated = splice(current, blocks, len(rows), len(counts))

    if args.check:
        stale = []
        if current != updated:
            stale.append("index.html")
        if not DATA.exists() or DATA.read_text(encoding="utf-8") != data:
            stale.append("data.js")
        if stale:
            print(
                f"error: {', '.join(stale)} out of date against the sources. "
                f"Run: python3 build.py --write",
                file=sys.stderr,
            )
            return 1
        print(f"up to date: {len(rows)} skills across {len(counts)} categories")
        return 0

    INDEX.write_text(updated, encoding="utf-8")
    DATA.write_text(data, encoding="utf-8")
    print(f"wrote index.html and data.js: {len(rows)} skills across {len(counts)} categories")
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
