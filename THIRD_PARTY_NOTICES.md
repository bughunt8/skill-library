# Third-party notices

This repository builds a page that **indexes and describes** skills published in
other repositories. It does not redistribute their contents: each card shows a
skill's declared name and description and links to the repository it came from.

The descriptions shown on the page are read from each skill's own `SKILL.md`
frontmatter, so the words on a card are the author's own.

## Indexed sources

Recorded in machine-readable form in [`sources.json`](sources.json), which is the
single place a source is declared.

### bughunt8/skills

- Repository: <https://github.com/bughunt8/skills>
- Licence: MIT, with vendored third-party imports retaining their upstream
  licences. That repository maintains its own `THIRD_PARTY_NOTICES.md` and a
  `skills/vendor.manifest.json` pinning each import to an upstream commit.
- Indexed path: `skills/`

### haowjy/creative-writing-skills

- Repository: <https://github.com/haowjy/creative-writing-skills>
- Licence: Apache-2.0
- Indexed path: repository root
- Note: this repository mirrors the same skills into both `cw/skills/` and
  `skills/`. The build deduplicates by skill name, shallowest path winning, so
  each appears once.

### eternityspring/shuohao-skills

- Repository: <https://github.com/eternityspring/shuohao-skills>
- Licence: Apache-2.0, with a `NOTICE` file in the upstream repository
- Indexed path: `skills/`

## Runtime libraries

Loaded from a CDN at run time, not vendored into this repository. The page is
fully functional if both fail to load.

### GSAP, with ScrollTrigger

- Version 3.15.0, <https://gsap.com>
- Licence: GSAP Standard "No Charge" licence,
  <https://gsap.com/community/standard-license/>
- GSAP including ScrollTrigger became free for commercial use in April 2025.

### Lenis

- Version 1.3.11, <https://github.com/darkroomengineering/lenis>
- Licence: MIT

### Fonts

- Space Grotesk and Inter, served by Google Fonts. Both are licensed under the
  SIL Open Font License 1.1.

## Development-only dependencies

Used by CI and never served to a reader: `@playwright/test` (Apache-2.0),
`@axe-core/playwright` (MPL-2.0), and `html-validate` (MIT).

## Corrections

If you author one of the indexed skills and want an attribution corrected or your
work removed from the index, open an issue on this repository and it will be
actioned.
