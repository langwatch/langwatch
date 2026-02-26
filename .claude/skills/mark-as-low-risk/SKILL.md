---
name: mark-as-low-risk
description: "Evaluate a PR against the Low-Risk Pull Requests policy and, if it qualifies, label and comment so it can merge without review."
user-invocable: true
argument-hint: "PR URL or number"
---

# Skill: Low-Risk PR Classifier

Use this skill only when I explicitly invoke it on a specific pull request.

## What You Must Use

When this skill is invoked, you should:

1. Read the **Low-Risk Pull Requests** document in this repository.
2. Read the PR title, description, and full diff.
3. Read the linked issue/ticket if there is one.
4. Use the GitHub API or `gh` CLI (if available) to:
   - Add labels to the PR.
   - Post a comment on the PR.

Always apply the criteria from @docs/LOW_RISK_PULL_REQUESTS.md. Do not invent your own rules.

## Decision Logic

Evaluate the PR strictly against the documented low‑risk definition.

### If the PR qualifies as low risk

- Add the `low-risk-change` label to the PR.
- Post an auditor‑friendly comment, for example:

  > Automated low-risk assessment  
  >  
  > This PR was evaluated against the repository’s **Low-Risk Pull Requests** procedure.  
  > - Scope: [brief summary of change]  
  > - Exclusions confirmed: no changes to auth, security settings, database schema, business-critical logic, or external integrations.  
  > - Classification: **low-risk-change** under the documented policy.  
  >  
  > This classification allows merging without manual review once all required CI checks are passing and branch protection rules are satisfied.

- Do **not** merge the PR yourself.

### If the PR does *not* qualify or is unclear

- Do **not** add the `low-risk-change` label and refuse the user's request.

## Expected Response Format to the User

After applying the rules and updating GitHub, respond in this format:

- LABEL_APPLIED: yes/no  
- REASONS:  
  - Bullet 1  
  - Bullet 2 (optional)  
- ACTIONS_TAKEN:  
  - e.g. "Added low-risk-change label and posted assessment comment on PR #123"  
  - or "No label applied; posted comment explaining why PR is not low risk"

## Notes

- This skill never merges the PR; it only evaluates, labels (if appropriate), and comments.
- Any new commit pushed to the PR invalidates previous low‑risk decisions. After new commits, this skill should be invoked again on the updated PR.
