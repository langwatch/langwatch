# Lint burndown — priorities and lanes (2026-09-23)

Measured on `feat/strict-feature-layout-v0` @ 7d43a7e8dd, whole tree:
**11,416 findings, 116 rules, 16,531 files** (8,483 in source, 2,933 in tests). The rules are settled
(lanes lint-L1…L9); everything below fixes code, never rules.

Manifests: `.claude/manifests/lint-fix-<lane>.md` (common brief `lint-fix-common.md`). Each lane owns an
exact file list in `.claude/manifests/lint-fix-files/<lane>.txt`; every finding is in exactly one lane, and no two lanes of one wave share a file (`assign.py` there re-derives the split from a fresh
`oxlint --format=json` run — re-run it before each wave, the lists go stale as waves land).

## Priority order

| wave | priority | what                                                                                                                                       | findings | why this order                                                                                                   |
| ---- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------ | -------- | ---------------------------------------------------------------------------------------------------------------- |
| W0   | P0       | mechanical: type imports, duplicate imports, test renames, comment trims, em dashes, unused vars                                           | 870      | cheap per finding, one autofix command covers 273; clears noise before judgement work                            |
| W1   | P0       | correctness: promises, unsafe chaining/spread, stringified objects, sort comparators, hook deps, tests that cannot fail, data-path queries | 1,485    | the only findings that can be live bugs or holes in the suite                                                    |
| W2   | P1       | architecture boundaries: transports, layers, kit law, stores, env, contract ownership, cycles                                              | 1,361    | CLAUDE.md "hold absolutely" rules; each fix removes a coupling                                                   |
| W3   | P2       | shape and naming: max-params, module classes, file layout, boundary types, Temporal, Zod composition                                       | 2,694    | file moves first — one change clears several findings                                                            |
| W4   | P3       | test doubles: stand-in casts, prototype stubs, logger spies                                                                                | 1,584    | tests only; breaks nothing today                                                                                 |
| W5   | P4       | readability: complexity, nested ternaries, `any`, a11y; plus SDK/tooling                                                                   | 2,271    | per-site, highest cost per finding                                                                               |
| W6   | P2       | verb conversion: nullable `find*` (706) and `try*` (445) to get-throws / find-array, callers included                                      | 1,151    | Alex 2026-09-23: "no dropping" — converted, never downgraded; after W3 because it rewrites the same repositories |

Waves run in order (a wave's lanes share files with the next wave's). Inside a wave the lanes are disjoint;
respect the three-lane ceiling. W0 is one lane and short — run it alone first.

## Lanes

