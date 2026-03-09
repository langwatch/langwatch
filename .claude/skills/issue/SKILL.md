---
name: issue
description: "Create a well-structured GitHub issue with templates, labels, project fields, and epic linking."
user-invocable: true
allowed-tools: Bash(gh:*)
argument-hint: "[description of the issue]"
---

# Create GitHub Issue

Create a standardized GitHub issue for: $ARGUMENTS

## Step 0: Validate Arguments

If `$ARGUMENTS` is empty or missing, show usage instructions and stop:

```
Usage: /issue <description of the issue>

Examples:
  /issue Login page throws 500 error when clicking submit
  /issue Add CSV export for evaluation results
  /issue Upgrade Prisma to v6
  /issue Fix trace filtering (parent epic: #500, priority: P1, size: M)

You can include optional metadata in parentheses:
  - parent epic: #NNN    — links as sub-issue
  - priority: P0-P2      — sets project Priority field
  - size: XS/S/M/L/XL    — sets project Size field
  - epic: "Name"         — sets project Epic field
```

## Step 1: Pre-flight Checks

Run these checks before proceeding. If either fails, show the error and stop.

### 1a. Authentication

Run `gh auth status`. If it fails or indicates not logged in, tell the user to run `gh auth login` and **stop**.

### 1b. Project Access

Run `gh project view 5 --owner langwatch`. If it fails, tell the user about the access error and suggest `gh auth refresh -s project` if it's a scope issue. **Stop**.

## Step 2: Detect Issue Type

Analyze `$ARGUMENTS` to determine the issue type. Use these heuristics:

| Type | Signals |
|------|---------|
| **BUG** | Words like "bug", "error", "crash", "broken", "fix", "fails", "500", "404", "throws", "exception", "regression" |
| **FEAT** | Words like "add", "new", "support", "implement", "enable", "introduce", "feature" |
| **PROPOSAL** | Words like "proposal", "RFC", "suggest", "consider", "evaluate", "explore", "investigate" |
| **EPIC** | Words like "epic", "initiative", "overhaul", "redesign", "migration" (large multi-issue efforts) |
| **CHORE** | Words like "upgrade", "refactor", "cleanup", "migrate", "update dependency", "maintenance", "chore", "rename" |

If ambiguous, default to **FEAT**.

**IMPORTANT: Ask the user to confirm or change the detected type before proceeding.**

Display something like:
```
Detected type: FEAT
  Template: ✨ Feature Request
  Label: feature

Is this correct? (yes / change to BUG|FEAT|PROPOSAL|EPIC|CHORE)
```

Wait for user confirmation. Do not proceed until confirmed.

## Step 3: Parse Optional Metadata

Extract from `$ARGUMENTS` any optional metadata the user may have included:

- **Parent epic**: a `#NNN` number referenced as parent/epic (e.g., "parent epic: #500")
- **Priority**: P0, P1, or P2
- **Size**: XS, S, M, L, or XL
- **Epic field**: a quoted epic name (e.g., epic: "Traces UI/UX Extreme Makeover")

These are all optional. If not specified, skip them in later steps.

## Step 4: Resolve Current User

Run `gh api user --jq .login` to get the current GitHub username.

Store the login for the `--assignee` flag. If this fails, skip assignment rather than aborting.

## Step 5: Create the Issue

Use the type-to-template and type-to-label mappings:

| Type | Template Name | Label |
|------|---------------|-------|
| BUG | 🐛 Bug Report | bug |
| FEAT | ✨ Feature Request | feature |
| PROPOSAL | ✨ Feature Request | proposal |
| EPIC | ✨ Feature Request | epic |
| CHORE | 🔧 Chore | chore |

For PROPOSAL type, prefix the title with "PROPOSAL: ".

Construct the issue body by filling in the template sections with information from the user's description. Place the user's description in the main section and leave other template sections as defaults if not enough info is provided.

Template sections for reference:
- **Bug Report**: Describe the bug, To reproduce, Expected behavior, Environment, Additional context
- **Feature Request**: Problem, Proposed solution, Alternatives considered, Additional context
- **Chore**: Description, Context, Scope, Additional context

Run the `gh issue create` command:

```bash
gh issue create \
  --title "<issue title derived from $ARGUMENTS>" \
  --body "<filled template body>" \
  --label "<label>" \
  --assignee "<login from step 4>"
```

Capture the new issue URL from the output. Extract the issue number from it.

## Step 6: Set Project Fields

After creating the issue, set project fields using the GitHub CLI.

### 6a. Add to project and get the item ID

```bash
gh project item-add 5 --owner langwatch --url <ISSUE_URL>
```

This returns the item ID. Store it.

### 6b. Get project ID and field IDs

Get the project's global node ID:

```bash
gh project view 5 --owner langwatch --format json --jq .id
```

Get all field definitions:

```bash
gh project field-list 5 --owner langwatch --format json
```

From the JSON output, find field IDs by matching the `name` property for: Status, Priority, Size, Epic.

For single-select fields, also find the option ID that matches the desired value (e.g., "Backlog" for Status).

### 6c. Set field values

Always set **Status** to "Backlog":

```bash
gh project item-edit --project-id <PROJECT_ID> --id <ITEM_ID> --field-id <STATUS_FIELD_ID> --single-select-option-id <BACKLOG_OPTION_ID>
```

If the user specified **Priority**, **Size**, or **Epic**, set those fields too using the same `gh project item-edit` pattern, matching the option ID for each value.

## Step 7: Link as Sub-issue (if parent epic specified)

If the user specified a parent epic number, link the new issue as a sub-issue:

```bash
# Get the new issue's node ID
gh api repos/langwatch/langwatch/issues/<NEW_NUMBER> --jq .node_id

# Link as sub-issue using the REST API
gh api repos/langwatch/langwatch/issues/<PARENT_NUMBER>/sub_issues \
  --method POST \
  -f sub_issue_id=<NEW_ISSUE_NODE_ID>
```

If no parent epic was specified, skip this step entirely.

## Step 8: Summary and Handoff

Display a summary of what was created:

```
Issue created: #<NUMBER> — <TITLE>
  URL: <URL>
  Type: <TYPE>
  Label: <LABEL>
  Assignee: <LOGIN>
  Project: LangWatch Kanban (Status: Backlog)
  Priority: <if set>
  Size: <if set>
  Epic: <if set>
  Parent: #<PARENT> (sub-issue linked) <if set>
```

Then ask the user:

**Would you like to start implementing this issue? I can run `/implement #<NUMBER>` to begin.**

If the user says yes, tell them to run `/implement #<NUMBER>`.
