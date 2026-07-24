# ADR-018: Form Validation and Save Button Behavior

**Date:** 2026-05-05

**Status:** Accepted

## Context

LangWatch has dozens of settings, model-provider, team, role, and dialog forms. Until this point, the codebase has had a *de-facto* convention for how Save buttons interact with form validation — observable by reading the existing forms (`ChangePasswordDialog`, `RoleFormDialog`, `LLMModelCostDrawer`, `TeamForm`, `useProviderFormSubmit`, etc.) — but no written record of *why*. As a result:

- New forms occasionally diverge (e.g. someone adds `disabled={!isValid}` to a Save button because it "feels" safer).
- Reviewers have no doc to point at when nudging back toward the convention.
- Bugs like #3785 — where a Save silently no-ops because the form's underlying state doesn't match what's displayed — are easy to introduce because the boundary between "what can be saved" and "what should be saved" is not articulated.

The trigger for writing this down: while fixing #3785 (provider-default mismatch silently persisting cross-provider values), the question came up — should we *disable* the Save button when the model selection is invalid for this provider, or let the user click and surface a validation error? That question turned out to have an implicit, never-documented answer in the codebase.

## Decision

**Save buttons are clickable whenever the user has finished entering data. Validation runs on submit. Errors surface inline (field-level) or via toast (cross-field / backend). Save is disabled *only* while the request is in flight.**

In code form:

```tsx
<Button
  type="submit"
  disabled={mutation.isPending}     // ✅ in-flight only
  // disabled={!form.formState.isValid}   // ❌ never
>
  Save
</Button>
```

Validation responsibility is split:

| Layer | Where | Tool | Surface |
|---|---|---|---|
| Field-level (sync schema rules) | `react-hook-form` + `zodResolver` | Schema | `<Field.ErrorText>` inline |
| Cross-field (one input depends on another) | Submit handler | Manual | `toaster.create({type:"error"})` + `return` before mutation |
| Server-side (uniqueness, auth, business rules) | Mutation `onError` | tRPC error | `toaster.create({type:"error"})` |

A submit handler that detects an invalid cross-field state **must `return` before any mutation fires** and **must surface why** through a toast or inline error. Silent no-ops are forbidden — they are the failure mode that produced #3785.

**Inputs are a separate category from action buttons.** A disabled *input* (a select with no options to pick, a date field outside its allowed range) is fine and often clearer than an enabled-but-empty one. The "no `disabled={!isValid}`" rule applies to **submit/action buttons**, where the user is choosing whether to commit. An input whose underlying domain is empty isn't hiding a constraint — there's nothing to choose. Pair the disabled input with a hint that explains *why* and *what to do* (see #3785: empty `chatOptions` → disabled `ProviderModelSelector` + "Add one in the Custom Models section above").

## Rationale

### Why not `disabled={!isValid}`

1. **A disabled button is silent.** It tells the user "you can't proceed" without saying *why*. Users hunt for the broken field, fail, and bounce.

2. **`isValid` can lie.** React-hook-form's `formState.isValid` reflects the most recent validation pass, which may not have run on every field. If validation is async (uniqueness, server-side), the button would either need to always-disable while pending (jittery) or risk being out-of-date.

3. **Some users click Save *to* discover what's wrong.** Especially in long forms — they want the system to point to the broken field. A pre-disabled button removes that affordance.

4. **Consistency with existing forms.** Every shipped LangWatch form follows this pattern (sample: `ChangePasswordDialog.tsx:149`, `RoleFormDialog.tsx`, `TeamForm.tsx`, `LLMModelCostDrawer.tsx`). Diverging adds cognitive load without benefit.

### Why surface errors at submit time

- Errors that fire on every keystroke are noisy; users haven't finished thinking yet.
- Errors that fire only on blur miss cross-field problems (one field's validity depends on another).
- Submit-time validation is the moment the user has *committed* — the right moment to confront them with what's wrong.

### Why toasts for cross-field errors

- Inline errors live at one field. Cross-field errors don't have a single home.
- A toast pulled to the corner of the screen with a clear "Cannot save: X" title is unambiguous.
- For especially impactful errors (e.g. #3785's "you'd persist a contradiction"), the toast can describe the *consequence*, not just the state.

## Consequences

- New forms that ship with `disabled={!isValid}` should be rejected in review with a link to this ADR.
- The existing `useProviderFormSubmit` hook is the canonical example for the cross-field validation pattern (gates `updateProjectDefaultModels` mutation on provider-prefix match before firing — see #3785).
- The design guideline (`dev/docs/design/guidelines.md` §6) summarises the rule with code patterns; this ADR captures the *why* and the alternatives considered.
- We accept the risk that a user clicks Save on an obviously-broken form and only discovers the error after the click. In practice the click is cheap; the cost of a confusing disabled button is higher.

## Alternatives considered

1. **Hard-disable on `!isValid`.** Rejected because it hides reasons and conflicts with async validation; see Rationale §1-3.

2. **Disable + inline reason.** "Disable the button, but render text under it explaining why." Slightly better than pure-disable, but: (a) users still can't click to see all errors at once, (b) the hint text is easy to miss, (c) requires a non-standard layout per form.

3. **Mixed: disable for sync errors, allow for async.** Inconsistent — would mean the same button behaves differently depending on what's wrong. Cognitive load >> benefit.

4. **Three-tier surface (inline → banner → toast).** A banner inside the form for cross-field errors, escalating to a toast only for backend errors. We may adopt this later for very long forms; for now, the toaster is consistent and visible.

## References

- #3785 — bug that triggered this ADR: provider-default silent no-op
- `dev/docs/design/guidelines.md` §6 — implementation summary
- `langwatch/src/hooks/useProviderFormSubmit.ts` — canonical implementation of cross-field submit-time validation
