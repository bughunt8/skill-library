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


def resolve_tip(url: str) -> str:
    """The commit the upstream default branch currently points at."""
    out = subprocess.run(
        ["git", "ls-remote", url + ".git", "HEAD"],
        capture_output=True, text=True, check=True,
    ).stdout.split()
    if not out:
        fail(f"could not resolve HEAD for {url}")
    return out[0]


def repin() -> None:
    """Move every pin in sources.json to the current upstream tip."""
    cfg = json.loads(SOURCES.read_text(encoding="utf-8"))
    for src in cfg["sources"]:
        tip = resolve_tip(src["url"])
        if src.get("ref") != tip:
            print(f"  {src['repo']}: {src.get('ref', '<unpinned>')[:12]} -> {tip[:12]}")
        src["ref"] = tip
    SOURCES.write_text(json.dumps(cfg, indent=2) + "\n", encoding="utf-8")


def fetch() -> dict:
    """Clone every source at its pinned commit. Returns {source id: path}.

    Always clones rather than reusing a sibling working copy. A sibling checkout
    is whatever the last person left it at, and building from that is how the
    committed page came to disagree with the sources: CI cloned upstream HEAD,
    a laptop used a stale local clone, and the two produced different pages.
    Cloning at the pin makes the build deterministic everywhere.
    """
    checkouts = {}
    tmp = Path(tempfile.mkdtemp(prefix="skill-src-"))
    for src in load_sources():
        ref = src.get("ref")
        if not ref:
            fail(
                f"[{src['id']}] has no pinned 'ref' in sources.json. "
                f"Run: python3 build.py --refresh --write"
            )
        dest = tmp / src["id"]
        subprocess.run(
            ["git", "clone", "--quiet", "--filter=blob:none", "--no-checkout",
             src["url"] + ".git", str(dest)],
            check=True,
        )
        r = subprocess.run(
            ["git", "-C", str(dest), "checkout", "--quiet", ref],
            capture_output=True, text=True,
        )
        if r.returncode != 0:
            fail(
                f"[{src['id']}] pinned commit {ref[:12]} is not reachable in "
                f"{src['url']} ({r.stderr.strip()}). It may have been force-pushed; "
                f"re-pin with: python3 build.py --refresh --write"
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


# Every phrasing in the hand-written part of the page that states a count. Each
# must be regenerated on build, because a number nobody recalculates is a claim
# nobody checked.
CLAIMS = [
    (re.compile(r"\b(\d+) agent skills across (\d+) categories"), "{t} agent skills across {c} categories"),
    (re.compile(r"\b(\d+) AI agent skills across (\d+) categories"), "{t} AI agent skills across {c} categories"),
    (re.compile(r"\btravel through (\d+) categories"), "travel through {c} categories"),
    (re.compile(r'(<div class="hud__count" id="hudcount">)0*\d+ / (\d+)'), None),
]

# Any surviving number attached to these nouns outside the generated region is a
# claim the build does not own, and is therefore drift waiting to happen.
AUDIT = re.compile(r"\b(\d+)\s+(?:AI\s+)?(?:agent\s+)?(?:skills|categories)\b")


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

    for pattern, template in CLAIMS:
        if template is None:
            page = pattern.sub(rf"\g<1>000 / {total}", page)
        else:
            page = pattern.sub(template.format(t=total, c=cats), page)
    return page


def audit_claims(page: str, total: int, cats: int) -> list:
    """Find count claims in the hand-written region that the build does not own."""
    begin, end = MARKERS["main"]
    cbegin, cend = MARKERS["credits"]
    # Blank out both generated regions; their numbers are generated by definition.
    stripped = re.sub(
        re.escape(begin) + r".*?" + re.escape(end), "", page, flags=re.S
    )
    stripped = re.sub(
        re.escape(cbegin) + r".*?" + re.escape(cend), "", stripped, flags=re.S
    )
    bad = []
    for m in AUDIT.finditer(stripped):
        n = int(m.group(1))
        if n not in (total, cats):
            line = stripped[: m.start()].count("\n") + 1
            bad.append(f"line {line}: \"{m.group(0)}\" (data says {total} skills, {cats} categories)")
    return bad


def main(argv: list) -> int:
    ap = argparse.ArgumentParser(description="Build the skill-library page.")
    mode = ap.add_mutually_exclusive_group(required=True)
    mode.add_argument("--check", action="store_true")
    mode.add_argument("--write", action="store_true")
    ap.add_argument(
        "--refresh",
        action="store_true",
        help="move each pin in sources.json to the current upstream tip first",
    )
    args = ap.parse_args(argv)

    if not shutil.which("git"):
        fail("git is required")

    if args.refresh:
        if args.check:
            fail("--refresh changes the pins, so it cannot be combined with --check")
        print("re-pinning sources to their current upstream tips:")
        repin()

    rows = collect(fetch())
    if not rows:
        fail("no skills collected; check sources.json", 1)
    blocks, data = render(rows)
    counts = collections.Counter(r["dom"] for r in rows)

    current = INDEX.read_text(encoding="utf-8")
    updated = splice(current, blocks, len(rows), len(counts))

    drift = audit_claims(updated, len(rows), len(counts))
    if drift:
        print(
            "error: index.html states counts the build does not own:\n  "
            + "\n  ".join(drift)
            + "\n\nAdd the phrasing to CLAIMS in build.py so it is regenerated, "
            "rather than editing the number by hand.",
            file=sys.stderr,
        )
        return 1

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
