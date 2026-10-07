---
name: ownership
description: "Where a change belongs in LangWatch: find the owning module of a subject, table or route from the generated READMEs (modules/README.md and each module page), refuse an edit that reaches into another module, and name the *Api operation to call or the new operation to ask for. Use before any edit that touches two modules, and when someone says 'whose is this', 'who owns this table', 'which module owns', 'where does this change belong', 'can I edit this from here', 'call another module', 'reach into', 'cross-module', 'which Api do I call', or 'accessed not claimed'."
user-invocable: true
---

# Ownership: whose is this?

Every subject has one owning module (`dev/docs/ARCHITECTURE.md` §3; the map is
`modules/catalogue.json`). The generated READMEs put the answer on one page, next to the code
(plan: `dev/docs/plans/module-readmes-2026-10-06.md`). Read them before the code.

## Find the owner

| You hold                          | Read                                                                                        |
| --------------------------------- | ------------------------------------------------------------------------------------------- |
| A subject or feature name         | `modules/README.md` (Subjects column); Enterprise ones in `enterprise/modules/README.md`    |
| A Postgres or ClickHouse table    | the "Owns tables" column of the same index, then the module page's "What <id> owns" table   |
| A route, tRPC procedure or worker | the owner's `process/README.md`: REST transport, tRPC transport, Sockets, Workers           |
| An operation another module calls | the owner's `process/README.md`, "Module API": every operation, its signature and the token |
| Who calls a module                | the module page's "Who depends on <id>" line                                                |

A table listed as "Postgres, accessed not claimed" has no owner yet. Do not claim it in passing:
the claim is its own change, and the pages show the gap so it gets one.

## Decide

1. **The thing is owned by the module you are in.** Edit it there.
2. **It is owned by another module.** Do not edit that module's tables, repositories or files from
   here. Call its `*Api` token: add the peer to `static dependencies` and call the operation listed
   under "Module API". Load `module-dependencies` for how a peer is declared.
3. **The owner has no operation that does it.** Name the operation you need (its name, input and
   result) and stop: a new `*Api` operation needs a ruling (`architecture-review`, check A). Do
   not widen another module's contract inside a feature change.
4. **The change needs a new peer edge.** Read your page's "Peers" table and the target's "Who
   depends on" line first. If the target already depends on you, the edge closes a cycle; load
   `module-dependencies` (peer cycles, §5).

## Worked example: an automation posts to Slack

The automation needs a bot token. `modules/README.md` maps the `slack` subject to
`modules/slack`. Its page owns `SlackIntegration` and lists `automation` under "Who depends on
slack". Its `process/README.md` lists `getUsableSlackConnection` under "Module API
(`SlackApi`)". So the automation calls `SlackApi.getUsableSlackConnection`; it never reads
`SlackIntegration` or decrypts the token itself.

## Traps

| Trap                                                      | Do instead                                                              |
| --------------------------------------------------------- | ----------------------------------------------------------------------- |
| Guessing the owner from imports or folder names           | read the index; `modules/catalogue.json` is the source the pages print  |
| Editing the generated block to fix a wrong owner          | fix the code or the catalogue, then run `pnpm generate:readmes`         |
| Reading a peer's Prisma model because it is in the schema | a table another module owns is reached through that module's `*Api`     |
| Trusting a `≈` value on a page                            | `≈` marks a value the generator could not read; check the code it cites |

## Links

- `readmes` skill: maintaining the generator and the pages.
- `module-dependencies` skill: peers, static dependencies and cycles.
- `repo-tree` skill: where a new thing goes when no module owns it yet.
