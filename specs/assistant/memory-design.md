# Langy memory — technical design, safety, and GDPR

> Companion doc to `specs/assistant/PRD.md`. The PRD says *what* memory does
> and which tiers ship. This doc says *how* it is built, *where* the data
> lives, *who* can see it, and *how* we satisfy GDPR and similar regimes.
>
> Status: **Draft for review.** No code written yet.
> Owner: aryan@langwatch.ai
> Last updated: 2026-05-06

## 1. Why this doc exists

Memory is the most privacy-sensitive thing Langy does. Conversations may
contain PII (customer names, email addresses, internal data). Project memory
records the user's stated goals and pain points. Both are durable and both
will eventually be subject to subject-access requests, deletion requests, and
audits. Getting the data model and the controls right *before* writing code
is cheaper than retrofitting them later.

This doc is the source of truth for: schema, data flow, multitenancy
enforcement, deletion semantics, retention, GDPR rights, and threat model.

## 2. Scope

In scope:
- L3 (cross-session conversation history)
- L4 (project memory file)
- L6 (lazy semantic retrieval — tool-only, no persistence beyond what already exists)

Not in scope here (covered in PRD §6):
- L1, L2 (in-turn / in-conversation, ephemeral, no special storage)
- L5 (episodic auto-extracted facts) — deferred
- L7 (per-project vector embeddings) — deferred; see future-design section §11

---

## 3. Data model (Prisma)

```prisma
// One row per Langy conversation.
model LangyConversation {
  id              String    @id @default(cuid())
  projectId       String                              // multitenancy guard
  userId          String                              // owner of this conversation
  title           String?                             // auto-generated from first user message
  isShared        Boolean   @default(false)           // opt-in team-share toggle
  sharedAt        DateTime?                           // null when unshared
  sharedById      String?                             // userId who shared (audit)
  createdAt       DateTime  @default(now())
  updatedAt       DateTime  @updatedAt
  deletedAt       DateTime?                           // soft delete; cron hard-deletes after 90d

  messages        LangyMessage[]

  @@index([projectId, userId, updatedAt])
  @@index([projectId, isShared, updatedAt])           // for "shared with me" queries
  @@index([deletedAt])                                // for retention cron
}

// One row per message in a conversation.
model LangyMessage {
  id              String    @id @default(cuid())
  conversationId  String
  projectId       String                              // denormalized for fast multitenancy filtering
  role            String                              // "user" | "assistant" | "tool"
  parts           Json                                // Vercel AI SDK message parts
  tokenCount      Int?                                // for budget enforcement
  createdAt       DateTime  @default(now())

  conversation    LangyConversation @relation(fields: [conversationId], references: [id], onDelete: Cascade)

  @@index([conversationId, createdAt])
  @@index([projectId])
}

// One row per project.
model LangyProjectMemory {
  id              String    @id @default(cuid())
  projectId       String    @unique
  content         String    @db.Text                  // markdown, full version
  contentSummary  String?   @db.Text                  // summarized for injection if content > 2k tokens
  contentVersion  Int       @default(1)
  generatedAt     DateTime  @default(now())
  refreshedAt     DateTime  @default(now())           // last regenerate or edit
  lastEditorId    String?                             // null if auto-generated, else userId

  history         LangyProjectMemoryHistory[]

  @@index([projectId])
}

// Append-only history for project memory edits — supports diff view + audit + rollback.
model LangyProjectMemoryHistory {
  id              String    @id @default(cuid())
  projectMemoryId String
  contentVersion  Int
  content         String    @db.Text
  changedById     String?                             // null if system-generated
  changeReason    String?                             // "auto_bootstrap" | "auto_refresh" | "user_edit"
  changedAt       DateTime  @default(now())

  projectMemory   LangyProjectMemory @relation(fields: [projectMemoryId], references: [id], onDelete: Cascade)

  @@index([projectMemoryId, changedAt])
}

// Per-user-per-project preferences.
model LangyUserPreferences {
  id              String    @id @default(cuid())
  userId          String
  projectId       String
  mode            String    @default("non_expert")    // "non_expert" | "expert"
  dismissedSuggestionKinds String[]                   // for proactive suggestions
  createdAt       DateTime  @default(now())
  updatedAt       DateTime  @updatedAt

  @@unique([userId, projectId])
}
```

