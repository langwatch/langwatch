# @langwatch/staff-access-process

The server half of [staff-access](../README.md). It enrols an operator's coding agent with a passkey, takes its access requests, verifies the passkey approval over a hash of what the approval page shows, redeems an approved request once into a one-hour key pinned to one address, and writes a trail row before every request that key makes. See [ADR-202](../../../dev/docs/adr/202-ops-agent-access.md).

<!-- readme:generated:start (tools/readmegen; edit the code, then `pnpm generate:readmes`) -->

## Installation

`defineProcessModule("staff-access").withRepositories(staffAccessRepositories).withApi(StaffAccessModule).withTransports(staffAccessRest, staffAccessTrpcTransport).provideMiddlewareBindings(…).withEventing(staffAccessExpiryEventing)`, `src/staff-access.module.ts:15`.

Installed by api, worker, tasks, from each app's generated module list (`pnpm generate:modules`).

## Module API (`StaffAccessApi`)

Peers call these through the token, declared at `../contract/src/staff-access.api.ts:59`; nothing else in this package is public.

#### `overview`

The signed-in operator's agents, whether they hold a passkey, and every recent session.

```typescript
overview(input: StaffAccessOperator): Promise<StaffAccessOverview>;
```

#### `enrolOptions`

Stores an enrolment challenge; refuses `passkey_required` without a passkey.

```typescript
enrolOptions(input: StaffAccessOperator): Promise<PasskeyAssertionOptions>;
```

#### `enrol`

Verifies the passkey over the stored challenge and mints a 90-day requester key, once.

```typescript
enrol(input: StaffAccessOperator & { name: string; assertion: PasskeyAssertionResponse }): Promise<StaffAccessEnrolled>;
```

#### `revokeRequester`

```typescript
revokeRequester(input: StaffAccessOperator & { requesterId: string }): Promise<{ ok: true }>;
```

#### `getApprovalRequest`

Only the requester's owner sees a request; anyone else gets `not_found`.

```typescript
getApprovalRequest(input: StaffAccessOperator & { requestId: string }): Promise<StaffAccessApprovalView>;
```

#### `approvalOptions`

The ceremony over the hash of exactly what the page shows and the operator chose.

```typescript
approvalOptions(input: StaffAccessOperator & StaffAccessApprovalChoice): Promise<PasskeyAssertionOptions>;
```

#### `approve`

```typescript
approve(input: StaffAccessOperator & StaffAccessApprovalChoice & { assertion: PasskeyAssertionResponse }): Promise<StaffAccessApprovalView>;
```

#### `deny`

```typescript
deny(input: StaffAccessOperator & { requestId: string }): Promise<StaffAccessApprovalView>;
```

#### `revokeSession`

```typescript
revokeSession(input: StaffAccessOperator & { requestId: string }): Promise<{ ok: true }>;
```

#### `revokeAll`

The kill switch: every live session, after the typed confirmation.

```typescript
revokeAll(input: StaffAccessOperator & { confirmation: string }): Promise<{ revoked: number }>;
```

#### `createRequest`

```typescript
createRequest(input: StaffAccessAgent & { body: StaffAccessRequestBody }): Promise<StaffAccessRequestCreated>;
```

#### `getRequestStatus`

```typescript
getRequestStatus(input: StaffAccessAgent & { requestId: string }): Promise<StaffAccessRequestStatusAnswer>;
```

#### `redeem`

```typescript
redeem(input: StaffAccessAgent & { requestId: string; codeVerifier: string }): Promise<StaffAccessRedeemed>;
```

#### `endSession`

```typescript
endSession(input: StaffAccessAgent & { requestId: string }): Promise<{ ended: true }>;
```

#### `listOrganizations`

```typescript
listOrganizations(input: StaffAccessAgent & { query?: string }): Promise<StaffAccessOrganizationList>;
```

#### `getOrganizationUsage`

```typescript
getOrganizationUsage(input: StaffAccessAgent & { organization: string }): Promise<StaffAccessUsage>;
```

#### `getQueueSummary`

```typescript
getQueueSummary(input: StaffAccessAgent): Promise<StaffAccessQueueSummary>;
```

#### `copyOrganization`

Copies the allowlisted setup of the source session's organization into the bearer session's organization (module ADR-002). Both approvals are checked and audited before anything runs.

