# @langwatch/audit-log-process

The server half of [audit-log](../README.md). The audit log: every module records who did what through it, and an entity's history is read back from it.

<!-- readme:generated:start (tools/readmegen; edit the code, then `pnpm generate:readmes`) -->

## Installation

`defineProcessModule("audit-log").withRepositories(auditLogRepositories).withApi(AuditLogModule).withTransports(homeTrpcTransport).withTasks(…)`, `src/audit-log.module.ts:9`.

Installed by api, worker, tasks, from each app's generated module list (`pnpm generate:modules`).

## Module API (`AuditLogApi`)

Portable audit write capability.

Peers call these through the token, declared at `../contract/src/audit-log.ts:64`; nothing else in this package is public.

#### `record`

```typescript
record(command: RecordAuditLogCommand): Promise<RecordedAuditLogEntry>;
```

#### `listEntityHistory`

```typescript
listEntityHistory(input: ListAuditLogEntityHistoryInput): Promise<AuditLogHistoryEntry[]>;
```

#### `hasRecordedSince`

Whether this actor already recorded this action on this target since `sinceMs`.

```typescript
hasRecordedSince(input: RecordedSinceInput): Promise<boolean>;
```

## REST transport

None: this module declares no REST family.

## tRPC transport

### `home`

Contract `../contract/src/recent-items.ts:35`, router `src/transport/home.trpc.ts:17`.

| Procedure             | Kind  | Gate                      | Input                    | Output |
| --------------------- | ----- | ------------------------- | ------------------------ | ------ |
| `home.getRecentItems` | query | Permission `project:view` | `recentItemsInputSchema` | inline |

## Sockets

None: this module declares no websocket, rawsocket or rawhttp door.

## Workers

### Tasks

Run by the tasks process, before serve.

| Task                           | Class                  | Declared at                                |
| ------------------------------ | ---------------------- | ------------------------------------------ |
| `agent-audit-log-ids-backfill` | `AgentAuditLogIdsTask` | `src/tasks/agent-audit-log-ids.task.ts:16` |

## Configuration

None: no `static secrets` or `static config` leaf.

<!-- readme:generated:end -->
