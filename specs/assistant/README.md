# Langy — assistant specs

The full specification for **Langy**, LangWatch's in-product AI assistant.

> If you only have 5 minutes, read [`PRD.md`](./PRD.md) §1, §2, §2a, §4.

## Document map

| Doc | What it answers | Read when |
|---|---|---|
| [`PRD.md`](./PRD.md) | Why Langy exists, who it's for, what v2 ships, what we're explicitly NOT building, design principles | First. Always. |
| [`memory-design.md`](./memory-design.md) | How memory is built — schema, data flow, multitenancy, retention, GDPR, threat model | When working on memory or answering a privacy/security question |
| [`architecture.md`](./architecture.md) | How the pieces fit — sequence diagrams, API contracts, component boundaries, state | When designing or implementing a Langy change |
| [`implementation-plan.md`](./implementation-plan.md) | What we build, in what order, broken into PR-sized chunks | When picking up work for a Langy phase |
| [`langy-baseline.feature`](./langy-baseline.feature) | Behavior contract for the v1 already on this branch | Before any v2 work — we test what exists first |
| [`langy-memory.feature`](./langy-memory.feature) | Behavior contract for L3 + L4 + L6 memory | When implementing or testing memory |
| [`langy-proactive.feature`](./langy-proactive.feature) | Behavior contract for post-turn suggestions | When implementing or testing suggestions |

## How to use this doc set

1. **Read the PRD first.** Everything else assumes you've internalized the
   vision, principles, and non-goals.
2. **`.feature` files are the requirements.** Per LangWatch convention, tests
   bind to scenarios. Edit them carefully.
3. **The other markdown docs are reference**, not specifications. They explain
   *how* — implementation may diverge if a better design appears, but the
   `.feature` files and the PRD are the contract.
4. **Decisions go in PRD §13 (non-decisions captured) and the relevant doc's
   decision log** — not in chat or commit messages. If a decision isn't in the
   docs, it doesn't exist.
5. **Open questions live at the bottom of each doc.** Don't sprinkle "TBD" in
   the body — hoist it to the open-questions section so it's visible.

## Conventions

- Markdown for prose, tables, diagrams (mermaid)
- Gherkin for behavior contracts (`.feature` files)
- File names are kebab-case; section numbers stable once published
- Decision logs at the bottom of each doc, dated, with rationale
- Last-updated stamps at the top of every doc — keep them current

## Where the code lives

| Surface | Path |
|---|---|
| Chat UI | `langwatch/src/components/langy/` |
| Chat route | `langwatch/src/server/routes/langy.ts` |
| (Future) memory service | `langwatch/src/server/services/langy/` |
| Layout integration | `langwatch/src/components/DashboardLayout.tsx` |
| Tests | `langwatch/src/server/routes/__tests__/langy.*.test.ts` (and component tests under `langwatch/src/components/langy/__tests__/`) |

## Glossary

| Term | Meaning |
|---|---|
| **Langy** | The in-product AI assistant for LangWatch. (Was called "Sage" earlier on this branch.) |
| **Lens** | An ephemeral, agent-rendered view of LangWatch data inside the chat panel. v3 feature. |
| **Proposal** | A change Langy suggests (create/update/delete). User must click Apply for it to take effect. |
| **L1–L7** | The seven memory tiers, defined in `memory-design.md` §2 and PRD §6. |
| **Project memory (L4)** | The editable markdown doc that summarizes a project; always injected into the system prompt. |
| **Mode toggle** | Per-user preference between non-expert (default, plain language) and expert (terse, raw). |
| **Bootstrap** | The auto-generation of project memory when a project is created. Silent. |
| **Refresh** | User-initiated regeneration of project memory. Streamed visibly. |
| **Post-turn suggestion** | A "next step" chip Langy may emit at the end of any assistant response. |
