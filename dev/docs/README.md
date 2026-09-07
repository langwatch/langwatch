# Developer documentation

## Start here

- **[GETTING_STARTED.md](GETTING_STARTED.md)** - fresh clone to running stack: prerequisites, `.env` and secrets, the three processes, the everyday commands
- **[CODING_STANDARDS.md](CODING_STANDARDS.md)** - clean code, SOLID, CUPID, readability
- **[TESTING_PHILOSOPHY.md](TESTING_PHILOSOPHY.md)** - test hierarchy, BDD workflow, what counts as unit vs integration
- **[MANUAL_TESTING.md](MANUAL_TESTING.md)** - driving the product by hand when a test cannot
- **[WORKTREES.md](WORKTREES.md)** - working several branches at once without stacks colliding
- **[RELEASES.md](RELEASES.md)** - release-please components, breaking-change scope, version pinning
- **[LOW_RISK_PULL_REQUESTS.md](LOW_RISK_PULL_REQUESTS.md)** - what qualifies for the reduced review path
- **[lint-rules.md](lint-rules.md)** - every deterministic house rule and the tool that enforces it

## Reference directories

- **[adr/](adr/)** - Architecture Decision Records. Accepted ADRs are authoritative and are never restated in a local doc
- **[best_practices/](best_practices/)** - language and framework conventions: TypeScript, React, ClickHouse queries, error handling, logging, drawers, copywriting
- **[design/](design/)** - the UI design system: principles, components, worked examples
- **[terminology/](terminology/)** - the words the product uses and what each one means
- **[security/](security/)** - security audits of a specific surface

## Working documents

- **[plans/](plans/)** - a plan for work in flight or recently finished: scope, sequencing, definition of done. [strict-feature-layout.md](plans/strict-feature-layout.md) is the live one
- **[research/](research/)** - findings, comparisons and historical records. Nothing here tells you what to do
- **[runbooks/](runbooks/)** - step-by-step operational procedures: replays, purges, dogfood setup, boxd workflows
- **[identity-platform/](identity-platform/)** - the identity programme's deliverable specs, D01 to D13, with its delivery plan

## Where a new document goes

| It is | Put it in |
| --- | --- |
| A decision about architecture | `adr/`, numbered, checked against `main` for collisions |
| A convention other people must follow | `best_practices/` |
| A plan for work about to start or in flight | `plans/` |
| An investigation, comparison or record of something finished | `research/` |
| A procedure someone runs against a live system | `runbooks/` |
| Behaviour the product must have | not here at all: write a `.feature` file in `specs/` |

## Also see

- `CLAUDE.md` and `AGENTS.md` at the repository root - the operating contract
- `tools/thuishaven/README.md` - the hostname-routed local stack

## Writing docs

Be token-conscious. Document project-specific decisions only, not googlable
content. Neutral technical register.
