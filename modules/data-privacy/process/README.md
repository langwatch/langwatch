# @langwatch/data-privacy-process

The server half of [data-privacy](../README.md). Data privacy: per-scope rules and the PII redaction level a project runs at.

<!-- readme:generated:start (tools/readmegen; edit the code, then `pnpm generate:readmes`) -->

## Installation

`defineProcessModule("data-privacy").withRepositories(dataPrivacyRepositories).withChannels(dataPrivacyChannels).withApi(DataPrivacyModule).withTransports(dataPrivacyTrpcTransport)`, `src/data-privacy.module.ts:8`.

Installed by api, worker, tasks, from each app's generated module list (`pnpm generate:modules`).

## Module API (`DataPrivacyApi`)

Callable data-privacy operations shared by process peers after composition.

Peers call these through the token, declared at `../contract/src/data-privacy.api.ts:49`; nothing else in this package is public.

#### `getResolvedForProject`

```typescript
getResolvedForProject(input: { projectId: string }): Promise<ResolvedDataPrivacy>;
```

#### `intoGoogleApplicationCredentials`

Hands the deployment's Google service-account credential, which this module owns, to `build` — undefined where none is configured — and answers what `build` made of it: the value never leaves the closure.

```typescript
intoGoogleApplicationCredentials(build: (credential: string | undefined) => Out): Out;
```

#### `listOrganizationRules`

```typescript
listOrganizationRules(input: { organizationId: string }): Promise<DataPrivacyPolicy[]>;
```

#### `setForScope`

The system write, anchored to an organization the caller already resolved. The settings door does not use it: it goes through `setScopeRule`, which authorizes the target scope first.

```typescript
setForScope(input: { organizationId: string; scope: DataPrivacyScope; personalOnly: boolean; config: DataPrivacyConfig; }): Promise<DataPrivacyPolicy>;
```

#### `removeForScope`

```typescript
removeForScope(input: { organizationId: string; scope: DataPrivacyScope; personalOnly: boolean; }): Promise<void>;
```

#### `getPiiRedactionLevel`

The level this project's PII is redacted at; a custom entity list reads as STRICT.

```typescript
getPiiRedactionLevel(input: { projectId: string }): Promise<DataPrivacyPiiRedactionLevel>;
```

#### `setPiiRedactionLevel`

Writes the level into the project's own rule, keeping every other field it sets.

```typescript
setPiiRedactionLevel(input: { projectId: string; level: DataPrivacyPiiRedactionLevel; }): Promise<void>;
```

#### `getSnapshot`

The privacy settings surface. Each operation authorizes the caller against the scope it acts on after anchoring that scope to the acting project's organization, never against the project id the input also carries.

```typescript
getSnapshot(input: { projectId: string } & DataPrivacyCallerInput): Promise<DataPrivacySnapshot>;
```

#### `setScopeRule`

```typescript
setScopeRule(input: DataPrivacyScopeTarget & { config: DataPrivacyConfig } & DataPrivacyCallerInput): Promise<DataPrivacyPolicy>;
```

#### `removeScopeRule`

```typescript
removeScopeRule(input: DataPrivacyScopeTarget & DataPrivacyCallerInput): Promise<void>;
```

#### `dropsAnyContent`

True when this project's resolved policy drops any span content at all — the interlock the ingest edge checks before externalizing inline media, so bytes are never stored for content the policy will discard.

```typescript
dropsAnyContent(input: { projectId: string }): Promise<boolean>;
```

#### `redactLog`

```typescript
redactLog(input: DataPrivacyLogRecord, piiRedactionLevel: DataPrivacyPiiRedactionLevel, tenantId?: string): Promise<void>;
```

#### `redactMetricAttributes`

```typescript
redactMetricAttributes(input: DataPrivacyMetricAttributes, piiRedactionLevel: DataPrivacyPiiRedactionLevel, tenantId?: string): Promise<void>;
```

#### `redactSpan`

