# @langwatch/github-process

The server half of [github](../README.md). The GitHub integration: app installations, their webhooks, and the pull requests other modules link to.

<!-- readme:generated:start (tools/readmegen; edit the code, then `pnpm generate:readmes`) -->

## Installation

`defineProcessModule("github").withRepositories(githubRepositories).withApi(GithubModule).withTransports(githubInstallRest, githubTrpcTransport).withEventing(githubMaintenanceEventing)`, `src/github.module.ts:33`.

Installed by api, worker, tasks, from each app's generated module list (`pnpm generate:modules`).

## Module API (`GithubApi`)

Callable GitHub installation, webhook and pull-request capabilities.

Peers call these through the token, declared at `../contract/src/github.api.ts:27`; nothing else in this package is public.

#### `getAppConfig`

```typescript
getAppConfig(): GithubAppConfig;
```

#### `getWebBase`

```typescript
getWebBase(): string;
```

#### `normalizeRepositoryHost`

```typescript
normalizeRepositoryHost(repositoryHost: string): string;
```

#### `canMapRepositoryHost`

```typescript
canMapRepositoryHost(repositoryHost: string): boolean;
```

#### `getAppInstallUrl`

```typescript
getAppInstallUrl(): string;
```

#### `getInstallStateTtlMs`

```typescript
getInstallStateTtlMs(): number;
```

#### `registerInstallNonce`

```typescript
registerInstallNonce(input: { nonce: string; ttlSec: number }): Promise<boolean>;
```

#### `consumeInstallNonce`

```typescript
consumeInstallNonce(nonce: string): Promise<"consumed" | "spent" | "unavailable">;
```

#### `signInstallState`

```typescript
signInstallState(payload: GithubInstallStatePayload): string;
```

#### `parseInstallState`

```typescript
parseInstallState(token: string | null | undefined): GithubInstallStatePayload | null;
```

#### `popupResponseHtml`

```typescript
popupResponseHtml(login: string): string;
```

#### `popupErrorHtml`

```typescript
popupErrorHtml(message: string): string;
```

#### `parsePullRequestEvent`

```typescript
parsePullRequestEvent(payload: unknown): GithubPullRequestEvent | null;
```

#### `applyWebhookPayload`

```typescript
applyWebhookPayload(input: { payload: GithubWebhookEnvelope; eventType: string | undefined; deliveryId: string | undefined; }): Promise<void>;
```

#### `getAllForOrganization`

```typescript
getAllForOrganization(organizationId: string): Promise<readonly GithubInstallation[]>;
```

#### `findByInstallationId`

```typescript
findByInstallationId(installationId: string): Promise<GithubInstallation | null>;
```

#### `isOrganizationMember`

```typescript
isOrganizationMember(input: { userId: string; organizationId: string }): Promise<boolean>;
```

#### `getConnectionStatus`

```typescript
getConnectionStatus(input: { organizationId: string }): Promise<GithubConnectionStatus>;
```

#### `disconnect`

```typescript
disconnect(input: { organizationId: string; installationId: string; }): Promise<GithubDisconnectResult>;
```

#### `recordInstallation`

```typescript
recordInstallation(input: { installationId: string; organizationId: string; flowStartedAt: number; expectedAccountLogin?: string | undefined; expectedInstallationId?: string | undefined; }): Promise<{ accountLogin: string }>;
```

#### `handleWebhookEvent`

```typescript
handleWebhookEvent(input: { action: "created" | "deleted" | "suspend" | "unsuspend" | "added" | "removed"; installationId: string; repositorySelection?: string; repositories?: GithubRepositoryRef[] | null; }): Promise<void>;
```

#### `listRepositoriesForOrganization`

```typescript
listRepositoriesForOrganization(organizationId: string): Promise<readonly GithubRepositoryRef[]>;
```

#### `findTurnTokens`