```typescript
copyOrganization(input: StaffAccessAgent & { body: StaffAccessCopyBody }): Promise<StaffAccessCopyReport>;
```

#### `sweepExpiredSessions`

Audits every session whose hour passed with no revoke, once each.

```typescript
sweepExpiredSessions(input: { at: number }): Promise<{ audited: number }>;
```

## REST transport

### `staffAccessRest`

|             |                                         |
| ----------- | --------------------------------------- |
| Declared at | `src/transport/staff-access.rest.ts:34` |
| Base URL    | none: each route's path is its address  |
| Addressing  | literal                                 |
| Credential  | staff_access                            |

#### `POST /api/staff-access/requests` · `createStaffAccessRequest`

Authenticated: the bearer is an operator's enrolled agent or one approved session; each operation answers only that agent's own requests. Declared at `src/transport/staff-access.rest.ts:40`.

Answers at `/api/staff-access/requests`, `/api/v1/staff-access/requests`.

```typescript
// Body: staffAccessRequestBodySchema, ../contract/src/staff-access-rest.schemas.ts:91
interface Body {
  scopes: (
    "ops:read" | "copy:source" | "copy:target" | "org:metadata" | "org:content" | "org:support"
  )[];
  organization?: string;
  counterpartOrganization?: string;
  reason: string;
  codeChallenge: string;
  codeChallengeMethod: "S256";
  machine: string;
}
// Response: staffAccessRequestCreatedSchema, ../contract/src/staff-access-rest.schemas.ts:103
interface Response {
  requestId: string;
  approvalUrl: string;
  expiresAt: string;
}
```

#### `GET /api/staff-access/requests/:requestId` · `getStaffAccessRequest`

Authenticated: the bearer is an operator's enrolled agent or one approved session; each operation answers only that agent's own requests. Declared at `src/transport/staff-access.rest.ts:48`.

Answers at `/api/staff-access/requests/:requestId`, `/api/v1/staff-access/requests/:requestId`.

```typescript
// Params: staffAccessRequestParamsSchema, ../contract/src/staff-access-rest.schemas.ts:111
interface Params {
  requestId: string;
}
// Response: staffAccessRequestStatusAnswerSchema, ../contract/src/staff-access-rest.schemas.ts:123
interface Response {
  requestId: string;
  status: "pending" | "approved" | "denied" | "redeemed" | "expired" | "revoked";
  expiresAt: string;
  accessExpiresAt: string | null;
}
```

#### `POST /api/staff-access/requests/:requestId/redeem` · `redeemStaffAccessRequest`

Authenticated: the bearer is an operator's enrolled agent or one approved session; each operation answers only that agent's own requests. Declared at `src/transport/staff-access.rest.ts:56`.

Answers at `/api/staff-access/requests/:requestId/redeem`, `/api/v1/staff-access/requests/:requestId/redeem`.

```typescript
type Params = z.infer<typeof staffAccessRequestParamsSchema>; // ../contract/src/staff-access-rest.schemas.ts:111
// Body: staffAccessRedeemBodySchema, ../contract/src/staff-access-rest.schemas.ts:133
interface Body {
  codeVerifier: string;
}
type Response = z.infer<typeof staffAccessRedeemedSchema>; // ../contract/src/staff-access-rest.schemas.ts:155
```

#### `POST /api/staff-access/requests/:requestId/end` · `endStaffAccessSession`

Authenticated: the bearer is an operator's enrolled agent or one approved session; each operation answers only that agent's own requests. Declared at `src/transport/staff-access.rest.ts:67`.

Answers at `/api/staff-access/requests/:requestId/end`, `/api/v1/staff-access/requests/:requestId/end`.

```typescript
type Params = z.infer<typeof staffAccessRequestParamsSchema>; // ../contract/src/staff-access-rest.schemas.ts:111
// Body: staffAccessNoBodySchema, ../contract/src/staff-access-rest.schemas.ts:160
interface Body {}
// Response: staffAccessEndedSchema, ../contract/src/staff-access-rest.schemas.ts:163
interface Response {
  ended: true;
}
```

#### `GET /api/staff-access/ops/organizations` · `listStaffAccessOrganizations`

Platform permission `opsRead:view`. Declared at `src/transport/staff-access.rest.ts:76`.

