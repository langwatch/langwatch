# ADR-001: Digest owns the weekly email's template choice

**Status:** Proposed

**Behavioural contract:** [Weekly digest emails](../specs/digest.feature)

**Related:** `dev/docs/plans/weekly-digest.md` and `dev/docs/ARCHITECTURE.md` section 4.

## Context

LangWatch Cloud sends each person one weekly email about their week's usage, picked from five
templates by what their data shows. Operators choose the cohort and preview every email in Cloud
admin before anything is sent; anyone can unsubscribe in one click. Today only the template
choice exists as code: the pure rules that pick one of five templates from a member's week.

## Decision

`digest` is an enterprise module that owns the weekly digest: the template rules, the week's
fold, the send and the unsubscribe. The process half currently holds the rules only
(`digest-template.rules.ts`, thresholds tuned from the Cloud admin gallery, first eligible template
wins). The app, installer, contract and transports are not built; this ADR is Proposed until they are.

## Public surfaces and transports

None yet. The record's shape (section 3) gives the module a contract with a `DigestApi`, an app
implementing it and an installer; sending mail and the admin preview go through those, not
through the rules.

## Dependencies

None today. The eventual module reads usage through other modules' `*Api` tokens and sends through
the mail channel; it holds no analytics client (nurturing owns product analytics).

## Persistence

None today. Click and unsubscribe counts need an owned table when the send is built.

## Runtime and registration

Not installed in any process. The package exists so the rules and their unit tests have an owner.

## Environment and configuration

None. Thresholds are constants in the rules file, not environment settings.

## Errors

The rules are total: every input picks a template, and an input that does not parse is refused by
the Zod schema before a rule runs.

## Contracts and validation

`digestTemplateInputSchema` validates a member's week; `digestTemplateIdSchema` is the closed set
of template ids. The scenarios in `specs/digest.feature` are the requirements for the pick.

## Consequences

The pick is testable and settled before the rest is built. Until the app and installer exist the
shape policy reports `no-app` and `no-installer` for this module; building them closes both.
