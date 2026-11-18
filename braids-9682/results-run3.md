# Braids end-to-end pass, run 3 (#9682), live stack 2ab28730, main 36a98897e77

Run 2026-11-18, 12:07 to about 12:40 CET. Evidence files are the `r3-*` files beside this file. Run 1 and run 2 files are untouched.

## Read this first: the stack

- Load 8 to 13 on 11 cores, memory pressure red. ClickHouse answered every read in this run (no `memory limit exceeded`).
- The haven browser was restarted under me twice (new pid each time). Each restart re-signed the lane, and the sign-in router dropped it on the project home (`/platform-1-XnKoUj`), not the page it was on (r3-1-06). That is the harness, not the product: `braidTestTrace` had answered 200 in 162 ms just before.
- `authz.createBraid` and `changeBraid` from the UI landed in under a second; no 503s this run.

## Item 1: the create dialog, driven with real key events, as org admin u1

Why the editor took no input in run 2: Monaco 0.55 renders its input as a `div.native-edit-context` (the EditContext API, present in this Chromium). The accessibility ref for "Condition" points at that div, but Monaco's `.view-lines` layer covers it, so a click or `fill` on the ref never lands (Playwright: "`<div class="view-line">` ... intercepts pointer events"), and `haven browser type` then typed into `<body>`. Focusing it by keyboard (Tab from the picker) or clicking `.monaco-editor .view-lines` and then typing works. Not a product defect; an automation trap worth a note in the haven-browser skill.

| Check | Result | Evidence | Note |
|---|---|---|---|
| Keyboard only: open picker (ArrowDown), choose (Enter), Tab to Help, Tab to editor | PASS | r3-1-02 | Focus ring visible on the editor and on "New braid" after the dialog closed |
| Typing in the editor | PASS | r3-1-02 | Real key events; value read back from the Monaco model |
| Autocomplete offers the owner's attribute keys | PASS | r3-1-02 | `orchestrator` (216 spans), `gen_ai.*`, `langwatch.*`. Also offers `langwatch.signature`, which is never a useful condition key (observation) |
| Accepting a key suggestion | **FAIL** | r3-1-03 | Gives `attributes["orchestrator"]]`, see D16 |
| Live check of a broken condition | PASS | r3-1-02, r3-1-03 | `attributes[` : "An unquoted key ... attributes[\"k\"]"; the stray `]` gets "A path without a comparison isn't supported", which misnames the problem (D16). Preview says "Fix the condition to see a preview" |
| Preview counts change with the condition | PASS | r3-1-04, r3-1-05 | `== "web"` 7/17 traces (5 every, 2 some, 10 none), adds 9 spans; `== "cli"` 6/17 (4, 2, 11), adds 3 |
| "Anyone can set this tag" warning with "Turn on only signed calls" | PASS | r3-1-04 | |
| People count | PASS | r3-1-04 | "6 people in orchestrator will see these spans" |
| Signed-calls switch and condition stay in step | PASS | r3-1-08 | Switch on appends ` and Verified("orchestrator")`; Space turns it off and removes it; typing `and Verified("orchestrator")` by hand turns the switch on |
| Switch with no reader key says so | PASS | r3-1-08 | "orchestrator doesn't sign its calls yet, so nothing will show. Create a key (opens in a new tab)" |
| Test a trace with a shared trace id | PASS (with D17) | r3-1-07 | T1 `8c013008…`: "4 spans braided in", the reader's `orchestrator.handle` as context, owner spans with the owner avatar. It includes `specialist.outofwindow`, because the draft starts at 00:00 UTC, not now (D17) |
| Esc closes only the open popup | PASS | | Esc closes the suggest list and keeps the dialog |
| Esc with no popup open | **FAIL (UX)** | r3-1-01, r3-2-03 | Closes the whole dialog and drops the picked project and typed condition, no confirm (D19) |
| Create | PASS | r3-1-09 | Button reads "Braid into orchestrator"; braid listed with Signed badge |
| Success message names the reader project | **FAIL (UX, low)** | r3-1-09 | Toast "Braid created. The change is in the audit log." The spec (braids-screen.feature:137) only asks for the button text, so this is a brief/spec gap, not a spec failure |
| Edit: reader fixed, Save off until a change | PASS | r3-1-10 | |
| Edit saves the change, replaces the braid | PASS | r3-1-11 | Condition now `== "cli"` with Signed; old grant revoked (api log `reason=revocation`) |
| Edit shows the window | **FAIL** | r3-1-10 | Says "From now · no end" for a braid that starts at 00:00 UTC (D17) |
| Remove confirmation copy | PASS | r3-1-12 | "orchestrator stops seeing specialist-agents spans within 30 seconds. Nothing was copied, so nothing is left behind. The removal is recorded in the audit log." Condition shown. Focus starts on Cancel |
| Remove | PASS | listBraids | The UI braid is gone from `listBraids` |
| Row actions are distinguishable to a screen reader | **FAIL (a11y, low)** | snapshot | All 7 row menus are named "Actions for the braid into orchestrator" (D20) |
| Hierarchy | PASS | r3-1-04 | Clear two-column split: what you choose (left) and what it does (right); the one warning is the most prominent note |

