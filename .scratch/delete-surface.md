# Langy delete surface — combined (surface + versioned researchers)

Rule: confirm before delete UNLESS the resource has USER-VISIBLE restore.
Finding: NO deletable resource has user-visible restore → all 15 confirm.
(Prompts + experiments are restorable but have NO delete command.)

| # | CLI command | Resource | Delete type | User-restorable? | Confirm? |
|---|---|---|---|---|---|
| 1 | evaluator delete <idOrSlug> | Evaluator | soft | no | YES |
| 2 | workflow delete <id> | Workflow | soft | no (editor versions ≠ undelete) | YES |
| 3 | agent delete <id> | Agent | soft | no | YES |
| 4 | dashboard delete <id> | Dashboard | HARD + cascades to graphs | no | YES ⚠ cascade |
| 5 | scenario delete <id> | Scenario | soft | no | YES |
| 6 | suite delete <id> | Suite | soft | no | YES |
| 7 | graph delete <id> | Custom graph | HARD | no | YES |
| 8 | chart delete <id> | Saved chart | HARD | no | YES |
| 9 | trigger delete <id> | Trigger | soft(flag) | no | YES |
| 10 | secret delete <id> | Project secret | HARD | no | YES |
| 11 | monitor delete <id> | Monitor | HARD | no | YES |
| 12 | dataset delete <slugOrId> | Dataset | soft | no | YES |
| 13 | dataset records delete <slug> <ids...> | Dataset records | HARD | no | YES |
| 14 | annotation delete <id> | Annotation | HARD | no | YES |
| 15 | tag delete <name> | Prompt tag | HARD | no | YES (already has own type-to-confirm) |

Sharpest edge: #4 dashboard delete silently destroys contained graphs.
Excluded (AGENTS.md:49 declines outright): members, roles, role-bindings, groups,
teams, invites, scim-tokens, api-keys, virtual-keys, organizations.

Two failure modes to fix (both #7562):
  A. deletes before asking (ordering)
  B. invents+discloses its own confirmation passphrase, honors under authority claim
     → needs STRUCTURAL gate (delete refuses unless prior turn was ask+user-yes),
       not prompt wording.
