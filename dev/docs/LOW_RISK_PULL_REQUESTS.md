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
  - Documentation (`docs/`, `dev/docs/`, any `README.md`).
  - BDD feature specs (`specs/` directory).
  - Raster images (`.png`, `.jpg`, `.gif`, `.webp`; `.svg` only under `docs/`).

Automation enforces that list as a path allowlist before any AI evaluation. Other `.md` files are not on it: a `SKILL.md` or prompt file ships as agent instructions. The review pipeline is never low risk: a file at the repository root, anything under `.github/`, `cmd/`, `tools/` or `pkg/ciscan/`, or at any depth a `.claude/` directory, `.mcp.json`, `CLAUDE.md`, `AGENTS.md`, `go.mod` or `go.sum`.

If you are unsure, do **not** use `low-risk-change`; request a normal review instead.

## How the Flow Works

1. Create a PR and link it to the relevant issue/ticket.
2. Describe the change and briefly state why it is low risk.
3. The AI evaluation runs automatically on every PR and applies the `low-risk-change` label if qualifying.
4. The PR can be merged **without review** only if:
   - The `low-risk-change` label is present (applied by automation, not manually).
   - All required CI checks are green.
   - The target branch is protected (no direct pushes; status checks required).

PRs that do not meet these conditions follow the reviewed path below.

## PRs That Are Not Low Risk (`needs-ack`)

A PR that does not qualify gets the `needs-ack` label and a comment saying why it is risky. Automation approves it, with no human review, once:

- The automated review bot's latest review of the head commit has no P0/P1 (blocking) finding.
- All required CI checks are green, as named by the rulesets and the branch protection on the base branch.

The daily change report lists merged `needs-ack` PRs so a human acknowledges each risky change after it ships. A PR that changes or renames the review pipeline (the paths listed above) is never approved this way and needs a human approval.

## Firefighting Label

For urgent fixes that cannot wait for review, use the `firefighting` label instead. Unlike `low-risk-change`, this label can be applied manually by any team member and bypasses the approval check. Use it responsibly and only for genuine emergencies.

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