## Item 2: narrow viewport, 1280 and dark

`haven browser` has no viewport verb. Used the Playwright library with a storage state from `haven browser login --as` (the sanctioned route in the haven-auth skill), script `.claude/tmp/braids-qa/r3-viewport.mjs`.

| Check | Result | Evidence | Note |
|---|---|---|---|
| Project Braids page at 390 | PASS (minor) | r3-2-01, r3-2-10 | Page does not scroll sideways; the table scrolls inside its frame. Conditions are cut mid-string (`attributes["…`) with the row menu kept visible |
| Organisation Braids page at 390 | **FAIL (UX, low)** | r3-2-02, r3-2-10 | Only the "From" column fits; into, condition and window sit 880 px to the right with no hint that the table scrolls (D21) |
| Dialog at 390 | **FAIL** | r3-2-07 | Left column clipped at the right edge: Into picker ("orches…"), Help link, editor and signed-calls card run under the edge (D18). Preview stacks under it; footer fits |
| Reader trace with braided spans at 390 | PARTIAL | r3-2-04 | The trace drawer opens full width on its Summary tab, with a product tour over the header; the waterfall with braided spans was not reached in the script |
| Dialog at 1280, light | PASS | r3-2-08 | |
| Dialog at 1280, dark | PASS | r3-2-09 | Warning and info notes keep contrast; editor tokens readable |

## Item 3: real SDK runs

PENDING. Delegated to a background agent (Sonnet) that builds one driver, `.claude/tmp/braids-qa/r3-sdk-driver.mjs`, which creates P1 and P2 ingest keys and a fresh P2 signing key over tRPC as u1 and passes the secrets to TS, Python (uv venv under $TMPDIR) and Go programs through env only. Each SDK sends a signed case and a tampered case (`qa.r3.sdk`, `qa.r3.case`) against the live `Verified("orchestrator")` braid `…SS9ncg6c`. Its evidence goes to `r3-3-01-ts.txt`, `r3-3-02-py.txt`, `r3-3-03-go.txt` and `r3-3-04-verify.txt`. The agent had not reported when this file was written; read those files for the verdicts.

## Item 4: probe (d), `spanLangwatchSignals` for the reader

Trace TD `cc95774b284a34efd4eaac5ba5e5a03c`: reader span `r3d.orchestrator.handle` in P2; owner spans in P1: `r3d.specialist.match` (`qa.chain = yes`, matches the live braid `…sjoMxAHs`, with `langwatch.prompt.id`, `langwatch.rag.contexts`, `langwatch.user.id`, `langwatch.thread.id`, `gen_ai.request.model`, `langwatch.input`) and `r3d.specialist.nomatch` (`qa.chain = no`, with prompt, evaluation, rag, scenario and metadata keys). Read as viewer u11 of P2 (r3-4-01).

| Check | Result | Note |
|---|---|---|
| Owner rows come back | PASS | One row: the matching owner span, `ownerProjectId` P1, signals `prompt, user, thread, rag, genai` |
| Same scope as `spanTree` | PASS | `spanTree` shows the reader span and `r3d.specialist.match`; the non-matching owner span is in neither |
| Non-matching owner span leaks through signals | PASS (no leak) | Its evaluation, scenario and metadata buckets are absent |
| Owner protections | PASS (by design) | `spansFull` redacts `langwatch.input` only. Signals carry bucket names, never values, and the read does not consult `ownerProtections` (`trace-drawer-read.service.ts:366-379`), which is safe while buckets stay key-only. Observation: the reader sees the owner's `langwatch.user.id`, `langwatch.thread.id` and `langwatch.prompt.id` values in `spansFull`; ADR-201 shows custom attributes, but these are identity values, so worth a design look alongside D10 |

## Item 5: 500-project picker cap

