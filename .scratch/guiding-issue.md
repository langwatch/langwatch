## Why this issue exists

Langy can delete things. It must **confirm with the user before a delete goes through** — unless the resource has a **user-visible way to undo** the deletion themselves. This is the guiding issue for that work: it states the ruling, the scope, and the fix, and PR #7563 / issue #7562 are worked against it.

## The ruling (settled)

Confirm before delete **unless the user can restore it themselves.**

- "Recoverable in the database" does **not** count. Most Langy deletes are soft (`archivedAt`/a `deleted` flag), but the user can't see the archive and has no button to bring it back. From the user's seat it's gone — so it confirms.
- **User-visible restore** does count — a real, visible "see old versions / roll back" the user can operate.

## What that rule lands on, concretely

We enumerated every delete Langy can invoke (15 commands) and checked each for a user-visible restore path. **None of the 15 has one.** The only two resources in the product with real user-facing restore — prompts and experiments — have **no delete command at all**, so they never reach Langy's delete surface.

So the exemption is real as a principle but **empty in practice**: today, **all 15 delete commands confirm first.** The carve-out stays in the wording so that if a deletable resource ever gains real restore, it qualifies automatically — but no current behavior depends on it.

| # | Command | Resource | Confirm? |
|---|---|---|---|
| 1 | `evaluator delete` | Evaluator | yes |
| 2 | `workflow delete` | Workflow | yes |
| 3 | `agent delete` | Agent | yes |
| 4 | `dashboard delete` | Dashboard | yes — **⚠ hard-deletes and cascades to every graph inside it** |
| 5 | `scenario delete` | Scenario | yes |
| 6 | `suite delete` | Suite | yes |
| 7 | `graph delete` | Custom graph | yes |
| 8 | `chart delete` | Saved chart | yes |
| 9 | `trigger delete` | Trigger | yes |
| 10 | `secret delete` | Project secret | yes |
| 11 | `monitor delete` | Monitor | yes |
| 12 | `dataset delete` | Dataset | yes |
| 13 | `dataset records delete` | Dataset records | yes |
| 14 | `annotation delete` | Annotation | yes |
| 15 | `tag delete` | Prompt tag | yes (already has its own type-to-confirm) |

Not reachable for confirm-then-delete: members, roles, role-bindings, groups, teams, invites, scim-tokens, api-keys, virtual-keys, organizations — Langy declines these outright regardless of confirmation (`AGENTS.md`).

## The two failure modes to fix (tracked in #7562)

1. **Ordering** — Langy deletes in the same turn, *then* "confirms" an already-done delete. Observed 4 of 5 runs. The live prompt rule told it to confirm; it ignored the rule.
2. **Self-authored bypass** — Langy invented its own confirmation passphrase, told it to the user in advance, then executed the delete when an attacker (claiming CTO authority) replayed that passphrase. It reasoned *around* the written rule.

Failure mode 2 is why prompt wording alone is not the fix. A rule Langy can talk itself around is not a gate.

## The fix

**A structural gate, not a stronger sentence.** The delete action must be *unavailable* unless the immediately-preceding conversation state is: Langy asked for confirmation of *this specific delete*, and the user answered yes in their own turn. Langy cannot author, disclose, or accept its own passphrase; approval only comes from a genuine user turn. Dashboard's cascade should be named explicitly in the confirmation prompt so "delete this dashboard" doesn't silently take the graphs.

## Scope of the work against this issue

- **Build:** the structural confirm gate (in `services/langyagent`), plus the test/rubric changes that grade "confirm first, on every delete, no self-authored bypass."
- **Hand off:** anything requiring platform-side change (e.g. surfacing a real undo, or the dashboard-cascade warning at the API) is written up for the team rather than built here.
- PR #7563 carries the prompt/test/skill changes; its "every delete" framing is updated to "confirm unless user-restorable (today: all of them)."

Refs #7504, #7562. PR #7563.
