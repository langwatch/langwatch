# The 23 docs modify/delete pages: settled, with three worth a later read

Main moved every one of these pages. Eleven have a direct replacement; the other
twelve are covered by redirects already present in `docs/docs.json`:

```
/ai-gateway/cli/*                       -> /coding-agents/overview
/optimization-studio/*                  -> /workflows/building-a-workflow
/better-agents/overview                 -> /skills/directory
/evaluations/online-evaluation/by-thread-> /evaluations/online-evaluation/setup-monitors
```

All four destinations exist on `origin/main`. So all 23 are deleted, and main's
page or redirect is what a reader reaches.

## How this was got wrong twice

First instruction: "main's deletion wins by default" - right answer, stated
without the evidence, so it could not be checked.

Then I reversed it on a line count taken from raw diffs: 3 to 62 added lines per
page looked like 400 lines of this branch's documentation. Ignoring whitespace it
is **2 to 25 lines per page, about 230 in total** - most of the apparent change
was reformatting.

Then I told the lane twelve pages had "no replacement on main", having grepped
`origin/main` for `optimization-studio` and `better-agents` and found nothing.
Main had **renamed** the areas to `workflows/` and `skills/`. That is the false
stale from a filename grep - the same trap this merge's own notes warn about, two
hours after writing the warning.

The lane held its ground with evidence rather than flipping a third time, which
is the reason this is right now.

## Three pages whose residual is worth reading before the merge lands

Small, but the largest of the 23 and the only ones where a real paragraph may be
going:

| Page | Real added lines | Main's page |
| --- | --- | --- |
| `ai-governance/data-privacy.mdx` | 25 | `docs/platform/data-privacy.mdx` |
| `ai-gateway/cookbooks/production-runbook.mdx` | 20 | `cookbooks/prometheus-alerts.mdx` + `grafana-dashboard.mdx` |
| `ai-governance/audit-log.mdx` | 19 | `docs/platform/audit-log.mdx` |

Recover any of them with `git show <pre-merge-sha>:<path>`; the pre-merge tip is
tagged `pre-main-merge-2026-09-11`.

Not a merge blocker. A docs follow-up.