| lane                         | findings | files | agent              | top rules                                                                          |
| ---------------------------- | -------- | ----- | ------------------ | ---------------------------------------------------------------------------------- |
| `W0-mechanical`              | 870      | 631   | `lane-opus-low`    | comment-block-size 315, consistent-type-imports 179, unit-test-does-not-render 132 |
| `W1-data-path`               | 36       | 27    | `lane-opus`        | unbounded-loop 22, prisma-count-in-list-query 8, no-multiple-resolved 2            |
| `W1-react-hooks`             | 127      | 73    | `lane-opus-medium` | exhaustive-deps 121, no-form-watch-in-child 5, no-standalone-expect 1              |
| `W1-tests-that-cannot-fail`  | 591      | 225   | `lane-opus-medium` | unbound-method 197, no-conditional-expect 142, warn-todo 79                        |
| `W1-values-and-promises`     | 731      | 385   | `lane-opus-medium` | no-base-to-string 232, no-redundant-type-constituents 87, await-thenable 52        |
| `W2-boundaries-agents`       | 350      | 79    | `lane-opus`        | transport-declares 142, module-layers 96, rest-route 64                            |
| `W2-boundaries-experiment`   | 215      | 85    | `lane-opus`        | transport-declares 72, module-layers 36, rest-route 33                             |
| `W2-boundaries-identity`     | 174      | 59    | `lane-opus`        | transport-declares 59, module-layers 49, rest-route 32                             |
| `W2-boundaries-observe`      | 221      | 69    | `lane-opus`        | rest-route 64, transport-declares 63, module-layers 51                             |
| `W2-boundaries-platform`     | 116      | 51    | `lane-opus`        | environment-boundaries 47, module-layers 26, package-boundaries 12                 |
| `W2-kit-law-browser`         | 285      | 189   | `lane-opus`        | package-boundaries 283, no-cycle 2                                                 |
| `W3-shape-agents`            | 740      | 316   | `lane-opus-medium` | explicit-module-boundary-types 201, module-classes 123, max-params 81              |
| `W3-shape-experiment`        | 403      | 244   | `lane-opus-medium` | max-params 109, module-classes 70, explicit-module-boundary-types 52               |
| `W3-shape-identity`          | 545      | 232   | `lane-opus-medium` | explicit-module-boundary-types 89, module-classes 82, temporal-only 79             |
| `W3-shape-observe`           | 563      | 248   | `lane-opus-medium` | max-params 136, module-classes 118, temporal-only 92                               |
| `W3-shape-platform`          | 443      | 162   | `lane-opus-medium` | max-params 120, temporal-only 92, explicit-module-boundary-types 79                |
| `W4-test-doubles-agents`     | 290      | 150   | `lane-opus-medium` | stand-in-cast 248, shared-setup-is-a-hook 21, test-description-is-an-action 14     |
| `W4-test-doubles-experiment` | 408      | 188   | `lane-opus-medium` | stand-in-cast 356, no-prototype-stub 20, shared-setup-is-a-hook 18                 |
| `W4-test-doubles-identity`   | 329      | 155   | `lane-opus-medium` | stand-in-cast 309, test-description-is-an-action 10, shared-setup-is-a-hook 10     |
| `W4-test-doubles-observe`    | 354      | 194   | `lane-opus-medium` | stand-in-cast 323, shared-setup-is-a-hook 16, test-description-is-an-action 13     |
| `W4-test-doubles-platform`   | 203      | 121   | `lane-opus-medium` | stand-in-cast 187, test-description-is-an-action 9, shared-setup-is-a-hook 4       |
| `W5-readability-agents`      | 339      | 161   | `lane-opus-medium` | no-nested-ternary 151, cognitive-complexity 97, prefer-tag-over-role 38            |
| `W5-readability-experiment`  | 529      | 258   | `lane-opus-medium` | cognitive-complexity 177, no-explicit-any 133, no-nested-ternary 129               |
| `W5-readability-identity`    | 237      | 134   | `lane-opus-medium` | no-nested-ternary 78, cognitive-complexity 64, no-explicit-any 59                  |
| `W5-readability-observe`     | 325      | 158   | `lane-opus-medium` | no-explicit-any 114, cognitive-complexity 107, prefer-tag-over-role 52             |
| `W5-readability-platform`    | 520      | 144   | `lane-opus-medium` | no-explicit-any 341, cognitive-complexity 128, condition-shape 22                  |
| `W5-sdk-and-tooling`         | 321      | 151   | `lane-opus-medium` | cognitive-complexity 152, no-explicit-any 101, no-nested-ternary 26                |
| `W6-verbs-agents`            | 411      | 217   | `lane-opus`        | fallible-result-naming 280, banned-verb-prefix 131                                 |
| `W6-verbs-experiment`        | 129      | 77    | `lane-opus`        | fallible-result-naming 107, banned-verb-prefix 22                                  |
| `W6-verbs-identity`          | 278      | 139   | `lane-opus`        | banned-verb-prefix 195, fallible-result-naming 83                                  |
| `W6-verbs-observe`           | 269      | 137   | `lane-opus`        | fallible-result-naming 226, banned-verb-prefix 43                                  |
| `W6-verbs-platform`          | 64       | 40    | `lane-opus`        | banned-verb-prefix 54, fallible-result-naming 10                                   |

Groups: **identity** (identity, auth, authz, organization, user, api-key, project, … + enterprise sso/scim/audit-log/licensing/billing),
**observe** (trace, analytics, evaluation, topic, annotation, metric, dashboard, monitor, log, stored-object),
**agents** (langy, coding-agent, agent, gateway, model-provider, hosted-mcp, github, webhook + enterprise governance),
**experiment** (experiment, scenario, suite, workflow, evaluator, dataset, prompt, automation, instant-eval),
**platform** (every other module, packages, apps, services).

## Rulings

1. **Nullable `find*` and `try*` (1,151) are converted — "no dropping" (Alex, 2026-09-23).** Supersedes the
   2026-09-16 "leave the existing ones" decision for these findings. No rule goes to `warn`, no lane is downgraded to
   a cheaper model. W6 runs as five `lane-opus` lanes; cross-module `*Api` callers come back as shared-file requests.
2. **`vitest(warn-todo)` (79, prompt 51 + governance 26).** W1-tests lists each with what it would cover; keep or delete per item.

## Things every lane will hit

- **New `*Api` operations need approval.** Most of W2's 343 `transport-declares` findings move a branch out of a
  handler into the module; where no operation fits, lanes list the operation and do not add it. Expect a batch of
  approval requests from each W2 boundaries lane.
- **Kit creation is coordinator work.** W2-kit-law-browser will request new kit packages (catalogue, package.json,
  `pnpm sync:references`) rather than create them.
- **Wires stay fixed.** `rest-route` path-parameter renames are safe; status/body changes are not.
- **Cost.** No langwatch rule has an autofix. W0 and the file-move halves of W3 are where one change clears many;
  W4/W5 are one change per finding. Every lane stays on the model its manifest names.