Answers at `/api/staff-access/ops/organizations`, `/api/v1/staff-access/ops/organizations`.

```typescript
// Query: staffAccessOrganizationsQuerySchema, ../contract/src/staff-access-rest.schemas.ts:172
interface Query {
  query?: string;
}
// Response: staffAccessOrganizationListSchema, ../contract/src/staff-access-rest.schemas.ts:181
interface Response {
  organizations: {
    id: string;
    slug: string;
    name: string;
  }[];
}
```

#### `GET /api/staff-access/ops/organizations/:organization/usage` · `getStaffAccessOrganizationUsage`

Platform permission `opsRead:view`. Declared at `src/transport/staff-access.rest.ts:84`.

Answers at `/api/staff-access/ops/organizations/:organization/usage`, `/api/v1/staff-access/ops/organizations/:organization/usage`.

```typescript
// Params: staffAccessOrganizationParamsSchema, ../contract/src/staff-access-rest.schemas.ts:192
interface Params {
  organization: string;
}
type Response = z.infer<typeof staffAccessUsageSchema>; // ../contract/src/staff-access-rest.schemas.ts:213
```

#### `GET /api/staff-access/ops/queues` · `getStaffAccessQueueSummary`

Platform permission `opsRead:view`. Declared at `src/transport/staff-access.rest.ts:92`.

Answers at `/api/staff-access/ops/queues`, `/api/v1/staff-access/ops/queues`.

```typescript
// Response: staffAccessQueueSummarySchema, ../contract/src/staff-access-rest.schemas.ts:234
interface Response {
  queues: {
    name: string;
    displayName: string;
    pendingGroupCount: number;
    blockedGroupCount: number;
    activeGroupCount: number;
    parkedGroupCount: number;
    totalPendingJobs: number;
    dlqCount: number;
  }[];
}
```

#### `POST /api/staff-access/ops/copies` · `copyStaffAccessOrganization`

Platform permission `opsCopy:create`. Declared at `src/transport/staff-access.rest.ts:97`.

Answers at `/api/staff-access/ops/copies`, `/api/v1/staff-access/ops/copies`.

```typescript
// Body: staffAccessCopyBodySchema, ../contract/src/staff-access-rest.schemas.ts:264
interface Body {
  sourceOpsToken: string;
  projects?: string[];
  dryRun?: boolean;
}
type Response = z.infer<typeof staffAccessCopyReportSchema>; // ../contract/src/staff-access-rest.schemas.ts:309
```

## tRPC transport

### `staffAccess`

Contract `../contract/src/staff-access.trpc.ts:23`, router `src/transport/staff-access.trpc.ts:14`.

| Procedure                        | Kind     | Gate                             | Input                               | Output                              |
| -------------------------------- | -------- | -------------------------------- | ----------------------------------- | ----------------------------------- |
| `staffAccess.overview`           | query    | Platform permission `ops:manage` | inline                              | `staffAccessOverviewSchema`         |
| `staffAccess.enrolOptions`       | mutation | Platform permission `ops:manage` | inline                              | `staffAccessAssertionOptionsSchema` |
| `staffAccess.enrol`              | mutation | Platform permission `ops:manage` | `staffAccessEnrolInputSchema`       | `staffAccessEnrolledSchema`         |
| `staffAccess.revokeRequester`    | mutation | Platform permission `ops:manage` | `staffAccessRequesterIdInputSchema` | `staffAccessOkSchema`               |
| `staffAccess.getApprovalRequest` | query    | Platform permission `ops:manage` | `staffAccessRequestIdInputSchema`   | `staffAccessApprovalViewSchema`     |
| `staffAccess.approvalOptions`    | mutation | Platform permission `ops:manage` | `staffAccessApprovalChoiceSchema`   | `staffAccessAssertionOptionsSchema` |
| `staffAccess.approve`            | mutation | Platform permission `ops:manage` | `staffAccessApproveInputSchema`     | `staffAccessApprovalViewSchema`     |
| `staffAccess.deny`               | mutation | Platform permission `ops:manage` | `staffAccessRequestIdInputSchema`   | `staffAccessApprovalViewSchema`     |
| `staffAccess.revokeSession`      | mutation | Platform permission `ops:manage` | `staffAccessRequestIdInputSchema`   | `staffAccessOkSchema`               |
| `staffAccess.revokeAll`          | mutation | Platform permission `ops:manage` | `staffAccessRevokeAllInputSchema`   | `staffAccessRevokedCountSchema`     |

