---
paths:
  - "modules/**"
  - "enterprise/**"
  - "apps/**"
  - "packages/**"
---

# Module READMEs

Read the nearest `README.md` before you edit here. The pages are generated from the code by
`tools/readmegen` (plan: `dev/docs/plans/module-readmes-2026-10-06.md`), so they say who owns what
without drift.

| Rule                                                                                 | Why / how                                                                                                     |
| ------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------- |
| The owns and peers tables decide where a change goes                                 | `modules/README.md` maps subject to module; a module page lists what it owns, its peers and who depends on it |
| A change that touches two modules goes through the owner                             | load the `ownership` skill; call the owner's `*Api`, never its tables or files                                |
| Never edit between `<!-- readme:generated:start` and `<!-- readme:generated:end -->` | change the code, then run `pnpm generate:readmes`                                                             |
| Every page has a hand-written paragraph above the generated block                    | `pnpm check:readmes` fails with "describe <name> in a paragraph above the generated block"                    |
| A new route, pipeline, task, peer, table claim or config leaf regenerates its page   | run `pnpm generate:readmes` and commit the page with the code; the page is part of what a reviewer reads      |
| A wrong or `≈` fact on a page is a generator gap, not a page edit                    | load the `readmes` skill                                                                                      |