A token for one turn, scoped to the repository when named: empty when the App is not configured, no installation is usable, or none covers the repository (main's null).

```typescript
findTurnTokens(input: { organizationId: string; repositoryFullName?: string; }): Promise<GithubTurnToken[]>;
```

#### `coversRepository`

```typescript
coversRepository(input: { organizationId: string; repositoryFullName: string }): Promise<boolean>;
```

#### `requestBranchMapping`

```typescript
requestBranchMapping(input: { tenantId: string; repositoryHost: string; repositoryOwner: string; repositoryName: string; headBranch: string; }): Promise<void>;
```

#### `getLivePullRequestStatuses`

```typescript
getLivePullRequestStatuses(input: { organizationId: string; refs: readonly GithubPullRequestRef[]; }): Promise<readonly GithubPullRequestLiveStatus[]>;
```

#### `applyPullRequestEvent`

```typescript
applyPullRequestEvent(event: GithubPullRequestEvent): Promise<boolean>;
```

#### `findForBranches`

```typescript
findForBranches(input: { organizationId: string; keys: readonly { repositoryHost: string; repositoryFullName: string; headBranch: string }[]; }): Promise<readonly GithubPullRequest[]>;
```

#### `findAllByBranches`

```typescript
findAllByBranches(input: { organizationId: string; repositoryHost: string; repositoryFullName: string; headBranches: readonly string[]; }): Promise<readonly GithubPullRequest[]>;
```

#### `findByNumber`

```typescript
findByNumber(input: { organizationId: string; repositoryHost: string; repositoryFullName: string; prNumber: number; }): Promise<GithubPullRequest | null>;
```

#### `recheckDueBranches`

```typescript
recheckDueBranches(): Promise<number>;
```

#### `pruneStaleBranchLinkage`

```typescript
pruneStaleBranchLinkage(): Promise<{ branchChecks: number }>;
```

#### `countUsage`

The usage report's figures (ADR-156, section 10).

```typescript
countUsage(input: { organizationIds: readonly string[]; since?: number; }): Promise<GithubUsageCount>;
```

## REST transport

### `githubInstallRest`

|             |                                            |
| ----------- | ------------------------------------------ |
| Declared at | `src/transport/github-install.rest.ts:100` |
| Base URL    | none: each route's path is its address     |
| Addressing  | literal                                    |
| Credential  | browser                                    |

#### `GET /api/github/install` · `startGithubInstallation`

Permission `organization:manage`. Declared at `src/transport/github-install.rest.ts:108`.

Answers at `/api/github/install`, `/api/v1/github/install`.

```typescript
type Query = z.infer<typeof githubInstallStartQuerySchema>; // ../contract/src/github.ts:8
// Response: "protocol" (inline, src/transport/github-install.rest.ts:111)
```

#### `GET /api/github/setup` · `completeGithubInstallation`

Public: GitHub App Setup URL — protocol-mandated public endpoint; all sensitive state is HMAC-signed and bound to the session that started the flow. Declared at `src/transport/github-install.rest.ts:116`.

Answers at `/api/github/setup`, `/api/v1/github/setup`.

```typescript
// Response: "protocol" (inline, src/transport/github-install.rest.ts:118)
```

#### `POST /api/github/webhook` · `receiveGithubWebhook`

Public: GitHub App webhook delivery URL — protocol-mandated public endpoint; every payload is verified in-handler by its X-Hub-Signature-256 HMAC. Declared at `src/transport/github-install.rest.ts:126`.

Answers at `/api/github/webhook`, `/api/v1/github/webhook`.

```typescript
// Rawbody: "text" (inline, src/transport/github-install.rest.ts:129)
// Response: "protocol" (inline, src/transport/github-install.rest.ts:132)
```

#### `GET /api/github-langy/setup` · `completeGithubInstallationOnLegacyPath`

Public: GitHub App Setup URL — protocol-mandated public endpoint; all sensitive state is HMAC-signed and bound to the session that started the flow. Declared at `src/transport/github-install.rest.ts:142`.

Answers at `/api/github-langy/setup`, `/api/v1/github-langy/setup`.

```typescript
// Response: "protocol" (inline, src/transport/github-install.rest.ts:144)
```

#### `POST /api/github-langy/webhook` · `receiveGithubWebhookOnLegacyPath`

Public: GitHub App webhook delivery URL — protocol-mandated public endpoint; every payload is verified in-handler by its X-Hub-Signature-256 HMAC. Declared at `src/transport/github-install.rest.ts:152`.

Answers at `/api/github-langy/webhook`, `/api/v1/github-langy/webhook`.

```typescript
// Rawbody: "text" (inline, src/transport/github-install.rest.ts:153)
// Response: "protocol" (inline, src/transport/github-install.rest.ts:156)
```

## tRPC transport

### `github`

Contract `../contract/src/github.trpc.ts:34`, router `src/transport/github.trpc.ts:56`.

| Procedure                      | Kind     | Gate                             | Input                              | Output                                |
| ------------------------------ | -------- | -------------------------------- | ---------------------------------- | ------------------------------------- |
| `github.getConnectionStatus`   | query    | Permission `organization:view`   | `organizationScopeSchema`          | `githubConnectionStatusSchema`        |
| `github.listRepos`             | query    | Permission `organization:manage` | `organizationScopeSchema`          | inline                                |
| `github.pullRequestLiveStatus` | query    | Permission `traces:view`         | `pullRequestLiveStatusInputSchema` | `githubPullRequestLiveStatusesSchema` |
| `github.disconnect`            | mutation | Permission `organization:manage` | `disconnectInputSchema`            | `githubDisconnectResultSchema`        |

## Sockets

None: this module declares no websocket, rawsocket or rawhttp door.

## Workers

### Pipeline `github_maintenance` (aggregate `global`)

Declared at `src/eventing/github-maintenance.pipeline.ts:42`.

| Kind            | Name                  | Handles                                                                                                  | Declared at                                      |
| --------------- | --------------------- | -------------------------------------------------------------------------------------------------------- | ------------------------------------------------ |
| process manager | `githubBranchRecheck` | every 10 min (`GITHUB_BRANCH_RECHECK_INTERVAL_MS = 10 * 60 * 1000`); intents `prune`, `recheck` (outbox) | `src/eventing/github-maintenance.pipeline.ts:51` |

## Configuration

| Kind   | Leaf      | Environment variable       | Declared at                           |
| ------ | --------- | -------------------------- | ------------------------------------- |
| secret | `–`       | `GITHUB_LANGY_PRIVATE_KEY` | `src/app/github.app.ts:217`           |
| config | `appId`   | `GITHUB_LANGY_APP_ID`      | `../contract/src/github.config.ts:11` |
| config | `host`    | `GITHUB_LANGY_HOST`        | `../contract/src/github.config.ts:12` |
| config | `appSlug` | `GITHUB_LANGY_APP_SLUG`    | `../contract/src/github.config.ts:13` |

<!-- readme:generated:end -->
