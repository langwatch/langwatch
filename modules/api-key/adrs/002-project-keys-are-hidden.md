# ADR-002: Project keys are hidden, not retired

**Status:** Accepted (Alex, 2026-09-30)

**Builds on:** [ADR-001](./001-api-key-service.md). **Waits on:**
[ADR-166](../../../dev/docs/adr/166-grant-scoped-data-access.md) for the internal callers.

**Behavioural contract:** [API keys v2](../../../specs/api-keys/api-keys-v2.feature)

## Context

The legacy project key (`sk-lw-` and 48 characters, no lookup id) is stored in plaintext on
`Project.apiKey` and was revealed, rotated and handed out: the project settings page, onboarding, the
prompt, workflow and traces setup screens, the CLI device flow, hosted MCP and the governance CLI. It
grants full access to one project, cannot be attributed to a person, and outlives membership. Current
API keys already carry a lookup id and a peppered hash, are shown once at mint, and are revoked by row.

## Decision

1. A legacy project key keeps authenticating wherever it did. Nobody can find it any more: no tRPC or REST
   read, no rotation, no handout, and no project read carries it.
2. Each legacy key migrates to an `ApiKey` row: a hash of the token, a masked hint, created and last-used
   times. The row is revoke-only; revoking it refuses the key at every door within the cache bound.
3. Every screen that showed the key offers "Create a key" instead, through the api-key drawer opened by
   name. The CLI project login, the CLI personal project, the governance CLI and hosted MCP mint a fresh
   key; a CLI login revokes the previous key of the same device and project (cause `rotation`).
4. A new project gets no customer-facing project key.
5. Internal callers (the scenario child, workflows and nlpgo code blocks, the gateway's trace export, the
   health probe, ops checkup) keep reading `Project.apiKey` until ADR-166's system `Authorization`
   exists. Only then is the plaintext column emptied and dropped.
6. The settings list shows a banner urging replacement by a deadline. The deadline is advisory: a legacy
   key stays valid until revoked, and anything stronger needs a new ruling.
7. The API-key row menu holds Revoke only. A new key expires in 90 days by default; "never" is allowed.

## Rulings (Alex, 2026-09-30)

- "the key must still work for people, but it just can't be found anymore, and isn't given out, etc. but
  people must be ABLE to revoke it one last time still" (decisions 1 to 4).
- Legacy keys: "Migrate; banner + deadline" (decisions 2 and 6).
- Internal consumers: "Wait for Authorization (ADR-166)" (decision 5).
- CLI login: mint per login and replace this device's old key (decision 3).
- Row menu: "Revoke only" (decision 7).
- Expiry: 90 days by default, with "never" allowed (decision 7).
- The branch leak that gave every organization member each project's key is fixed on this branch only,
  "Fix on this branch only".

## Open question (AK0, pending Alex)

Decisions 2, 4 and 5 meet at one point: revoking a legacy key, or creating a project, must not leave the
internal callers without a credential before ADR-166. Proposed: a revoke also replaces `Project.apiKey`
with a fresh internal-only value, and a new project gets one. That value has no row, is never listed,
returned or displayed, and dies with the column.

## Consequences

- Until ADR-166 the plaintext column still exists for internal reads, so "hashed at rest" holds for
  customer keys only after the column is dropped.
- Main's tRPC `project.getProjectAPIKey` and `project.regenerateApiKey` are removed (parity break, ruled).
  The REST base-key routes keep main's 403.
- Published CLIs keep working: the `api_key` field is unchanged, and only its value is now a minted key.
