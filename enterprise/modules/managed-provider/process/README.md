# @langwatch/enterprise-managed-provider-process

The server half of [managed-provider](../README.md). Enterprise managed model providers: the policy for providers a deployment configures centrally, resolving which projects they serve, and AWS role chaining for them.

<!-- readme:generated:start (tools/readmegen; edit the code, then `pnpm generate:readmes`) -->

## Installation

`defineProcessModule("managed-provider").withApi(ManagedProviderModule).build()`, `src/managed-provider.module.ts:11`.

Installed by api, worker, tasks, from each app's generated module list (`pnpm generate:modules`).

## Module API (`ManagedProviderApi`)

Peers call these through the token, declared at `../contract/src/managed-provider.api.ts:32`; nothing else in this package is public.

#### `isManagedProvider`

```typescript
isManagedProvider(input: { organizationId: string; provider: string }): boolean;
```

#### `buildLitellmParameters`

```typescript
buildLitellmParameters(input: BuildManagedProviderParametersInput): Promise<Record<string, string>>;
```

## REST transport

None: this module declares no REST family.

## tRPC transport

None: this module declares no tRPC router.

## Sockets

None: this module declares no websocket, rawsocket or rawhttp door.

## Workers

None: managed-provider declares no pipeline, process manager, subscriber or task.

## Configuration

| Kind   | Leaf | Environment variable      | Declared at                          |
| ------ | ---- | ------------------------- | ------------------------------------ |
| secret | `–`  | `MANAGED_BEDROCK_CONFIGS` | `src/app/managed-provider.app.ts:19` |

<!-- readme:generated:end -->
