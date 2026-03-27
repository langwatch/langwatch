---
name: langwatch-kanban
description: "Manage the LangWatch Kanban GitHub project board — sync statuses, view your board, find stale items, move issues, assign work."
user-invocable: true
allowed-tools: Bash(gh:*), Bash(python3:*)
argument-hint: "<sync|my-board|stale|move|assign> [args]"
---

# LangWatch Kanban

Manage the LangWatch Kanban GitHub project board (project #5, org: langwatch).

## Project Reference

Read the project board reference from memory before doing anything:
- File: `/Users/USER/.claude/projects/-Users-hope-workspace-langwatch-workspace-langwatch-saas-langwatch/memory/reference_gh-project.md`

This contains all project IDs, field IDs, status option IDs, and GraphQL patterns. **Use python3 for all JSON parsing** — issue titles with special characters break jq.

## Subcommands

Parse `$ARGUMENTS` to determine which subcommand to run:

### `sync`

Sync the project board so statuses match reality.

1. **Page through all project items** (100 per page, up to 8 pages) using the GraphQL `projectV2.items` query
2. Find items where:
   - Issue/PR state is `CLOSED` or `MERGED` **but** project status is NOT `Done` or `Released`
3. For each stale item, update the Status field to `Done` using the `updateProjectV2ItemFieldValue` mutation
4. Report what was changed:
   ```
   Synced N items to Done:
     #123 — Title here (was: In progress)
     #456 — Title here (was: Ready)
   ```
5. If nothing to sync, say "Board is in sync — no stale items found."

### `my-board`

Show the current user's assigned items grouped by status.

1. Get current user: `gh api user --jq .login`
2. Page through project items, collecting items where the current user is an assignee
3. Group by status and display:
   ```
   ## In progress (3)
   - #123 — Title here [bug]
   - #456 — Title here [feature, scenarios]

   ## Ready (2)
   - #789 — Title here [chore]

   ## Backlog (5)
   - #101 — Title here
   ...
   ```
4. Skip `Done` and `Released` items
5. Show a count summary at the end

### `stale`

Find items that may be stuck or forgotten.

1. Page through project items
2. Flag items that are:
   - **In progress** but the issue has had no updates in 14+ days
   - **In review** but the linked PR has no review activity in 7+ days
   - **Blocked** with no recent comments explaining why
3. For each flagged item, show:
   ```
   #123 — Title [In progress, last updated 21 days ago]
   #456 — Title [Blocked, no comments since 2026-03-01]
   ```
4. Suggest actions: "Move to Backlog?", "Close as stale?", "Needs attention?"

### `move <issue-number> <status>`

Move an issue to a new status on the board.

1. Parse the issue number and target status from arguments
2. Map status name (case-insensitive) to option ID:
   - `backlog` → `f75ad846`
   - `blocked` → `848ceeaf`
   - `ready` → `61e4505c`
   - `in-progress` / `progress` → `47fc9ee4`
   - `in-review` / `review` → `df73e18b`
   - `done` → `98236657`
   - `released` → `18f5115c`
3. Find the project item ID by paging through items and matching the issue number
4. Update the status field
5. Confirm: `Moved #123 to In progress`

### `assign <issue-number>`

Assign an issue to the current user and ensure it's on the board.

1. Get current user: `gh api user --jq .login`
2. Assign the issue: `gh issue edit <number> --repo langwatch/langwatch --add-assignee <login>`
3. Check if it's on the project board; if not, add it: `gh project item-add 5 --owner langwatch --url <issue-url>`
4. Confirm: `Assigned #123 to <login> and added to LangWatch Kanban`

## GraphQL Pagination Pattern

Use this python3 pattern for all paginated queries:

```python
import subprocess, json

cursor = None
results = []

for page in range(1, 9):
    after = f', after: "{cursor}"' if cursor else ''
    query = '''{
      organization(login: "langwatch") {
        projectV2(number: 5) {
          items(first: 100''' + after + ''') {
            nodes {
              id
              content {
                ... on Issue { number title state }
                ... on PullRequest { number title state merged }
              }
              fieldValueByName(name: "Status") {
                ... on ProjectV2ItemFieldSingleSelectValue { name }
              }
            }
            pageInfo { hasNextPage endCursor }
          }
        }
      }
    }'''

    result = subprocess.run(
        ['gh', 'api', 'graphql', '-f', f'query={query}'],
        capture_output=True, text=True
    )
    data = json.loads(result.stdout)
    items = data['data']['organization']['projectV2']['items']

    for n in items['nodes']:
        content = n.get('content') or {}
        status = (n.get('fieldValueByName') or {}).get('name', '')
        # ... process each item ...
        results.append({...})

    if not items['pageInfo']['hasNextPage']:
        break
    cursor = items['pageInfo']['endCursor']
```

## Error Handling

- If `$ARGUMENTS` is empty or unrecognized, show usage:
  ```
  Usage: /langwatch-kanban <command> [args]

  Commands:
    sync                     Sync closed issues/PRs to Done status
    my-board                 Show your assigned items by status
    stale                    Find stuck or forgotten items
    move <#number> <status>  Move an issue to a new status
    assign <#number>         Assign issue to you and add to board

  Statuses: backlog, blocked, ready, in-progress, in-review, done, released
  ```
- If `gh auth status` fails, tell the user to run `gh auth login`
- If a project API call fails, show the error and suggest `gh auth refresh -s project`

## Constants

These are hardcoded from the LangWatch Kanban project:

```
PROJECT_NUMBER = 5
ORG = "langwatch"
REPO = "langwatch/langwatch"
PROJECT_ID = "PVT_kwDOCL9uOs4BH69J"
STATUS_FIELD_ID = "PVTSSF_lADOCL9uOs4BH69Jzg4iLlU"

STATUS_OPTIONS = {
    "Backlog": "f75ad846",
    "Blocked": "848ceeaf",
    "Ready": "61e4505c",
    "In progress": "47fc9ee4",
    "In review": "df73e18b",
    "Done": "98236657",
    "Released": "18f5115c",
}
```
