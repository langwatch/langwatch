Intro text.

<!-- parity-status:start -->
## Parity status

_Latest run: 2026-09-30 05:48 UTC · commit `5ae6959` · stack `visualdiff-check` · compared with main's baselines_

**Verdict: not ready.** API: 3 of 5 scenarios pass. UI: 2 of 3 flows pass. Not usable from this run: API, Fuzz API, Fuzz UI (see "Test runs").

### Coverage by area

| | area | API vs main (latest run) | UI proven against main | not tested yet or failing |
|---|---|---|---|---|
| 🔴 | AI gateway | not tested yet | not tested yet |  |
| 🔴 | Agent testing | not tested yet | not tested yet |  |
| 🔴 | Analytics and LangWatchQL | 0/1 · 1 failing | not tested yet |  |
| 🔴 | Automations and webhooks | not tested yet | not tested yet |  |
| 🔴 | Coding agents | not tested yet | not tested yet |  |
| 🔴 | Evaluations and monitors | not tested yet | not tested yet |  |
| 🔴 | Experiments and optimisation | not tested yet | not tested yet |  |
| 🔴 | Files and media | not tested yet | not tested yet |  |
| 🔴 | Governance and Connect | not tested yet | not tested yet |  |
| 🔴 | Instant evals | not tested yet | not tested yet |  |
| 🔴 | Langy | not tested yet | not tested yet |  |
| 🔴 | Model providers and secrets | not tested yet | not tested yet |  |
| 🔴 | Ops, admin and health | not tested yet | not tested yet |  |
| 🔴 | Organisations, teams and access | not tested yet | not tested yet |  |
| 🔴 | Prompts and playground | not tested yet | not tested yet |  |
| 🔴 | SCIM | not tested yet | not tested yet |  |
| 🔴 | Sign-in and CLI login | not tested yet | not tested yet |  |
| 🔴 | Tracing and ingestion | not tested yet | not tested yet |  |
| 🔴 | Workflows | 1/2 · 1 failing | 1 of 2 flows pass |  |
| 🟠 | Other | 1/1 | not tested yet |  |
| 🟢 | Datasets | 1/1 | 1 of 1 flows pass | exports |

### Open defects

| area | what's wrong | failing | examples | status |
|---|---|---|---|---|
| Workflows | REST create answers 400 | 1 scenarios, 1 UI flows | `wf-create` · `workflow-run` | fixing |
| Analytics and LangWatchQL |  | 1 scenarios | `q-run` | open |

**Found in review, no scenario yet:** kept by hand.

### Test runs

| check | latest run | run before | usable? |
|---|---|---|---|
| API: apidiff, 8 scenarios | 3 pass · 1 fail · 1 tool errors · 3 deferred to the self-hosted pass | 2,449 pass · 70 fail · 326 tool errors | no, rerun: too many tool errors |
| UI: visualdiff | 2 of 3 flows pass · 10 of 12 routes without a finding | not recorded | yes |
| Fuzz API: 736 operations, 21,912 requests | 3 findings, 2 of them 502s from the proxy | not recorded | no, rerun: most findings are 502s from the proxy |
| Fuzz UI | 5 of 130 routes visited · 2 findings, 1 never finished loading | not recorded | no, rerun: stopped, 10 consecutive errors, most common cause: still loading (x10) |

### Next

1. Hand-kept.

<details><summary>Decisions made</summary>

- kept

</details>
<!-- parity-status:end -->

Outro.
