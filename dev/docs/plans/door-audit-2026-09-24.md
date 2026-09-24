# Door audit — 2026-09-24

Read-only audit of all 74 `moduleApi<` declarations (coordinator, W6 lint drive). A door is compile-checked only
when the installed module class `implements` it; otherwise `local-feature-api.ts:113-126` throws "not callable" at
the first operation read → HTTP 500. Getters do not count at runtime. Complements `module-wiring-audit.md`
(billing and hosted-mcp unmounted — already tracked there).

## Mounted doors missing operations → live 500s

| module        | door                                                     | missing                                                                | what breaks                                                                                                                              |
| ------------- | -------------------------------------------------------- | ---------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| stored-object | `StoredObjectFileApi` (stored-object-file.rest.ts:105)   | identify, countRead, assertProjectPermission                           | EVERY file read: GET/HEAD `/api/files/:projectId/:storedObjectId`, `/api/files/:storedObjectId`, `/api/v1` twins                         |
| project       | `ProjectBrowserApi` (project.trpc.ts:79)                 | getFieldProtections, provisionLangyVirtualKey, recordApiKeyRegenerated | `project.create` 500s after creating; `project.regenerateApiKey` rotates the key and never returns it; `project.getFieldRedactionStatus` |
| project       | `ProjectHomeApi` (home.trpc.ts:27)                       | getRecentItems                                                         | `home.getRecentItems`                                                                                                                    |
| project       | `IntegrationsChecksApi` (integrations-checks.trpc.ts:20) | getCheckStatus                                                         | `integrationsChecks.getCheckStatus`                                                                                                      |
| github        | `GithubInstallApi` / `GithubConnectionApi`               | resolveSession, recordAudit, backfillPullRequestMappings               | `/setup` with valid state; `github.disconnect` 500s after disconnecting — fix in progress (d3bbd76a55, lane fix-github-install-api-2)    |

`project.trpc.composition.unit.test.ts:255-283` asserts the project members throw "exposes operations only" — a test
pinning the defect.

## Unmounted doors missing operations → 404 today

- auth `AuthCliDeviceFlowApi` (auth-cli-device-flow.rest.ts:114): router not in `auth.server.ts` `.withTransports`; AuthApp
  lacks sessions, session, apiKeys, ensurePersonalWorkspace, canManageProject, publicBaseUrl. `/api/auth/cli/*` → CLI login
  broken; `apps/ui/e2e/langy/local-control-fixture.ts:233` calls it. NEW.
- billing: 3 doors, 14 operations, none implemented (tracked in module-wiring-audit.md §1).
- hosted-mcp `McpAuthorizeApi`: `approve` missing, router unmounted (module-wiring-audit.md §3); `/mcp/authorize` UI has no backend.

## Not compile-checked but complete today

AnalyticsLwql, ExperimentV3Rest, GatewaySpend, TraceLegacy, TrackedEvent, AuthDoor. One rename away from the same 500.

## Systemic

Nothing checks that the installed class satisfies the doors mounted over it. Fix: the kernel types each router's door
against the installed module class at `.withTransports(...)`, so a missing operation is a compile error.

## Progress

- github: fixed (d3bbd76a55, then the CodingAgentApi peer 340e7f3a2d). Completed-install and disconnect scenarios stay
  `@unimplemented`: `RedisGithubAppTokenCache.create` always builds `githubApiChannels.live`
  (redis-github-app-token-cache.ts:42), so a `memoryStores()` test cannot seed an installation — the channel choice
  should come from the registry's `{ live, memory }`.
