# The Skill Library

A scroll-driven browser for a library of AI agent skills. You travel through one
category at a time, and every skill arrives with what it does, where it came
from, and how it is licensed.

- **Production:** <https://skills.ronald.ng>
- **Staging:** GitHub Pages, published from `main` after CI passes

## What this is

The library indexes three public repositories. Nothing here is original work:
every skill keeps the licence it was published under, and every card on the page
names its source repository so a reader can go and check it.

| Source | Licence |
| --- | --- |
| [bughunt8/skills](https://github.com/bughunt8/skills) | MIT, with vendored imports keeping their upstream licences |
| [haowjy/creative-writing-skills](https://github.com/haowjy/creative-writing-skills) | Apache-2.0 |
| [eternityspring/shuohao-skills](https://github.com/eternityspring/shuohao-skills) | Apache-2.0 |

The exact skill counts are not written down anywhere by hand. `build.py` reads
them out of the source trees, and CI fails if the committed page disagrees with
what the sources actually contain.

## How it is built

`index.html` is **generated**, not hand-edited. Do not edit anything between the
`BEGIN GENERATED` and `END GENERATED` markers.

```bash
python3 build.py --check     # verify the page matches the sources (this is what CI runs)
python3 build.py --write     # regenerate index.html and data.js
python3 build.py --refresh --write   # re-clone the upstreams first, then regenerate
```

`build.py` uses the standard library only, so CI needs nothing installed to run it.

Each source in `sources.json` is **pinned to a commit**, and the build always
clones at that pin. Without pinning the build is not reproducible: a runner
clones upstream `HEAD` while a laptop reuses whatever a local checkout was left
at, and the same repository commit produces two different pages. `--refresh` is
the only thing that moves a pin, which is what the fortnightly workflow does.

### Why the page is prerendered

The first version of this page built all of its cards in JavaScript. That served
858 characters of text to a crawler and rendered nothing at all with JavaScript
disabled. Every card is now real HTML in the shipped file, and `app.js` only
attaches motion to markup that is already there. `app.js` never creates content,
and a test enforces that.

## Architecture

```
index.html      generated page: hero, one section per category, a card per skill
styles.css      design tokens and layout; one dark theme, one accent
app.js          motion layer only, a progressive enhancement over the HTML
data.js         generated totals, used by the counter
build.py        reads the sources, prerenders the page, verifies it in CI
sources.json    the repositories to index, each pinned to a commit; adding one
                here is the only change needed
_headers        Cloudflare Pages response headers, including CSP
tests/          Playwright suite: content, motion, resilience, accessibility
scripts/        secret scanner and post-deploy smoke test
```

### Constraints this page holds itself to

- **No runtime dependencies of our own.** Motion comes from two CDN libraries and
  the page is fully functional without them.
- **Readable without JavaScript.** With JS off it is a complete, plain list.
- **Readable without motion.** With `prefers-reduced-motion` set, pinning and
  scrubbing are switched off entirely and the page becomes the same plain list.
- **No horizontal overflow** at any width, in either motion mode. Tested at eight
  widths.
- **No `scroll` event listeners.** Motion is driven by ScrollTrigger, and the one
  `resize` listener is debounced.
- **WCAG 2.1 AA.** Enforced by axe in CI, in both motion modes, and a build fails
  on any violation.
- **No credentials in the tree.** Enforced by a scanner and by gitleaks over the
  full history.

## Motion

[GSAP](https://gsap.com) with ScrollTrigger, plus [Lenis](https://github.com/darkroomengineering/lenis)
for smooth scrolling. GSAP including ScrollTrigger has been free for commercial
use since April 2025 under its [standard licence](https://gsap.com/community/standard-license/).

Lenis is driven from GSAP's ticker rather than its own `requestAnimationFrame`
loop, so there is exactly one animation loop on the page.

Card reveals are positioned on the same scrubbed timeline that moves the
filmstrip. They cannot be separate ScrollTriggers: the cards are being translated
by GSAP, so their position relative to the viewport is not something an ordinary
trigger can observe.

## Development

```bash
npm ci
npm run build          # regenerate the page
npm run lint:html      # HTML validity
npm run lint:secrets   # credential scan
npm test               # Playwright suite
npm run serve          # http://localhost:8090
```

## CI/CD

Everything is driven by GitHub Actions. Nothing is built, validated or deployed
by hand.

| Workflow | Trigger | What it does |
| --- | --- | --- |
| `validate.yml` | called by the two below | secret scan, gitleaks, build reproducibility, HTML validity, and the full browser suite. Defined once so production revalidates the exact commit it ships. |
| `ci.yml` | every push and PR | calls `validate.yml`, then on `main` rebuilds and publishes staging to GitHub Pages and smoke-tests the live URL. Exposes one required check, `all gates passed`. |
| `deploy-production.yml` | `v*` tag or manual | calls `validate.yml`, rebuilds, publishes to Cloudflare Pages, verifies DNS, smoke-tests the live site and checks security headers |
| `dns.yml` | manual only | plans or applies the one Route 53 CNAME for `skills.ronald.ng` |
| `refresh-sources.yml` | 1st and 15th | rebuilds from the upstream repositories and opens a PR when anything changed |

`validate.yml` uses no secrets at all, so it runs in full on fork pull requests.
Deploy credentials are read only by the deploy jobs, from Actions secrets, by
reference.

Both deploy paths call the same validation rather than polling for another
workflow's result. Polling across a workflow boundary for a check that has not
been created yet fails immediately, which is exactly what the first staging
deploy did.

See [DEPLOYMENT.md](DEPLOYMENT.md) for the hosting layout, the secrets the deploy
workflows expect, and how DNS is arranged.

## Licence

The page itself, the build script and the tests are MIT, see [LICENSE](LICENSE).
The indexed skills belong to their authors under their own licences, recorded in
[THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) and shown on every card.

Built by [Ronald Ng](https://ronald.ng).
