# @langwatch/onboarding-process

The server half of [onboarding](../README.md). Onboarding: the guided paths a new project follows and the steps it has recorded.

<!-- readme:generated:start (tools/readmegen; edit the code, then `pnpm generate:readmes`) -->

## Installation

`defineProcessModule("onboarding").withApi(OnboardingModule).withTransports(onboardingTrpcTransport, integrationsChecksTrpcTransport, onboardingRest).withEventing(guidedOnboardingLifecycleEventing).withTransportFacts(…)`, `src/onboarding.module.ts:10`.

Installed by api, worker, tasks, from each app's generated module list (`pnpm generate:modules`).

## Module API (`OnboardingApi`)

The onboarding capability. Operations arrive with the port of the process half.

Peers call these through the token, declared at `../contract/src/onboarding.api.ts:36`; nothing else in this package is public.

#### `getGuidedState`

```typescript
getGuidedState(input: Readonly<{ organizationId: string; userId: string | null }>): Promise<GuidedOnboardingStateWithVariant>;
```

#### `recordPaths`

```typescript
recordPaths(input: OnboardingCallerInput & Readonly<{ paths: readonly string[] }>): Promise<GuidedOnboardingState>;
```

#### `recordProvider`

```typescript
recordProvider(input: OnboardingCallerInput & Readonly<{ provider: string; model: string }>): Promise<GuidedOnboardingState>;
```

#### `recordProviderSkipped`

```typescript
recordProviderSkipped(input: OnboardingCallerInput): Promise<GuidedOnboardingState>;
```

#### `recordVirtualKeyReveal`

```typescript
recordVirtualKeyReveal(input: OnboardingCallerInput & Readonly<{ name: string; preview: string; revealId: string }>): Promise<GuidedOnboardingState>;
```

#### `recordTour`

```typescript
recordTour(input: OnboardingCallerInput & Readonly<{ status: "completed" | "skipped" | "replayed" }>): Promise<GuidedOnboardingState>;
```

#### `beginPath`

```typescript
beginPath(input: OnboardingCallerInput & Readonly<{ path: string }>): Promise<GuidedOnboardingStateWithInstance>;
```

#### `completePath`

```typescript
completePath(input: Readonly<{ organizationId: string; userId: string | null; path: string }>): Promise<GuidedOnboardingState>;
```

#### `attachConversation`

```typescript
attachConversation(input: OnboardingCallerInput & Readonly<{ conversationId: string }>): Promise<GuidedOnboardingState>;
```

#### `initializeOrganization`

The sign-up ceremony; the organization module carries it out.

```typescript
initializeOrganization(input: OnboardingInitializeOrganizationInput, by: OnboardingSignUpCaller): Promise<OrganizationInitialized>;
```

#### `recordIntegrationMethod`

```typescript
recordIntegrationMethod(input: Readonly<{ userId: string; selection: OnboardingIntegrationMethod }>): void;
```

#### `getGuidedStateByProject`

Throws `project_not_found` when the project is gone.

```typescript
getGuidedStateByProject(input: Readonly<{ projectId: string }>): Promise<GuidedOnboardingForProject>;
```

## REST transport

### `onboardingRest`

|             |                                              |
| ----------- | -------------------------------------------- |
| Declared at | `src/transport/onboarding.rest.ts:26`        |
| Base URL    | `/api/onboarding`, twin `/api/v1/onboarding` |
| Addressing  | dated                                        |
| Credential  | project                                      |
| Versions    | `2026-08-07`                                 |

#### `GET /guided` · `getApiOnboardingGuided`

Read the guided onboarding state of this project's organization: the paths picked in order, the one being set up, the ones done, the provider connected, and where the tour stands.

Permission `project:view`. Hidden from the OpenAPI document. Declared at `src/transport/onboarding.rest.ts:30`.

Answers at `/api/onboarding/guided`, `/api/v1/onboarding/guided`; also, undocumented, `/api/onboarding/2026-08-07/guided`, `/api/v1/onboarding/2026-08-07/guided`, `/api/onboarding/latest/guided`, `/api/v1/onboarding/latest/guided`.

```typescript
type Response = z.infer<typeof guidedStateWithVariantOutputSchema>; // ../contract/src/onboarding.trpc.ts:48
```

#### `POST /guided/paths/:path/complete` · `postApiOnboardingGuidedPathComplete`

Mark one guided onboarding path as done for this project's organization. Idempotent: completing a path twice changes nothing. An unknown path is refused with guided_onboarding_path_unknown.

Permission `project:view`. Hidden from the OpenAPI document. Declared at `src/transport/onboarding.rest.ts:42`.

