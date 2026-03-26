---
name: postmortem
description: "Structured incident investigation and post-mortem creation. Investigates root cause, writes a Notion post-mortem page, and creates tracking GitHub issues. Usage: /postmortem <incident description>"
user-invocable: true
argument-hint: "RDS CPU exhaustion"
---

# Post-Mortem

Running structured incident post-mortem for: **$ARGUMENTS**

## Phase 1: Investigate

Run `/investigate $ARGUMENTS` to gather data before writing anything.

The investigation phase should cover:

1. **Infrastructure metrics** — CloudWatch CPU, connections, IOPS, credit balance for the affected service
2. **Database diagnostics** (if DB-related):
   - Performance Insights: top SQL by load during the incident window
   - `pg_stat_activity`: active/blocked queries, lock chains
   - Index analysis: missing indexes, unused indexes, sequential scans on large tables
   - Table stats: dead tuples, autovacuum lag
3. **Code path tracing** — map hot queries back to application code and git history
4. **Investigated and ruled out** — list hypotheses you checked and evidence that eliminated them

Capture all findings before proceeding to Phase 2.

---

## Phase 2: PII Check

**MANDATORY before writing anything to Notion or GitHub.**

Scan all findings from Phase 1:

- Strip any user IDs, email addresses, IP addresses, customer names, or other PII from examples
- Replace real identifiers with placeholders: `user_id=<REDACTED>`, `email=<REDACTED>`
- Sanitize SQL query examples: real table/column names are fine, real data values are not
- Verify no secrets, tokens, or credentials appear in any content

Do not proceed until the content is clean.

---

## Phase 3: Write Post-Mortem to Notion

**Prerequisites:**
- `NOTION_API_KEY` must be set in the environment. Never hardcode it.
- Parent page ID: `32e5e165-d482-80e2-bf9b-ef42132f7424`

### 3a. Derive page title

Format: `YYYY-MM-DD <Incident Title>` — e.g. `2026-03-25 RDS CPU Credit Exhaustion (langwatch-pg)`

Use today's date unless the incident occurred on a different date.

### 3b. Create the Notion page

Use the Notion API to create the page. All calls must read the API key from `$NOTION_API_KEY`.

```bash
curl -s -X POST "https://api.notion.com/v1/pages" \
  -H "Authorization: Bearer $NOTION_API_KEY" \
  -H "Content-Type: application/json" \
  -H "Notion-Version: 2022-06-28" \
  -d '<payload>'
```

### 3c. Page structure

Build the page blocks in this exact order:

1. **TL;DR callout** — background color `red_background`, icon emoji relevant to the incident. One or two sentences: what happened, how long, highest impact.

2. **Table of Contents** — `table_of_contents` block.

3. **Summary** — `heading_2` + paragraph. Narrative of the incident: timeline in prose, how it was detected, how it was resolved.

4. **Tracking links** — `heading_2` + bulleted list of GitHub issue URLs created in Phase 4 (update this section after Phase 4 if needed).

5. **Impact** — `heading_2` + `callout` block with yellow background. List: affected services, error rates, latency degradation, customer-facing duration, severity (P0/P1/P2).

6. **Root Causes** — `heading_2`. For each root cause:
   - `heading_3` with color matching severity: `red` for primary/critical, `orange` for contributing, `yellow` for minor
   - Explanatory paragraph
   - `code` block with the relevant SQL, config, or code excerpt

7. **Investigated and Ruled Out** — `heading_2` + `callout` block with green background. Bulleted list, each item in strikethrough, with one sentence of evidence explaining why it was ruled out.

8. **Remediation** — `heading_2`. Three subsections:
   - `heading_3` "P0 — Immediate (done during incident)" with `to_do` blocks (checked)
   - `heading_3` "P1 — Short-term (this sprint)" with `to_do` blocks (unchecked)
   - `heading_3` "P2 — Long-term (backlog)" with `to_do` blocks (unchecked)

9. **Timeline** — `heading_2`. One `callout` block per event, background color `gray_background`. Format each callout title as `HH:MM UTC — <event>` with a brief description inside the callout body.

10. **Detection Improvements** — `heading_2` + `callout` block with blue background. Bulleted list of monitoring gaps this incident revealed and what alerting/tooling should be added.

---

## Phase 4: Create GitHub Issues

Use `gh` CLI. All issues go to `langwatch/langwatch` unless the fix is infra-only (use the infra repo).

### 4a. Parent tracking issue

```bash
gh issue create \
  --repo langwatch/langwatch \
  --title "incident: <Incident Title>" \
  --body "$(cat <<'EOF'
## Incident: <title>

Post-mortem: <Notion page URL>

## Sub-issues

<!-- filled in below -->
EOF
)"
```

Label with `incident` if the label exists. Record the issue number as `$PARENT_ISSUE`.

### 4b. Fix issues (one per repo with changes needed)

For each repository that needs code changes:

```bash
gh issue create \
  --repo langwatch/<repo> \
  --title "fix: <specific fix description>" \
  --body "Part of incident tracking: langwatch/langwatch#$PARENT_ISSUE

## What to fix
<description from root cause analysis>

## Acceptance criteria
- [ ] <criterion 1>
- [ ] <criterion 2>
"
```

### 4c. Proposal issues (for architectural decisions)

When a root cause reveals a design tradeoff that requires team input, create a proposal issue:

```bash
gh issue create \
  --repo langwatch/langwatch \
  --title "proposal: <architectural question>" \
  --body "Surfaced during incident: langwatch/langwatch#$PARENT_ISSUE

## Context
<why this decision matters>

## Options
### Option A: <name>
<tradeoffs>

### Option B: <name>
<tradeoffs>

## Recommendation
<your recommendation based on investigation findings>
"
```

Label with `proposal` if the label exists.

### 4d. Update parent issue

Edit the parent issue body to include all sub-issue links:

```bash
gh api repos/langwatch/langwatch/issues/$PARENT_ISSUE -X PATCH \
  -f body="$(cat <<'EOF'
## Incident: <title>

Post-mortem: <Notion page URL>

## Sub-issues

- langwatch/langwatch#<fix-issue>
- langwatch/langwatch#<proposal-issue>
EOF
)"
```

### 4e. Update Notion tracking links section

Update the Tracking Links section in the Notion page (created in Phase 3) with the GitHub issue URLs from this phase.

---

## Phase 5: Verify and Report

Run a final check before reporting done:

- [ ] Notion page is live and accessible (test the URL)
- [ ] All GitHub issues are created and linked to the parent
- [ ] Parent issue links back to the Notion page
- [ ] No PII or secrets appear in any created content (re-scan if unsure)
- [ ] Remediation P0 items reflect what was actually done during the incident

Report to the user:

```
Post-mortem complete.

Notion: <page URL>
Parent issue: langwatch/langwatch#<N>
Fix issues: <list>
Proposal issues: <list>
```
