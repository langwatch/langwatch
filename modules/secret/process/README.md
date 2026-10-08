# @langwatch/secret-process

The server half of [secret](../README.md). Project secrets: storing, listing, updating and reading their values by id or name.

<!-- readme:generated:start (tools/readmegen; edit the code, then `pnpm generate:readmes`) -->

## Installation

`defineProcessModule("secret").withRepositories(secretRepositories).withApi(SecretModule).withTransports(secretRest, secretTrpcTransport)`, `src/secret.module.ts:9`.

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
// Query: secretPublicListInputSchema, ../contract/src/secret-rest.schemas.ts:29
interface Query {
  projectId?: string;
}
// Response: inline, src/transport/secret.rest.ts:71
type Response = {
  id: string;
  projectId: string;
  name: string;
  createdAt: string;
  updatedAt: string;
}[];
```

#### `GET /:id` · `getApiSecretsById`

Get project-secret metadata

Permission `secrets:view`. Declared at `src/transport/secret.rest.ts:75`.

Answers at `/api/secrets/:id`, `/api/v1/secrets/:id`; also, undocumented, `/api/secrets/2026-08-24/:id`, `/api/v1/secrets/2026-08-24/:id`, `/api/secrets/latest/:id`, `/api/v1/secrets/latest/:id`.

```typescript
// Params: secretPublicAliasParamsSchema, ../contract/src/secret-rest.schemas.ts:35
interface Params {
  id: string;
}
type Query = z.infer<typeof secretPublicListInputSchema>; // ../contract/src/secret-rest.schemas.ts:29
// Response: secretPublicSchema, ../contract/src/secret-rest.schemas.ts:17
interface Response {
  id: string;
  projectId: string;
  name: string;
  createdAt: string;
  updatedAt: string;
}
```

#### `POST /` · `postApiSecrets`

Create a project secret

Permission `secrets:manage`. Declared at `src/transport/secret.rest.ts:85`.

Answers at `/api/secrets`, `/api/v1/secrets`; also, undocumented, `/api/secrets/2026-08-24`, `/api/v1/secrets/2026-08-24`, `/api/secrets/latest`, `/api/v1/secrets/latest`.

```typescript
// Body: secretPublicCreateInputSchema, ../contract/src/secret-rest.schemas.ts:44
interface Body {
  projectId?: string;
  name: string;
  value: string;
}
type Response = z.infer<typeof secretPublicSchema>; // ../contract/src/secret-rest.schemas.ts:17
```

#### `PUT /:id` · `putApiSecretsById`

Replace a project secret value

Permission `secrets:manage`. Declared at `src/transport/secret.rest.ts:101`.

Answers at `/api/secrets/:id`, `/api/v1/secrets/:id`; also, undocumented, `/api/secrets/2026-08-24/:id`, `/api/v1/secrets/2026-08-24/:id`, `/api/secrets/latest/:id`, `/api/v1/secrets/latest/:id`.

```typescript
type Params = z.infer<typeof secretPublicAliasParamsSchema>; // ../contract/src/secret-rest.schemas.ts:35
// Body: secretPublicUpdateInputSchema, ../contract/src/secret-rest.schemas.ts:53
interface Body {
  projectId?: string;
  value: string;
}
type Response = z.infer<typeof secretPublicSchema>; // ../contract/src/secret-rest.schemas.ts:17
```

#### `DELETE /:id` · `deleteApiSecretsById`

Delete a project secret

Permission `secrets:manage`. Declared at `src/transport/secret.rest.ts:117`.

Answers at `/api/secrets/:id`, `/api/v1/secrets/:id`; also, undocumented, `/api/secrets/2026-08-24/:id`, `/api/v1/secrets/2026-08-24/:id`, `/api/secrets/latest/:id`, `/api/v1/secrets/latest/:id`.

```typescript
type Params = z.infer<typeof secretPublicAliasParamsSchema>; // ../contract/src/secret-rest.schemas.ts:35
// Body: secretPublicDeleteInputSchema, ../contract/src/secret-rest.schemas.ts:41
interface Body {
  projectId?: string;
}
// Response: secretPublicDeleteOutputSchema, ../contract/src/secret-rest.schemas.ts:58
interface Response {
  id: string;
  deleted: true;
}
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

```typescript
// secrets.list
// Input: listSecretsInputSchema, ../contract/src/secret.ts:56
interface Input {
  projectId: string;
}
// Output: secretSchema.array() (inline, ../contract/src/secret.trpc.ts:44)

// secrets.create
// Input: secretTrpcCreateInputSchema, ../contract/src/secret.trpc.ts:22
interface Input {
  projectId: string;
  name: string;
  value: string;
}
type Output = z.infer<typeof secretSchema>; // ../contract/src/secret.ts:43

// secrets.update
// Input: secretTrpcUpdateInputSchema, ../contract/src/secret.trpc.ts:27
interface Input {
  projectId: string;
  secretId: string;
  value: string;
}
// Output: secretWriteAcknowledgedSchema, ../contract/src/secret.ts:126
interface Output {
  success: boolean;
}

// secrets.delete
// Input: secretTrpcDeleteInputSchema, ../contract/src/secret.trpc.ts:36
interface Input {
  projectId: string;
  secretId: string;
}
type Output = z.infer<typeof secretWriteAcknowledgedSchema>; // ../contract/src/secret.ts:126

// secrets.revealOnce
// Input: revealOnceInputSchema, ../contract/src/one-time-reveal.ts:34
interface Input {
  organizationId: string;
  revealId: string;
}
// Output: revealedSecretSchema, ../contract/src/one-time-reveal.ts:42
interface Output {
  kind: "virtual_key";
  keyId: string;
  preview: string;
  secret: string;
}
```

## Sockets

None: this module declares no websocket, rawsocket or rawhttp door.

## Workers

None: secret declares no pipeline, process manager, subscriber or task.

## Configuration

None: no `static secrets` or `static config` leaf.

<!-- readme:generated:end -->