Answers at `/api/onboarding/guided/paths/:path/complete`, `/api/v1/onboarding/guided/paths/:path/complete`; also, undocumented, `/api/onboarding/2026-08-07/guided/paths/:path/complete`, `/api/v1/onboarding/2026-08-07/guided/paths/:path/complete`, `/api/onboarding/latest/guided/paths/:path/complete`, `/api/v1/onboarding/latest/guided/paths/:path/complete`.

```typescript
type Params = z.infer<typeof guidedPathRestParamsSchema>; // ../contract/src/onboarding-schemas.ts:111
type Body = z.infer<typeof guidedPathCompleteRestInputSchema>; // ../contract/src/onboarding-schemas.ts:116
type Response = z.infer<typeof guidedStateOutputSchema>; // ../contract/src/onboarding.trpc.ts:43
```

## tRPC transport

### `integrationsChecks`

Contract `../contract/src/onboarding.trpc.ts:147`, router `src/transport/integrations-checks.trpc.ts:22`.

| Procedure                           | Kind  | Gate                        | Input  | Output                          |
| ----------------------------------- | ----- | --------------------------- | ------ | ------------------------------- |
| `integrationsChecks.getCheckStatus` | query | Permission `project:update` | inline | `integrationsCheckStatusSchema` |

### `onboarding`

Contract `../contract/src/onboarding.trpc.ts:91`, router `src/transport/onboarding.trpc.ts:24`.

| Procedure                           | Kind     | Gate                                                                                                                                                           | Input                                         | Output                                |
| ----------------------------------- | -------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------- | ------------------------------------- |
| `onboarding.getGuidedState`         | query    | Service-authorized: organization:view; guided-onboarding state is the organization's own; the app authorizes the exact organizationId before any read or write | `organizationIdInputSchema`                   | `guidedStateWithVariantOutputSchema`  |
| `onboarding.recordPaths`            | mutation | Service-authorized: organization:view; guided-onboarding state is the organization's own; the app authorizes the exact organizationId before any read or write | `recordPathsInputSchema`                      | `guidedStateOutputSchema`             |
| `onboarding.recordProvider`         | mutation | Service-authorized: organization:view; guided-onboarding state is the organization's own; the app authorizes the exact organizationId before any read or write | `recordProviderInputSchema`                   | `guidedStateOutputSchema`             |
| `onboarding.recordProviderSkipped`  | mutation | Service-authorized: organization:view; guided-onboarding state is the organization's own; the app authorizes the exact organizationId before any read or write | `organizationIdInputSchema`                   | `guidedStateOutputSchema`             |
| `onboarding.recordVirtualKeyReveal` | mutation | Service-authorized: organization:view; guided-onboarding state is the organization's own; the app authorizes the exact organizationId before any read or write | `recordVirtualKeyRevealInputSchema`           | `guidedStateOutputSchema`             |
| `onboarding.recordTour`             | mutation | Service-authorized: organization:view; guided-onboarding state is the organization's own; the app authorizes the exact organizationId before any read or write | `recordTourInputSchema`                       | `guidedStateOutputSchema`             |
| `onboarding.beginPath`              | mutation | Service-authorized: organization:view; guided-onboarding state is the organization's own; the app authorizes the exact organizationId before any read or write | `guidedPathInputSchema`                       | `guidedStateWithInstanceOutputSchema` |
| `onboarding.completePath`           | mutation | Service-authorized: organization:view; guided-onboarding state is the organization's own; the app authorizes the exact organizationId before any read or write | `guidedPathInputSchema`                       | `guidedStateOutputSchema`             |
| `onboarding.attachConversation`     | mutation | Service-authorized: organization:view; guided-onboarding state is the organization's own; the app authorizes the exact organizationId before any read or write | `attachConversationInputSchema`               | `guidedStateOutputSchema`             |
| `onboarding.initializeOrganization` | mutation | No permission: onboarding runs before the user belongs to any organization                                                                                     | `onboardingInitializeOrganizationInputSchema` | `organizationInitializedSchema`       |
| `onboarding.setIntegrationMethod`   | mutation | No permission: onboarding runs before the user belongs to any organization                                                                                     | `setIntegrationMethodInputSchema`             | `onboardingWriteAckSchema`            |

## Sockets

None: this module declares no websocket, rawsocket or rawhttp door.

## Workers

### Pipeline `guided_onboarding_lifecycle` (aggregate `guided_onboarding`)

Declared at `src/eventing/guided-onboarding-lifecycle.pipeline.ts:30`. Events: `guidedOnboardingRecordedEventSchema`.

| Kind    | Name                     | Handles | Declared at                                               |
| ------- | ------------------------ | ------- | --------------------------------------------------------- |
| command | `recordGuidedOnboarding` | –       | `src/eventing/guided-onboarding-lifecycle.pipeline.ts:35` |

## Configuration

None: no `static secrets` or `static config` leaf.

<!-- readme:generated:end -->