SKIPPED. Reason: load 13, memory pressure red, the haven browser was killed twice in this run, and run 1 and 2 saw the authz projection lag 2 to 10 minutes. 510 project creations each go through the event-sourced project and grant pipelines and leave rows that need a matching archive pass. The cap is in code: `listBraidTargets` takes at most `BRAID_TARGETS_LIMIT` ids (`modules/authz/contract/src/authz-braids.commands.ts:110`) and the dialog shows "Only the first N projects of the organisation are listed" (`braid-route-fields.tsx:152-155`), covered by `modules/authz/browser/src/ui/sections/braids/__tests__/braid-dialog.integration.test.tsx`. Not checked live.

## Defects, ranked (continuing from D15)

**D17, Medium (privacy and UX): the dialog says "From now", but a new braid starts at 00:00 UTC that day.**
- Steps: New braid, leave Active at its default "From now · no end", create. Open Edit.
- Expected: the braid starts now, or the dialog says it starts at the start of today and that earlier spans of today will show.
- Actual: `newBraidDraft` sets `fromMs: startOfDayMs(nowMs)` (`modules/authz/browser/src/model/braids/braid-draft.ts:31`), and `WindowSummary` prints "From now" whenever the start falls on today's date (`modules/authz/browser/src/ui/blocks/braids/dialog/braid-window-fields.tsx:42-46`). The saved braid lists "From Nov 18, 2026, 12:00 AM UTC" (r3-1-09, r3-1-11), already shows 3 spans from before it was made, and Edit still reads "From now" (r3-1-10). Test a trace showed `specialist.outofwindow` for the same reason (r3-1-07).

**D16, Low: accepting an attribute-key suggestion leaves a doubled `]`.**
- Steps: in the condition editor type `attributes[` (Monaco auto-closes to `attributes[]`), pick `orchestrator` from the list.
- Expected: `attributes["orchestrator"]`.
- Actual: `attributes["orchestrator"]]`, and the live check then says "A path without a comparison isn't supported", which hides the real problem (r3-1-03).
- Cause: the key item inserts `"key"]` (`modules/authz/browser/src/model/braids/braid-condition-language.ts:150`) while the auto-closed `]` stays after the cursor; Monaco's default accept uses the `insert` range (`modules/authz/browser/src/behavior/braid-condition-monaco.ts:112-133`), so the `replace` range that would swallow it is not used.

**D18, Low (UX): at 390 px the dialog's left column runs past the dialog edge.** Into picker, Help link, editor and signed-calls card are clipped (r3-2-07). Cause: `templateColumns={{ base: "1fr", ... }}` at `modules/authz/browser/src/ui/sections/braids/braid-dialog.tsx:286`; a bare `1fr` track keeps a min-content minimum, so the editor's width pushes it. `minmax(0, 1fr)` as on `lg` fixes it.

**D19, Low (UX): Escape in the dialog throws away the draft.** With a project picked and a condition typed, Escape (editor focused, no popup open) closes the dialog with no confirmation and the work is lost (r3-1-01, r3-2-03). Esc with the suggest list open behaves well.

**D20, Low (a11y): every row menu has the same accessible name.** Seven rows into orchestrator are all "Actions for the braid into orchestrator"; add the condition or start date to the name.

**D21, Low (UX): the organisation Braids table at 390 px shows only "From".** Into, condition and window are off-screen in a horizontal scroller with no cue (r3-2-02, r3-2-10).

Observation (not ranked): autocomplete offers `langwatch.signature` and `langwatch.input` as condition keys (r3-1-02).

## Cleanup list (everything run 3 created)

- Braid made and removed in the UI: `rolebinding_000000DRbJAdNJhIS6MJQXwYVaCcR` (created, edited into a replacement, replacement removed). No run 3 braid is live.
- API keys "braids-qa nKoUl" and "braids-qa nKoUj" (created at about 12:18 by `keyFor` in lane r3 after browser restarts wiped local storage; not revoked).
- ClickHouse spans: probe (d) trace `cc95774b284a34efd4eaac5ba5e5a03c` (1 span in P2, 2 in P1).
- Item 3 (if the agent finished): API keys and a signing key named "r3 sdk ..." on P1 and P2. The agent was told to revoke them; check `r3-3-04-verify.txt`.
- Storage state `.claude/tmp/braids-qa/.state-u1.json` (a session credential, mode 600; delete when done). Scripts `.claude/tmp/braids-qa/r3-*`.
- Browser lanes r3 (u1) and r3v (u11) left open; they close after 10 minutes idle.
- Org1 still has "Keep braids to organisation admins" ON (from run 2).