Redacts the span and its resource in place, at the level the ingest resolved.

```typescript
redactSpan(input: { span: OtlpSpan; resource: OtlpResource | null; piiRedactionLevel: DataPrivacyPiiRedactionLevel; tenantId: string; }): Promise<void>;
```

#### `dropSpanContent`

Strips the content the project's policy never stores; fail-open, never throws.

```typescript
dropSpanContent(input: { span: OtlpSpan; projectId: string }): Promise<SpanContentDropResult>;
```

## REST transport

None: this module declares no REST family.

## tRPC transport

### `dataPrivacy`

Contract `../contract/src/data-privacy.trpc.ts:32`, router `src/transport/data-privacy.trpc.ts:36`.

| Procedure                    | Kind     | Gate                                                                                                                                                                                                                                                          | Input                               | Output                      |
| ---------------------------- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------- | --------------------------- |
| `dataPrivacy.getSnapshot`    | query    | Permission `project:view`                                                                                                                                                                                                                                     | `dataPrivacyProjectScopeSchema`     | `dataPrivacySnapshotSchema` |
| `dataPrivacy.setForScope`    | mutation | Service-authorized: SCOPE_TARGETED_PERMISSIONS; The authorized target is the organization, department, team or project named by `scope`, which the app anchors to this project's organization first — the `projectId` this input also carries is not acted on | inline                              | `dataPrivacyPolicySchema`   |
| `dataPrivacy.removeForScope` | mutation | Service-authorized: SCOPE_TARGETED_PERMISSIONS; The authorized target is the organization, department, team or project named by `scope`, which the app anchors to this project's organization first — the `projectId` this input also carries is not acted on | `dataPrivacyScopeTargetInputSchema` | –                           |

```typescript
// dataPrivacy.getSnapshot
// Input: dataPrivacyProjectScopeSchema, ../contract/src/data-privacy.trpc.ts:18
interface Input {
  projectId: string;
}
type Output = z.infer<typeof dataPrivacySnapshotSchema>; // ../contract/src/data-privacy.snapshot.ts:57

// dataPrivacy.setForScope
// Input: z.object({ ...dataPrivacyScopeTargetInputSchema.shape, config: dataPrivacyConfigSchema }) (inline, ../contract/src/data-privacy.trpc.ts:49)
type Output = z.infer<typeof dataPrivacyPolicySchema>; // ../contract/src/data-privacy.ts:187

// dataPrivacy.removeForScope
// Input: dataPrivacyScopeTargetInputSchema, ../contract/src/data-privacy.trpc.ts:26
interface Input {
  projectId: string;
  scope: {
    scopeType: "ORGANIZATION" | "DEPARTMENT" | "TEAM" | "PROJECT";
    scopeId: string;
  };
  personalOnly: boolean;
}
```

## Sockets

None: this module declares no websocket, rawsocket or rawhttp door.

## Workers

None: data-privacy declares no pipeline, process manager, subscriber or task.

## Configuration

| Kind   | Leaf                           | Environment variable                 | Declared at                                 |
| ------ | ------------------------------ | ------------------------------------ | ------------------------------------------- |
| secret | `googleApplicationCredentials` | `GOOGLE_APPLICATION_CREDENTIALS`     | `src/app/data-privacy.app.ts:103`           |
| config | `googleDlpDisabled`            | `LANGWATCH_DISABLE_GOOGLE_DLP`       | `../contract/src/data-privacy.config.ts:11` |
| config | `enforcement`                  | `LANGWATCH_DATA_PRIVACY_ENFORCEMENT` | `../contract/src/data-privacy.config.ts:16` |
| config | `nodeEnvironment`              | `NODE_ENV`                           | `../contract/src/data-privacy.config.ts:18` |
| config | `langevalsEndpoint`            | `LANGEVALS_ENDPOINT`                 | `../contract/src/data-privacy.config.ts:20` |

<!-- readme:generated:end -->
