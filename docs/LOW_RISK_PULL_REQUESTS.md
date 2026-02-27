# Low-Risk Pull Requests

This document describes when a pull request (PR) may be merged without manual review by using the `low-risk-change` label, in line with our ISO 27001 change management process (Annex A 8.32).

## When a PR Is Low Risk

A PR may be treated as **low risk** only if:

- It does **not** change:
  - Authentication or authorization logic.
  - Secrets, encryption, or security settings.
  - Database schemas, migrations, or data models.
  - Business‑critical logic (e.g. billing, reporting, financial calculations).
  - Integrations with third‑party systems or external APIs.

- It is limited to:
  - UI text, layout, or styling.
  - Documentation, comments, or code formatting.
  - Other configuration or code that is explicitly documented as low risk and easy to revert.

If you are unsure, do **not** use `low-risk-change`; request a normal review instead.

## How the Flow Works

1. Create a PR and link it to the relevant issue/ticket.
2. Describe the change and briefly state why it is low risk.
3. Optional: run the AI/automation to check the diff and apply the `low-risk-change` label.
4. The PR can be merged **without review** only if:
   - The `low-risk-change` label is present.
   - All required CI checks are green.
   - The target branch is protected (no direct pushes; status checks required).

PRs that do not meet these conditions must follow the normal review and approval process.

## Label Validity

- The `low-risk-change` label is only valid for the specific diff that was evaluated.
- Any new commit pushed to the PR after the label was applied must trigger either:
  - Automatic removal of the `low-risk-change` label, or
  - Re‑evaluation by the AI/automation, which may re‑apply the label if the updated diff still qualifies as low risk.

## Evidence

For audits, we rely on:

- The issue/ticket linked in the PR.
- The PR record (diff, author, `low-risk-change` label, AI/automation comments if used).
- CI and deployment logs from our standard pipeline.
