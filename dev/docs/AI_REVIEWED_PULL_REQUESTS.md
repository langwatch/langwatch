# AI-Reviewed Pull Requests

This document describes when a pull request (PR) may be merged without manual
human review by using the `ai-reviewed-change` label, in line with our ISO
27001 change management process (Annex A 8.32). It is the middle tier between
[low-risk PRs](LOW_RISK_PULL_REQUESTS.md) (merge on classification alone) and
normal PRs (merge on human approval): real code changes may merge when
independent AI reviewers have reviewed the exact code being merged and found
nothing outstanding, and the change's impact is medium or lower.

## When a PR Qualifies

A PR qualifies as **AI-reviewed** only when ALL of the following hold:

### 1. Every required AI reviewer has reviewed the current head

The required AI reviewers are:

- **CodeRabbit** (`coderabbitai[bot]`) — counted from its latest review's
  commit SHA.
- **The LangWatch PR reviewer** (`langwatch-agent`) — counted only from a
  review containing its machine-readable `LangWatch-Review:` verdict trailer;
  the trailer's SHA states which head the agent actually read.

A review counts for the current head when its SHA matches the head, **or**
the changes since the reviewed SHA are only minor tweaks: a small number of
changed lines, in existing files only, touching no restricted paths. Anything
larger — new files, restricted paths, or a force-push that removed the
reviewed SHA — makes the review stale, and the reviewers must review the new
head before the PR can qualify.

### 2. No outstanding AI review comments

Zero unresolved review threads from the required AI reviewers. Resolving a
thread counts as addressing it — the automation re-evaluates when threads
are resolved, so a PR can qualify after its findings are dealt with.

### 3. Impact is medium or lower

The automated impact evaluation (see
[PR_IMPACT_EVALUATION.md](PR_IMPACT_EVALUATION.md)) must classify the PR as
`low` or `medium` impact. The same exclusions as the low-risk policy apply
absolutely — a PR is **never** AI-reviewed-mergeable if it touches:

- Authentication or authorization logic.
- Secrets, encryption, or security settings.
- Database schemas, migrations, or data models.
- Business-critical logic (billing, reporting, financial calculations).
- Integrations with third-party systems or external APIs.
- CI/CD workflows or the policy documents governing this process.

These changes always require human review, no matter how clean the AI
reviews are.

## How the Flow Works

1. Create a PR; CodeRabbit and the LangWatch PR reviewer review it
   automatically.
2. Address or resolve any findings they raise.
3. The auto-approve workflow re-evaluates on every push, review submission,
   and thread resolution. When all conditions hold, it applies the
   `ai-reviewed-change` label, posts an assessment comment recording which
   reviews were counted (reviewer, SHA), and submits the bot's approving
   review.
4. The PR can then merge once all required CI checks are green.

The AI reviewers themselves never approve: CodeRabbit's approval verdicts are
disabled and the LangWatch reviewer only ever posts `COMMENT` reviews. The
only automated approver is the workflow's bot review, granted after all
conditions above are verified.

## Label Validity

- The `ai-reviewed-change` label is audit evidence, not an input — applying
  it manually grants nothing; the workflow evaluates from scratch every run.
- Any new commit strips the label and the bot approval (branch protection
  dismisses stale reviews); the PR re-qualifies only when the conditions
  hold for the new head.

## Evidence

For audits, we rely on:

- The PR record: diff, author, `ai-reviewed-change` label, and the
  assessment comment naming the counted reviews and their SHAs.
- The AI reviewers' review records on the PR (SHAs, findings, thread
  resolution history).
- The workflow run logs and CI/deployment logs from our standard pipeline.
