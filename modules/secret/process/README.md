# @langwatch/secret-process

The server half of [secret](../README.md). Project secrets: storing, listing, updating and reading their values by id or name.

<!-- readme:generated:start (tools/readmegen; edit the code, then `pnpm generate:readmes`) -->

## Installation

`defineProcessModule("secret").withRepositories(secretRepositories).withApi(SecretModule).withTransports(secretRest, secretTrpcTransport)`, `src/secret.module.ts:8`.

Installed by api, worker, tasks, from each app's generated module list (`pnpm generate:modules`).

## Module API (`SecretApi`)

Peers call these through the token, declared at `../contract/src/secret.api.ts:23`; nothing else in this package is public.

#### `list`

```typescript
list(input: ListSecretsInput): Promise<Secret[]>;
```

#### `get`

```typescript
get(input: GetSecretInput): Promise<Secret>;
```

#### `getValues`

```typescript
getValues(input: ListSecretsInput): Promise<Record<string, string>>;
```

#### `getValuesByName`

Decrypts only the named secrets; an unknown or reserved name is left out of the answer.

```typescript
getValuesByName(input: GetSecretValuesByNameInput): Promise<Record<string, string>>;
```

#### `delete`

```typescript
delete(input: DeleteSecretInput): Promise<void>;
```

#### `create`

With no caller, the write is attributed to the first member of the project's team.

```typescript
create(input: Omit<CreateSecretInput, "actorId">, by?: SecretCaller): Promise<Secret>;
```

#### `update`

With no caller, the write is attributed to the first member of the project's team.

```typescript
update(input: Omit<UpdateSecretInput, "actorId">, by?: SecretCaller): Promise<Secret>;
```

#### `createReserved`

Stores a reserved-name secret. When another writer stored it first, answers that value.

```typescript
createReserved(input: CreateReservedSecretInput): Promise<{ value: string }>;
```

#### `stashReveal`

Parks a secret for a single later read, and answers the id that reads it.

```typescript
stashReveal(input: StashRevealInput): Promise<StashedReveal>;
```

#### `revealOnce`

Serves a stashed secret and forgets it. Every later read is refused.

```typescript
revealOnce(input: RevealOnceInput): Promise<RevealedSecret>;
```

## REST transport

### `secretRest`

|             |                                        |
| ----------- | -------------------------------------- |
| Declared at | `src/transport/secret.rest.ts:64`      |
| Base URL    | `/api/secrets`, twin `/api/v1/secrets` |
| Addressing  | dated                                  |
| Credential  | project                                |
| Versions    | `2026-08-24`                           |

#### `GET /` · `getApiSecrets`

List project secrets

Permission `secrets:view`. Declared at `src/transport/secret.rest.ts:68`.

Answers at `/api/secrets`, `/api/v1/secrets`; also, undocumented, `/api/secrets/2026-08-24`, `/api/v1/secrets/2026-08-24`, `/api/secrets/latest`, `/api/v1/secrets/latest`.

```typescript
type Query = z.infer<typeof secretPublicListInputSchema>; // ../contract/src/secret-rest.schemas.ts:29
// Response: secretPublicSchema.array() (inline, src/transport/secret.rest.ts:71)
```

#### `GET /:id` · `getApiSecretsById`

Get project-secret metadata

Permission `secrets:view`. Declared at `src/transport/secret.rest.ts:75`.

Answers at `/api/secrets/:id`, `/api/v1/secrets/:id`; also, undocumented, `/api/secrets/2026-08-24/:id`, `/api/v1/secrets/2026-08-24/:id`, `/api/secrets/latest/:id`, `/api/v1/secrets/latest/:id`.

```typescript
type Params = z.infer<typeof secretPublicAliasParamsSchema>; // ../contract/src/secret-rest.schemas.ts:35
type Query = z.infer<typeof secretPublicListInputSchema>; // ../contract/src/secret-rest.schemas.ts:29
type Response = z.infer<typeof secretPublicSchema>; // ../contract/src/secret-rest.schemas.ts:17
```

#### `POST /` · `postApiSecrets`

Create a project secret

Permission `secrets:manage`. Declared at `src/transport/secret.rest.ts:85`.

Answers at `/api/secrets`, `/api/v1/secrets`; also, undocumented, `/api/secrets/2026-08-24`, `/api/v1/secrets/2026-08-24`, `/api/secrets/latest`, `/api/v1/secrets/latest`.

```typescript
type Body = z.infer<typeof secretPublicCreateInputSchema>; // ../contract/src/secret-rest.schemas.ts:44
type Response = z.infer<typeof secretPublicSchema>; // ../contract/src/secret-rest.schemas.ts:17
```

#### `PUT /:id` · `putApiSecretsById`

Replace a project secret value

Permission `secrets:manage`. Declared at `src/transport/secret.rest.ts:101`.

Answers at `/api/secrets/:id`, `/api/v1/secrets/:id`; also, undocumented, `/api/secrets/2026-08-24/:id`, `/api/v1/secrets/2026-08-24/:id`, `/api/secrets/latest/:id`, `/api/v1/secrets/latest/:id`.

```typescript
type Params = z.infer<typeof secretPublicAliasParamsSchema>; // ../contract/src/secret-rest.schemas.ts:35
type Body = z.infer<typeof secretPublicUpdateInputSchema>; // ../contract/src/secret-rest.schemas.ts:53
type Response = z.infer<typeof secretPublicSchema>; // ../contract/src/secret-rest.schemas.ts:17
```

#### `DELETE /:id` · `deleteApiSecretsById`

Delete a project secret

Permission `secrets:manage`. Declared at `src/transport/secret.rest.ts:117`.

Answers at `/api/secrets/:id`, `/api/v1/secrets/:id`; also, undocumented, `/api/secrets/2026-08-24/:id`, `/api/v1/secrets/2026-08-24/:id`, `/api/secrets/latest/:id`, `/api/v1/secrets/latest/:id`.

```typescript
type Params = z.infer<typeof secretPublicAliasParamsSchema>; // ../contract/src/secret-rest.schemas.ts:35
type Body = z.infer<typeof secretPublicDeleteInputSchema>; // ../contract/src/secret-rest.schemas.ts:41
type Response = z.infer<typeof secretPublicDeleteOutputSchema>; // ../contract/src/secret-rest.schemas.ts:58
```

## tRPC transport

### `secrets`

Contract `../contract/src/secret.trpc.ts:41`, router `src/transport/secret.trpc.ts:11`.

| Procedure            | Kind     | Gate                        | Input                         | Output                          |
| -------------------- | -------- | --------------------------- | ----------------------------- | ------------------------------- |
| `secrets.list`       | query    | Permission `secrets:view`   | `listSecretsInputSchema`      | inline                          |
| `secrets.create`     | mutation | Permission `secrets:manage` | `secretTrpcCreateInputSchema` | `secretSchema`                  |
| `secrets.update`     | mutation | Permission `secrets:manage` | `secretTrpcUpdateInputSchema` | `secretWriteAcknowledgedSchema` |
| `secrets.delete`     | mutation | Permission `secrets:manage` | `secretTrpcDeleteInputSchema` | `secretWriteAcknowledgedSchema` |
| `secrets.revealOnce` | mutation | Permission `secrets:view`   | `revealOnceInputSchema`       | `revealedSecretSchema`          |

## Sockets

None: this module declares no websocket, rawsocket or rawhttp door.

## Workers

None: secret declares no pipeline, process manager, subscriber or task.

## Configuration

None: no `static secrets` or `static config` leaf.

<!-- readme:generated:end -->