```typescript
// staffAccess.overview
// Input: inline, ../contract/src/staff-access.trpc.ts:25
type Input = unknown;
type Output = z.infer<typeof staffAccessOverviewSchema>; // ../contract/src/staff-access.ts:120

// staffAccess.enrolOptions
// Input: inline, ../contract/src/staff-access.trpc.ts:29
type Input = unknown;
// Output: staffAccessAssertionOptionsSchema, ../contract/src/staff-access.ts:123
interface Output {
  challenge: string;
  rpId: string;
  timeout: number;
  userVerification: "required";
  allowCredentials: {
    id: string;
    type: "public-key";
    transports?: string[];
  }[];
}

// staffAccess.enrol
type Input = z.infer<typeof staffAccessEnrolInputSchema>; // ../contract/src/staff-access.ts:133
// Output: staffAccessEnrolledSchema, ../contract/src/staff-access.ts:145
interface Output {
  requesterKey: string;
  requester: {
    id: string;
    name: string;
    createdAt: string;
    expiresAt: string;
    lastUsedAt: string | null;
    revokedAt: string | null;
  };
}

// staffAccess.revokeRequester
// Input: staffAccessRequesterIdInputSchema, ../contract/src/staff-access.ts:153
interface Input {
  requesterId: string;
}
// Output: staffAccessOkSchema, ../contract/src/staff-access.ts:199
interface Output {
  ok: true;
}

// staffAccess.getApprovalRequest
// Input: staffAccessRequestIdInputSchema, ../contract/src/staff-access.ts:159
interface Input {
  requestId: string;
}
type Output = z.infer<typeof staffAccessApprovalViewSchema>; // ../contract/src/staff-access.ts:107

// staffAccess.approvalOptions
// Input: staffAccessApprovalChoiceSchema, ../contract/src/staff-access.ts:171
interface Input {
  requestId: string;
  spendApproved: boolean;
  typedOrganizationName?: string;
}
type Output = z.infer<typeof staffAccessAssertionOptionsSchema>; // ../contract/src/staff-access.ts:123

// staffAccess.approve
type Input = z.infer<typeof staffAccessApproveInputSchema>; // ../contract/src/staff-access.ts:182
type Output = z.infer<typeof staffAccessApprovalViewSchema>; // ../contract/src/staff-access.ts:107

// staffAccess.deny
type Input = z.infer<typeof staffAccessRequestIdInputSchema>; // ../contract/src/staff-access.ts:159
type Output = z.infer<typeof staffAccessApprovalViewSchema>; // ../contract/src/staff-access.ts:107

// staffAccess.revokeSession
type Input = z.infer<typeof staffAccessRequestIdInputSchema>; // ../contract/src/staff-access.ts:159
type Output = z.infer<typeof staffAccessOkSchema>; // ../contract/src/staff-access.ts:199

// staffAccess.revokeAll
// Input: staffAccessRevokeAllInputSchema, ../contract/src/staff-access.ts:190
interface Input {
  confirmation: string;
}
// Output: staffAccessRevokedCountSchema, ../contract/src/staff-access.ts:196
interface Output {
  revoked: number;
}
```

## Sockets

None: this module declares no websocket, rawsocket or rawhttp door.

## Workers

### Pipeline `staff_access_expiry` (aggregate `global`)

Declared at `src/eventing/staff-access-expiry.pipeline.ts:31`.

| Kind            | Name                | Handles                                                                   | Declared at                                       |
| --------------- | ------------------- | ------------------------------------------------------------------------- | ------------------------------------------------- |
| process manager | `staffAccessExpiry` | every 1 min (`STAFF_ACCESS_EXPIRY_INTERVAL_MS`); intents `sweep` (outbox) | `src/eventing/staff-access-expiry.pipeline.ts:36` |

## Configuration

| Kind   | Leaf            | Environment variable | Declared at                                |
| ------ | --------------- | -------------------- | ------------------------------------------ |
| config | `publicBaseUrl` | `BASE_HOST`          | `../contract/src/staff-access.config.ts:5` |

<!-- readme:generated:end -->
