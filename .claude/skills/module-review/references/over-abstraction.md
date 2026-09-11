# Over-abstraction: what the detectors cannot see

Owned by the `module-review` skill (`.claude/skills/module-review/SKILL.md`), which sets the order and routes here; this file carries section 7 of the audit.

## 7. Over-abstraction: what the detectors cannot see

Four questions, in this order, each needing a `path:line` answer. Read
`dev/docs/best_practices/overengineering.md` and
`dev/docs/best_practices/feature-cleanup-review.md` (rules R1-R8, the reference for what
"simple enough" looks like) before applying them.

- **Where does a database client stop?** (R1) A service takes a repository, never a
  `PrismaClient`, `Prisma.TransactionClient` or ClickHouse client. If a service opens a
  transaction or writes raw SQL, that belongs behind the repository, and a transactional
  callback receives a transactional _repository_, not a client.
- **Where does a conduit stop?** A service takes a channel interface in the module's own
  message types, never a bus, a Redis client, an HTTP client, a mail sender or a Slack
  client. If a service formats a payload for a vendor or names a topic, that belongs
  behind the channel.
- **What does the composition root actually pass?** (R5) See `parity.md` section 5; this is the
  same question, answered once per audit.
- **How many implementations does each port have?** (R4)
  `grep -rn "implements XPort\|extends XPort"`. Two or more, or one in a different
  package, and it stays. One, in the same package, and it is a seam to nowhere. Never
  propose collapsing a port with real polymorphism.
- **Do the errors carry their own status?** (R6) A `Record<string, {status}>` keyed on
  `error.name`, or an `instanceof` ladder in a router, means the errors are plain
  `Error`s and every transport re-derives the mapping. Check whether the class the
  transport tests is the class the runtime throws: where a contract and a server
  package both declare the name, `instanceof` is silently always false.

Do not invent work. A rule firing is a question, not a verdict: check each hit against
the source and drop the idioms (`(x) => x` as a no-op default, `.filter((x) => x)` as a
truthiness filter, a routed repository delegating by verb). List what stays and why in a
Keep list: a port with two or more implementations, an open set with one file per member
where a new member touches nothing else, `app/<f>.app.ts` (the one facade both transports
call, which the layout requires), a hot path already inside its quality ceiling where the
only complaint is method length, and anything the mechanical half already accepts
(`packages/architecture-lint/src/overengineering-policy.mjs`,
`packages/architecture-lint/src/oxlint-baseline.json`), and defer to their output rather than
re-litigating it.