### Choices and why

| Choice | Reason |
|---|---|
| Postgres, not Redis or vector store | Memory is small, structured, durable, queryable. Postgres matches the rest of LangWatch. |
| `projectId` denormalized on `LangyMessage` | Saves a join on every multitenancy check. Matches existing LangWatch convention. |
| Soft delete with 90-day hard delete | Supports "Undo delete", aligns with retention policy. |
| `LangyProjectMemoryHistory` separate table | Audit trail + rollback support without bloating the main row. |
| No memory opt-out flag | We do not offer a "use Langy without memory" mode. Right-to-object (Art 21) is satisfied by deletion + the right to stop using Langy. Memory is core to the product. |

---

## 4. Data flow

### 4.1 Write path — sending a message

```
Browser (LangySidebar)
   │
   │ POST /api/langy/chat  { messages, projectId, conversationId? }
   ▼
Hono route /api/langy/chat
   │
   ├─► Auth: requireSession()
   ├─► Permission: hasProjectPermission(userId, projectId, "evaluations:view")
   ├─► Rate limit: per (userId, projectId), N msgs/min
   │
   ├─► If conversationId is null: create LangyConversation (projectId, userId)
   │
   ├─► Persist user message → LangyMessage (role=user)
   │
   ├─► Build prompt:
   │       1. system prompt (hardcoded identity + rules)
   │       2. inject LangyProjectMemory.contentSummary (or content if ≤2k)
   │       3. inject LangyUserPreferences (mode, etc.)
   │       4. recent N messages from this conversation
   │       5. (lazy retrieval results come in later, via tool calls)
   │
   ├─► streamText() via Vercel AI SDK
   │       - tool calls happen here
   │       - tool results stream back; never persisted to memory
   │
   ├─► On stream end: persist assistant message + tool messages → LangyMessage[]
   │
   ▼
Browser receives SSE stream, renders tokens + tool calls + proposals
```

### 4.2 Read path — opening a conversation

```
Browser opens conversation X
   │
   │ GET /api/langy/conversations/{id}
   ▼
Hono route
   │
   ├─► Auth + projectId + permission check
   │
   ├─► Authorization check (this is the per-user privacy guard):
   │       conversation.userId == session.userId
   │       OR (conversation.isShared AND conversation.projectId == session.projectId)
   │   → if neither: 403
   │
   ├─► Load conversation + messages
   │
   ▼
Browser renders conversation
```

**Critical:** the authorization check at read time is what prevents user-to-user
leakage within a project. A bug here is a P0 incident. It must be tested in
`langy-memory.feature` *and* in a unit test on the route handler.

### 4.3 Project memory — bootstrap

```
Project created (existing project lifecycle hook)
   │
   ▼
Enqueue background job: bootstrapLangyProjectMemory(projectId)
   │
   ▼
Worker
   │
   ├─► Load project state: list_evaluators, list_prompts, sample 50 recent traces
   │
   ├─► Render bootstrap prompt → LLM (gpt-5-mini, cheap)
   │
   ├─► LLM returns markdown summary
   │
   ├─► Truncate or summarize if > 2k tokens
   │
   ├─► INSERT LangyProjectMemory (changeReason="auto_bootstrap")
   │
   ▼
Done. User opens Langy later → memory is already there.
```

### 4.4 Project memory — refresh (user-initiated)

```
User clicks "Refresh project memory" in settings
   │
   │ POST /api/langy/project-memory/refresh
   ▼
Hono route
   │
   ├─► Auth + projectId + permission check ("project:admin" required)
   │
   ├─► Stream the LLM regeneration directly to the browser (SSE)
   │       - user watches tokens compose the new doc
   │
   ├─► On stream end: append to LangyProjectMemoryHistory, update LangyProjectMemory
   │
   ▼
Browser shows new doc + diff vs prior version
```

### 4.5 Project memory — refresh (auto-stale, non-blocking)

