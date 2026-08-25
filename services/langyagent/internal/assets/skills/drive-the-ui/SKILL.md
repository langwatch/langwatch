---
name: drive-the-ui
description: Drive the page the user has open through live UI actions. List the actions a page accepts, call them with typed payloads, and read the live state including unsaved edits. Use when the user is looking at a page you can operate, such as the evaluations workbench, and a change should happen in front of them rather than behind their back.
license: MIT
compatibility: Requires the LangWatch CLI inside a Langy worker session. UI actions run mid-turn only.
metadata:
  category: skill
---

# Drive the Page the User Has Open

Some pages accept live UI actions. When the turn context says the current page does, you can operate it directly: the action executes in the user's browser, they watch it happen, and the result comes back to you in the same command. When no browser answers, the platform applies the same action on the backend and tells you which happened.

## The three commands

```bash
langwatch ui actions
```

Lists the action kinds the current page accepts, with the JSON schema for each payload and the permission it needs. Run it before your first call on a page; never guess a kind or a payload shape.

```bash
langwatch ui call <kind> --payload '<json>'
langwatch ui call <kind> --payload-file <path>   # or - for stdin
```

Calls one action and blocks until it is done. Use `--payload-file` for any payload holding text a person wrote, above all a prompt: prose has apostrophes, one apostrophe ends the shell's quoting, and the rest of the payload then arrives as separate arguments, which the command refuses. Write the JSON to a file first, or pipe it in. Keep `--payload` for payloads that are only ids and numbers.

The result carries `executedVia`:

- `"browser"`: the user's open page applied it. They saw it happen.
- `"backend"`: no page answered, the platform applied it to the saved state. The page has not caught up.

**Say where the change happened.** When you report work you did, name the place, because those are two different places for the reader. `"browser"` means it is on the page in front of them, so point at it: "the new column is on your table now". `"backend"` means it is on the saved workbench and their page is behind, so tell them that: "I made it on the saved workbench, so reload the page to see it". This is not decoration. A reader watching a page they think is current, which is not, will read stale numbers and believe them.

Say it once for a run of work, not once per call. A loop that made six changes reports where the six landed, not six sentences.

Only claim the page shows something when `executedVia` said `"browser"` for that action. If you did not read `executedVia`, say nothing about the page at all. Guessing wrong here is worse than staying quiet, because the reader trusts what you tell them about their own screen.

`executedVia` names the path that ran the action, not the outcome. The write landed only when the answer's `result` names what it touched, such as the new target id, the model, or the row count. When `result` names nothing, read the state again before you build on it.

```bash
langwatch workbench get-state <experiment-slug>
```

The workbench read, sugar over `ui call workbench.getState`. Browser first, so it includes unsaved prompt drafts and in-memory results; falls back to the saved state and marks the source. Use it before you change anything and after anything surprising.

All three print the platform's answer as JSON already, so parse what they print. They also take `--format`, `-o` and `--jq` like every other command, which is how you ask for less than the whole answer.

## Rules

- UI actions run mid-turn only. Outside a turn the call is refused with `langy_ui_turn_inactive`.
- One action, one intent. Do not chain `ui call` with other commands; run it alone so the result is attributable.
- On `langy_ui_payload_invalid`, read `meta.issues`, fix the payload, and retry once.
- On `langy_ui_timeout`, the page claimed the action and went silent. Do not retry blind: re-read the state first, the action may have half-applied.
- Your edits are undoable by the user with ordinary undo, and every batch lands as a restorable version. Do not undo or restore on their behalf.
- The action's permission is enforced on your session key. A refusal means the user's own role does not allow it; say so, do not look for another way in.

## Workbench action kinds

`workbench.duplicateTarget`, `workbench.setTargetPrompt`, `workbench.updateTargetModel`, `workbench.setMapping`, `workbench.setEvaluatorMapping`, `workbench.addEvaluator`, `workbench.addTarget`, `workbench.setCellValue`, `workbench.addColumn`, `workbench.addRows`, `workbench.removeTarget`, `workbench.getState`, `workbench.run`.

For the prompt improvement loop that uses these, follow the prompt-optimization skill.
