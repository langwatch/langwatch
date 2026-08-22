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
```

Calls one action and blocks until it is done. The result carries `executedVia`:

- `"browser"`: the user's open page applied it. They saw it. Say "watch the table" style things.
- `"backend"`: no page answered, the platform applied it to the saved state. Say "reload when you are back" style things.

```bash
langwatch workbench get-state <experiment-slug>
```

The workbench read, sugar over `ui call workbench.getState`. Browser first, so it includes unsaved prompt drafts and in-memory results; falls back to the saved state and marks the source. Use it before you change anything and after anything surprising.

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