```
Banner appears: "Project memory is 30+ days old. Refresh?"
   │
   │ User clicks Refresh → same flow as 4.4
   │
   │ User dismisses → banner stays dismissed for 7 days, then re-appears
```

### 4.6 Lazy retrieval (L6) — no persistence

```
LLM decides to call search_traces({query: "..."}) tool
   │
   ▼
Tool handler: ClickHouse / Postgres filtered query
   │
   ├─► Multitenancy: TenantId = projectId enforced in query
   │
   ▼
Returns rows → injected as tool result message → discarded after this turn
```

---

## 5. Multitenancy enforcement

Three layers, all required:

1. **Permission middleware (route entry).** Every Langy route runs through
   `hasProjectPermission(userId, projectId, capability)` before any handler
   logic. Without this, the route returns 403.
2. **Service layer.** All Prisma queries that touch `LangyConversation`,
   `LangyMessage`, `LangyProjectMemory` MUST include `projectId` in the WHERE
   clause. The CLAUDE.md project rule is enforced by middleware that rejects
   queries on project-level models without `projectId`.
3. **Authorization at read.** For per-user data (conversations), the query
   must additionally check `userId == session.userId OR (isShared AND
   sharedWithSameProject)`.

Anti-patterns to reject in code review:
- `prisma.langyConversation.findUnique({ where: { id } })` ❌ — missing projectId + userId
- `prisma.langyMessage.findMany({ where: { conversationId } })` ❌ — missing projectId
- Any service method that takes `conversationId` without also taking `projectId` from session ❌

---

## 6. Deletion semantics

| Action | What happens immediately | What happens later |
|---|---|---|
| User deletes a single conversation | `deletedAt` set; conversation hidden from UI | Cron hard-deletes after 90 days |
| User clicks "Clear all my Langy memory in this project" | All their conversations soft-deleted; their `LangyUserPreferences` reset | Hard-delete after 90 days; project memory unaffected (it's shared) |
| User account deleted (org-level action) | All `LangyConversation` and `LangyUserPreferences` for that userId soft-deleted across all projects | Hard-delete cron sweep within 30 days (faster timeline for account deletion) |
| Project deleted | Cascade-delete all Langy data for that projectId | Within 30 days for full hard-delete |
| Organization deleted (full erasure request) | All Langy data across all org projects soft-deleted, then hard-deleted within 30 days | Backups purged on next backup cycle (≤30 days, see §8) |
| GDPR Art 17 erasure request from end-user | Same as "user account deleted" but with formal logging | Confirmation email; backup purge tracked |

Soft delete is internal only — to the user, "delete" means gone. Soft delete
exists so that *we* can recover from accidental bulk deletes and to give a
short undo window. It is never exposed as a "trash" UI.

---

## 7. Retention

| Data | Hot retention | Cold / hard-delete |
|---|---|---|
| `LangyMessage` (active) | While conversation exists | n/a |
| `LangyConversation` (soft-deleted) | 90 days from `deletedAt` | Hard-deleted by cron |
| `LangyProjectMemory` | While project exists | Cascade-deleted with project |
| `LangyProjectMemoryHistory` | 1 year (rolling) | Older versions pruned monthly |
| `LangyUserPreferences` | While user × project relationship exists | Hard-deleted on user removal from project |
| Backups (Postgres) | 30 days | Backup rotation purges deleted data within 30 days |

Retention timers run as a daily cron job. The job logs counts of records
deleted per category for ops visibility.

---

## 8. GDPR + similar regimes

LangWatch processes data on behalf of customers (controller). Customers' end
users are data subjects. Langy specifically holds:

- Conversations (potentially PII-bearing free text)
- Project memory (operator-stated goals, project shape)
- User preferences (mode, opt-out flag)

### 8.1 Lawful basis

Most likely **legitimate interest** (Art 6(1)(f)) — Langy is a product feature
that helps the user operate LangWatch. Documented in privacy notice. User has
right to object (§8.4).

If a customer's contract requires it, basis can be **contract performance**
(Art 6(1)(b)) — Langy is part of the service the customer purchased.

### 8.2 Data subject rights

| Right | Article | How Langy supports it |
|---|---|---|
| Access | Art 15 | Settings page exposes all stored data; "Export my Langy data" produces JSON archive |
| Rectification | Art 16 | Project memory is editable. Conversations are not editable but can be deleted. |
| Erasure | Art 17 | One-click "Clear all my Langy memory in this project"; full erasure on account deletion |
| Restriction of processing | Art 18 | Satisfied via deletion (user can clear memory at any time) |
| Data portability | Art 20 | "Export my Langy data" produces JSON archive |
| Object | Art 21 | Satisfied via deletion + the user's right to stop using Langy. We do not offer a "use Langy without memory" mode — memory is core to the product. |
| Automated decision-making | Art 22 | Langy never makes automated decisions with legal/significant effect; propose-apply pattern keeps the human in the loop |

### 8.3 Subprocessors

Conversations and project memory are processed by the LLM provider configured
for the project (default: OpenAI). This must be:
- Declared in the LangWatch DPA / subprocessors list
- Covered by SCCs (Standard Contractual Clauses) if data leaves EU
- Subject to an Art 28 processor agreement

**Special note:** OpenAI's ZDR (Zero Data Retention) terms or equivalent
should be enabled for Langy traffic if the customer is EU-regulated. This is
operationally enforceable — we add a `langwatch-feature: langy` header to
outbound LLM calls and the provider routes accordingly.

### 8.4 Data minimization

- We do NOT store tool call results (lazy retrieval) — they're transient.
- We do NOT store the user's IP, device fingerprint, or location alongside conversations.
- We do NOT auto-extract PII from conversations into structured fields (would create new processing surface; defer L5).
- Conversation `title` is auto-generated from the first message — if the first
  message contains PII, the title will too. This is an acceptable trade for
  usability; user can edit/delete the title.

### 8.5 Storage limitation

- 90-day hard delete on soft-deleted conversations
- 30-day backup retention
- 1-year rolling retention for memory edit history

### 8.6 Cross-border transfer

LangWatch does not restrict the LLM provider list based on the customer's
data residency. The customer chooses any model their project is configured
with — including non-EU providers, even on EU deployments. This is a
deliberate product decision: forcing a provider list undermines the
"any model" flexibility that LangWatch sells.

Compliance is handled at the **contract layer** (DPA, SCCs with each
subprocessor) rather than the **product layer** (forced restriction).
Customers who require EU-only processing must contractually pick EU-region
providers themselves; we surface that information but do not enforce it.

### 8.7 Audit logging

We log **mutations and access events**, not reads. Reads are too noisy and
expensive to log at row level; mutations + sensitive access events are
sufficient for incident response.

Logged events:
- Conversation create / delete / share / unshare
- Project memory bootstrap / refresh / edit / rollback
- User preferences changes (mode toggle, etc.)
- Memory exports (Art 15)
- Erasure events (Art 17)
- Settings page access (sensitive — user is viewing what's stored)

Logs go to the existing LangWatch audit log infrastructure
(`specs/audit-log/`), retained per existing policy.

### 8.8 Data location

Langy memory lives in the same Postgres instance as the rest of the project's
data. If the customer is on an EU-only deployment, Langy data is EU-only too.
No separate datastore = no new transfer surface.

---

## 9. Threat model

| Threat | Mitigation |
|---|---|
| Bob in Project A reads Alice's conversations in Project A | Per-user authorization at read; tested in `langy-memory.feature` |
| User in Org A reads conversations from Org B | `projectId` filter + permission middleware (existing) |
| Deleted conversation resurfaces in LLM output via project memory | Project memory is regenerated only on user action; v2 has no auto-extraction |
| Backup contains deleted user's data forever | 30-day backup rotation, documented; tested in DR drill |
| Malicious user prompts Langy to leak another user's conversation | Conversations are not in the prompt context unless it's the current user's; LLM cannot retrieve them |
| Tool call result contains PII that gets stored as part of the assistant message | Persisted assistant message contains the LLM's *response*, which may reference tool data — same surface as today's chat. Acceptable; user can delete. |
| Project memory contains a hallucinated fact that misleads future conversations | (1) auto-bootstrap shows draft, (2) user edits anytime, (3) stale banner at 30 days, (4) edit history allows rollback |
| LLM provider is breached | Subprocessor breach notification clauses in DPA; we notify customers within 72h per Art 33 |
| Insider access to Postgres bypasses all controls | DB access logged; SOC2 control; row-level encryption is *not* in scope for v2 |

---

## 10. Operational considerations

- **Metrics.** Track per-project: conversation count, message count, project
  memory token size, refresh frequency, opt-out rate. Watch for outliers.
- **Cost ceiling.** Project memory injection costs tokens on every turn. Cap
  at 2k tokens; alert if any project's effective injected memory exceeds
  budget repeatedly.
- **Observability.** Every Langy LLM call is itself a LangWatch trace
  (dogfood). The trace includes which memory tiers were injected.
- **Backup & DR.** Memory is backed up alongside Postgres. RTO/RPO matches
  the rest of LangWatch.
- **Migration.** When we move agent execution to Mastra (PRD phase 4),
  memory storage stays in Postgres unchanged. Mastra reads/writes via the
  same service layer.

---

## 11. Future: per-project vector embeddings (L7)

This section captures the design *intent* so that v2 doesn't paint v3 into a
corner.

### Approach when we ship it

- **pgvector** (Postgres extension) is the most likely choice — keeps everything
  in one DB, no new infra, sufficient for our scale. Alternative: Qdrant if
  we outgrow pgvector.
- **One namespace per projectId.** Vectors never cross projects. Multitenancy
  enforced at query time.
- **Embeddings produced from:**
  - traces (selected fields, redacted)
  - prompts
  - conversations (with consent — opt-in per-user, Art 21 friendly)
  - project memory (always)
- **Embedding model** is a per-deployment config, defaulting to a small
  open-source model to avoid sending content to a paid provider just for
  embeddings.
- **Lifecycle:** when a record is deleted, its embedding is deleted in the
  same transaction.

### What this unlocks

- True semantic similarity search on traces ("find traces like this one")
- Episodic memory (L5) backed by retrieval over past conversations
- Cross-project recommendations (with explicit consent)

### Why NOT to ship in v2

- Quality bar is high (a wrong vector match is a confidence trap)
- Adds a new failure mode and infra concern
- Most v2 use cases are served by structured tools + a curated project memory
- Better to earn the right by getting v2 right first

---

## 12. Decision log

| Date | Decision | Rationale |
|---|---|---|
| 2026-05-06 | Per-user L3 scoping in v2; no team-shared default | User explicitly chose to keep simple now, expand later |
| 2026-05-06 | Opt-in "share this conversation with team" toggle | Best of both worlds — privacy default, sharing on demand |
| 2026-05-06 | Auto-bootstrap project memory at project creation, silently | "Magic of being prepared" beats "let me learn" UI |
| 2026-05-06 | User-initiated refresh streams; auto-bootstrap is silent | Streaming when user asks, silent when system acts |
| 2026-05-06 | No vector store in v2; keep L7 design captured | Earn the right; revisit when conditions justify |
| 2026-05-06 | Postgres only, no Redis or vector DB | Keep infra surface small |
| 2026-05-06 | 90-day hard delete; 30-day backup retention | Industry-standard for SaaS; aligns with GDPR storage limitation |
| 2026-05-06 | No LLM-provider restriction by data residency | Compliance handled at contract layer (DPA/SCC), not product layer; preserves "any model" flexibility |
| 2026-05-06 | No memory opt-out flag | Memory is core to the product; Art 21 satisfied via deletion + right to stop using Langy |
| 2026-05-06 | Audit log mutations + access events, not reads | Reads too noisy; mutations sufficient for incident response |

---

## 13. Open questions (deferred to implementation)

1. **Conversation export format** — JSON is the primary format. Human-readable HTML/PDF nice-to-have, defer.
2. **Sharing a conversation that contains another user's PII** — when Alice shares a conversation she had, and the conversation references Bob, do we redact Bob? Out of scope for v2 — share button has a "preview before sharing" step instead.
