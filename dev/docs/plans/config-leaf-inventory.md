# Config leaf inventory

One section per installed module, in the order `modules/server-modules.generated.ts`
lists them (49 modules). For each: the env spellings and schemas the module's
**contract** currently declares (old `RuntimeConfig.define`/`Config.value` shape
unless noted), the secret-shaped values found, and what the two deleted app
files (`apps/api/src/config.ts` HEAD:1537 lines, `apps/worker/src/config.ts`
HEAD:1452 lines — both read via `git show HEAD:<path>`, never restored to disk)
used to hand the module's `create()` through its process-half `static readonly
configSchema` (an inline schema on the `*.app.ts` file itself — this is the
"second declaration" the manifest names, distinct from the contract's own
env-reading schema).

**Snapshot caveat:** this checkout is shared by concurrent lanes. Two modules
(`log`, `metric`) were already found migrated to the new `Config.env`/`static
readonly config` shape mid-survey — call out anywhere else that has moved by
the time a module lane reads this.

Both deleted app files build an identical `slices` object over 32 module
names, then call `parseModuleConfig(serverModules.find(...), slices[name])`
once per name — api and worker install the **same 32 slices**, so one row of
"supplied by the deleted app config" applies to both processes unless noted.
The other 17 installed modules (`annotation`, `authz`, `codingAgent`,
`dashboard`* is actually in the 32, `dataPrivacy`, `evaluation`, `experiment`,
`governance`, `metric`, `monitor`, `notification`, `presence`, `project`,
`role`, `secret`, `share`, `topic`, `webhook`) are **not** in either app's
`slices` map at all — see each section for what that means for that module.

Legend for **Port difficulty**:
- `mechanical` — leaves and handles map 1:1, ownership is unambiguous.
- `needs-a-decision` — a collision, a missing wire, a secret declared as
  config, or an ownership question sits in the way of a pure rename.

---

### agent

Config leaves:
| field | env spelling | schema | default | source |
| replicaCount | LANGWATCH_APP_REPLICAS | z.coerce.number().int().positive() | 1 | contract (`agent.config.ts`) |
| relayMaxPayloadMb | LANGWATCH_AGENT_RELAY_MAX_PAYLOAD_MB | z.coerce.number().positive().optional() | — | contract |

Secrets: none declared.

Supplied by the deleted app config (`slices.agent`):
| field | where it came from | note |
| publicBaseUrl | `publicBaseUrl` (derived from `deploymentPublicBaseUrl`, i.e. `BASE_HOST`) | shared deployment fact, see below |
| connected | `config.infrastructure.connectedAgents` | a top-level-only field never declared by any module contract — trace it before porting |

Process half (`agent.app.ts`) declares its OWN `agentAppConfigSchema = z.object({ publicBaseUrl: z.url(), connected: agentServerConfigSchema.nullable(), httpTesting: z.boolean().optional() })` — note `agentServerConfigSchema` here is **not** this module's own contract schema name (`replicaCount`/`relayMaxPayloadMb` above); it is a *different* schema of the same name imported from elsewhere for `connected`. Confirm which `agentServerConfigSchema` resolves at that import before folding.

Port difficulty: needs-a-decision
Notes: `replicaCount`/`relayMaxPayloadMb` (the contract's own leaves) are never referenced in the deleted app's `slices.agent` at all — dead declarations, or read some other way. Confirm before deleting.

---

### analytics

Config leaves:
| field | env spelling | schema | default | source |
| langwatchQl.url | LWQL_CLICKHOUSE_URL | z.string().optional() | — | contract |
| langwatchQl.username | LWQL_CLICKHOUSE_USER | z.string().optional() | — | contract |
| langwatchQl.password | LWQL_CLICKHOUSE_PASSWORD | z.string().optional() | — | contract — **secret-shaped, declared as config** |
| langwatchQl.database | LWQL_DATABASE | z.string().optional() | — | contract |
| langwatchQl.tenantSetting | LWQL_TENANT_SETTING | z.string().optional() | — | contract |

Secrets: none declared (see note).

Supplied by the deleted app config (`slices.analytics`):
| field | where it came from | note |
| langwatchQl | `config.infrastructure.clickhouse.langwatchQl ?? {}` | passthrough of the contract's own five leaves |
| publicBaseUrl | `publicBaseUrl` (`BASE_HOST`) | shared deployment fact |

Process half's own `analyticsAppConfigSchema = analyticsServerConfigSchema.and(z.object({ publicBaseUrl: z.url() }))`.

Port difficulty: needs-a-decision
Notes: `LWQL_CLICKHOUSE_PASSWORD` presents to a real ClickHouse user — it authenticates. It is declared `Config.value` (config), not a secret handle. Once ported to `Secret.load`, the "all five or none" all-or-nothing check (`assertAnalyticsServerConfig`) spans both config leaves and a secret — that check needs to move to wherever the resolved config+secret both exist.

---

### annotation

No config or secrets found anywhere in the module (`modules/annotation`) — contract, process app, or services. Not in either deleted app's `slices` map.

Port difficulty: mechanical
Notes: declares nothing; nothing to port.

---

### api-key

Config leaves:
| field | env spelling | schema | default | source |
| pepper | API_KEY_PEPPER | z.string().optional() | — | contract |

Secrets: none declared directly, but see note.

Supplied by the deleted app config: **not present in `slices` at all.** `apiKeyPepper` is instead a top-level `apiConfigDefinition` field (`apiKeyServerConfigDefinition.pepper` referenced directly, line 193 of `apps/api/src/config.ts`), and the api's `resolveApiConfig` synthesizes its actual source value as `firstDefined(source, API_KEY_PEPPER_ENV_PRECEDENCE)` where `API_KEY_PEPPER_ENV_PRECEDENCE = ["CREDENTIALS_SECRET", "NEXTAUTH_SECRET"]` is *itself* pre-substituted (`CREDENTIALS_SECRET` is synthesized first as `firstDefined(source, ["CREDENTIALS_SECRET", "NEXTAUTH_SECRET"])`). So the real precedence, unwound, is: `API_KEY_PEPPER` → `CREDENTIALS_SECRET` → `NEXTAUTH_SECRET`.

Process half (`api-key.app.ts`) uses `configSchema = apiKeyServerConfigSchema` directly — no separate app-level schema.

Port difficulty: needs-a-decision
Notes: the pepper authenticates a hash comparison — it is secret-shaped and should be a `Secret.load` handle, but `Secret.load(id)` takes exactly ONE id with no fallback chain. This three-level fallback (own var → shared cipher secret → session secret) has no expression in the new primitive as it stands. See the `CREDENTIALS_SECRET` collision below — this module is a third claimant on the same chain, not just github and secret.

---

### auth

Config leaves:
| field | env spelling | schema | default | source |
| sessionUrl | NEXTAUTH_URL | z.string().optional() | — | contract |
| mfaEnrollmentOpen | MFA_ENROLLMENT_OPEN | "on"/"" → boolean | false | contract |
| passkeysEnabled | PASSKEYS_ENABLED | "on"/"" → boolean | false | contract |
| passkeyHandleSecret | PASSKEY_HANDLE_SECRET | z.string().optional() | falls back to session secret | contract — **secret-shaped, declared as config** |

Secrets: none declared in contract; `sessionSecret` (NEXTAUTH_SECRET) is described in a comment as "arrives resolved through the secrets member (ADR-132)" but no handle exists anywhere, old or new shape.

Supplied by the deleted app config (`slices.auth`):
| field | where it came from | note |
| processName | `config.serviceName` | a process fact, not a module fact |
| browserSession | `config.browserSession` (built by `resolveBrowserSessionConfig`) | see notes — the wiring for the actual secret is broken in this file |
| isSaas | `config.infrastructure.modelProvider.isSaas` ← `saasServerConfigDefinition.isSaas` (`IS_SAAS`) | shared deployment fact |

Process half's own `authAppConfigSchema` nests a `browserSessionIdentitySchema` requiring `secret: z.string().min(1)` **inside the config object** — a secret carried as a config field, which §6 explicitly forbids ("never a field on the parsed config object").

Port difficulty: needs-a-decision
Notes: tracing `resolveBrowserSessionConfig`'s caller in the deleted file, the object it's given (`{...value.browserSession, publicUrl: ...}`) never actually includes a `sessionSecret` field — `authServerConfigDefinition`/`value.browserSession` in that file's own top-level schema has no such leaf. Either this file was already mid-migration and broken, or the secret arrived through a path not visible in this file. A lane must decide: (a) where `NEXTAUTH_SECRET` truly comes from today, and (b) how to pull the secret handle out of `browserSessionIdentitySchema` into a real `Secret.load` while keeping the "both or neither" all-or-nothing refusal (`assertAuthServerConfig`) working across a config+secret split.

---

### authz

Config leaves:
| field | env spelling | schema | default | source |
| epochCacheEnabled | AUTHZ_EPOCH_CACHE | "1"/"true" → boolean | false | contract |
| demoProjectId | DEMO_PROJECT_ID | blank→absent string | — | contract |
| demoProjectUserId | DEMO_PROJECT_USER_ID | blank→absent string | — | contract |

Secrets: none.

Supplied by the deleted app config: **not in `slices` at all.** `authz` is read at the top level (`apiConfigDefinition.authz = {...authzServerConfigDefinition}`, fed straight into `ProcessConfig.authz` for the `demoProjectId`/`demoProjectUserId` values organization's slice re-derives — see organization below) but `authz.app.ts` has **no `configSchema` static anywhere** — grep across the whole process package confirms no `Config` identifier appears in `authz.app.ts` or `postgres-authz.build.ts`.

Port difficulty: needs-a-decision
Notes: the contract declares real deployment facts that the process half never consumes through the standard config seam. Before porting, find how (or whether) `epochCacheEnabled`/the demo project ids actually reach the running services today — a composition-build file may pass them as explicit constructor arguments outside the module's own `create()`.

---

### automation

Config leaves:
| field | env spelling | schema | default | source |
| emailHourlyCap | TRIGGER_EMAIL_HOURLY_CAP | positive int | 100 | contract |
| tenantDailyCap | TRIGGER_EMAIL_TENANT_DAILY_CAP | positive int | 10,000 | contract |
| persistDailyCapFree | TRIGGER_PERSIST_DAILY_CAP_FREE | positive int | 50 | contract |
| persistDailyCapPaid | TRIGGER_PERSIST_DAILY_CAP_PAID | positive int | 500 | contract |
| persistDailyCapEnterprise | TRIGGER_PERSIST_DAILY_CAP_ENTERPRISE | positive int | 5,000 | contract |

Secrets: none in contract.

Supplied by the deleted app config (`slices.automation`):
| field | where it came from | note |
| baseHost | `publicBaseUrl` (`BASE_HOST`) | shared deployment fact |
| unsubscribeSecret | `config.storedSecretEncryptionKey` (the SAME cipher key `secret`/`api-key` derive from `CREDENTIALS_SECRET`) | reuse of another module's secret material, not a fact of its own |

Process half's own `automationAppExtraConfigSchema = z.object({ baseHost, unsubscribeSecret })`, merged with the contract's schema by `automationAppConfigSchema.parse`.

Port difficulty: needs-a-decision
Notes: `unsubscribeSecret` is not automation's own secret — it's the stored-secret cipher key, reused to sign an unsubscribe link. Whoever owns `CREDENTIALS_SECRET` as a `Secret.load` handle (see the collision below) needs to hand automation a derived token, not the raw value — a design question, not a rename.

---

### coding-agent

No config or secrets found anywhere in the module. Not in either deleted app's `slices` map. (One incidental read of `getAppConfig().appSlug` is a call into the **github** module's own already-parsed config, not this module's own.)

Port difficulty: mechanical
Notes: declares nothing; nothing to port.

---

### dashboard

Config leaves: none in contract (no `dashboard.config.ts` exists).

Secrets: none.

Supplied by the deleted app config (`slices.dashboard`): `{ baseHost: publicBaseUrl }` — the shared `BASE_HOST` fact, and nothing else.

Process half's own `dashboardAppZodSchema = z.object({ baseHost: z.string().default("") })`, wrapped so an absent slice still parses (`dashboardAppConfigSchema.parse((value ?? {}) as ...)`).

Port difficulty: mechanical
Notes: this module's only "config" is the shared `BASE_HOST` fact; once that's a canonical import from `@langwatch/config`, dashboard needs no config schema of its own at all.

---

### data-privacy

Config leaves:
| field | env spelling | schema | default | source |
| googleApplicationCredentials | GOOGLE_APPLICATION_CREDENTIALS | secret-shaped | — | contract, declared via `Config.optionalSecret` (old shape's OWN secret helper — already correctly separated from plain config, unlike most other modules here) |
| googleDlpDisabled | LANGWATCH_DISABLE_GOOGLE_DLP | boolean/string union, optional | — | contract |
| enforcement | LANGWATCH_DATA_PRIVACY_ENFORCEMENT | z.string().optional() | — | contract |

Supplied by the deleted app config: **not in `slices` at all**, and `data-privacy.app.ts` has no `configSchema` static — `DataPrivacyConfig` there is a **per-call, per-tenant** parameter threaded through `create()`'s method signatures, not a process-level deployment config.

Port difficulty: needs-a-decision
Notes: same "declared in contract, never wired at process boot" gap as `authz`. `googleApplicationCredentials` is already correctly modeled as a secret in the old shape (`Config.optionalSecret`) — the new-shape port of the SECRET half is closer to mechanical than most; the open question is purely where the boot-time slice attaches.

---

### data-retention

Config leaves:
| field | env spelling | schema | default | source |
| platformDefaultDays | LANGWATCH_DEFAULT_RETENTION_DAYS | z.string().optional(), NODE_ENV-gated | — | contract |

Secrets: none.

Supplied by the deleted app config (`slices["data-retention"]`): `{ platformDefaultRetentionDays: resolvePlatformDefaultRetentionDays({...}) }` — the contract's own resolver function, applied at the composition root rather than inside the module.

Process half's own inline `configSchema = z.object({ platformDefaultRetentionDays: platformDefaultRetentionDaysSchema })` (a plain number, already-resolved — the env-reading and the NODE_ENV gate both happen upstream).

Port difficulty: mechanical

---

### dataset

Config leaves: none in contract.

Secrets: none.

Supplied by the deleted app config (`slices.dataset`): `{ publicBaseUrl }` — shared `BASE_HOST` fact only.

Process half's own `datasetAppConfigSchema` (a hand-rolled `FeatureConfigSchema` object, not a zod schema) validates `{ publicBaseUrl?: string }`.

Port difficulty: mechanical

---

### entitlement

Config leaves: none in contract.

Secrets: none.

Supplied by the deleted app config (`slices.entitlement`):
| field | where it came from | note |
| processName | `config.serviceName` | process fact |
| isSaas | `config.infrastructure.modelProvider.isSaas` | shared deployment fact |
| requestBounds | `config.requestBounds` (`{ ...requestBoundsConfigDefinition }`, a framework-owned leaf) | boot overrides for a central registry, framework-owned not module-owned |

Process half's own `entitlementAppConfigSchema = z.object({ isSaas, processName, requestBounds })`.

Port difficulty: mechanical
Notes: `requestBounds` is framework config (`@langwatch/plans`'s `RequestBoundsOverrides`), handed to entitlement as a dependency value — confirm it should keep flowing through entitlement's own config slice or become a declared framework config the module reads as a peer capability.

---

### evaluation

Config leaves:
| field | env spelling | schema | default | source |
| langevalsEndpoint | LANGEVALS_ENDPOINT | z.string().optional() | — | contract (`evaluation.config.ts`) |

A second file, `worker-evaluation.config.ts`, has NO `RuntimeConfig`/env leaves of its own — it's a pure function (`resolveWorkerEvaluationEnvironment`) that narrows an already-read environment bag down to the variable names each installed evaluator's own registry entry declares (`AVAILABLE_EVALUATORS[*].envVars`, plus two native switches `LANGWATCH_ENABLE_PRESIDIO`/`LANGWATCH_ENABLE_LINGUA`). This is a dynamic, evaluator-registry-driven env allowlist, not a static leaf set.

Supplied by the deleted app config: **not in `slices` at all**; `evaluation.app.ts`/`evaluator.app.ts` split (evaluator IS in slices — see below; `evaluation` module itself is not).

Port difficulty: needs-a-decision
Notes: `resolveWorkerEvaluationEnvironment`'s dynamic, registry-driven variable set does not fit the static `Config.env(NAME, schema)` shape at all — each evaluator plugin names its own env vars at runtime. This needs an explicit design call on how a dynamic set of deployment facts is declared under the new primitives (a single `Config.env` leaf holding a record, most likely) rather than a mechanical per-field rename.

---

### evaluator

Config leaves: none in contract.

Secrets: none.

Supplied by the deleted app config (`slices.evaluator`): `{ publicBaseUrl }` — shared `BASE_HOST` fact only.

Process half's own `evaluatorAppConfigSchema = z.object({ fallbackModels: {...}.optional(), publicBaseUrl: z.string().optional() })`. Note `fallbackModels` is never populated by either deleted app's `slices.evaluator` — check whether it is dead or supplied elsewhere (e.g. `model-provider`'s `defaultModel`/`getLatestOpenAIChatFlagship`).

Port difficulty: mechanical
Notes: confirm `fallbackModels` before deleting — it may be an unwired field like `agent.connected`'s neighbours.

---

### experiment

No config or secrets found anywhere in the module. Not in either deleted app's `slices` map.

Port difficulty: mechanical
Notes: declares nothing; nothing to port.

---

### feature-flag

Config: no `RuntimeConfig.define`/`Config.value` leaves. Instead, a **dynamic** resolver (`resolveFeatureFlagConfig`) walks the flag registry (`FEATURE_FLAGS`) and reads one env var per flag definition (`envOverridable`/`legacyEnvVar` per flag) plus one fixed var:
| field | env spelling | schema | default | source |
| forceEnabled | FEATURE_FLAG_FORCE_ENABLE | comma-separated list, unregistered keys dropped | [] | contract |
| overrides | (one var per registered flag, name from the flag's own definition) | boolean-ish | — | contract, per-flag dynamic |

Secrets: none.

Supplied by the deleted app config (`slices["feature-flag"]`): `config.featureFlags` — itself `resolveFeatureFlagConfig(...)` called once at the top of the deleted file over the process's own environment.

Process half's own `featureFlagAppConfigSchema` is a hand-rolled `FeatureConfigSchema<FeatureFlagConfig>` whose `.parse` REFUSES a raw env record — it only accepts an already-resolved `{ overrides: Map, forceEnabled: Set }`, throwing otherwise. This is the same "dynamic per-registry-entry" shape as `evaluation`'s worker environment resolver.

Port difficulty: needs-a-decision
Notes: same class of problem as `evaluation` — a per-flag dynamic env name set does not fit one static `Config.env` leaf per field.

---

### gateway

Config leaves:
| field | env spelling | schema | default | source |
| spendSettlementGraceMs | LW_SPEND_SETTLEMENT_GRACE_MS | z.string().optional() | — | contract |

Secrets found via `members.secrets.find(...)` in `gateway.app.ts` (old-shape secrets member, not `Secret.load`):
| handle | id | optional | consumed by |
| virtualKeyPepper | LW_VIRTUAL_KEY_PEPPER | yes (blank tolerated at construction, fails at first hash) | `VirtualKeyCryptoAdapter` |
| jwtSecret | LW_GATEWAY_JWT_SECRET | — | data-plane JWT signer |
| internalSecret | LW_GATEWAY_INTERNAL_SECRET | — | referenced only via `assertGatewaySecretsAllOrNone`/comment in the contract; no `members.secrets.find` call was found for it in `gateway.app.ts` itself — confirm where it's actually read before porting |

Supplied by the deleted app config (`slices.gateway`): `{ internalSecret: config.gatewayInternalSecret, jwtSecret: config.gatewayJwtSecret, virtualKeyPepper: config.virtualKeyPepper, spendSettlementGraceMs: config.spendSettlementGraceMs }` — the three secrets arrive as **plain config fields** here (`apiConfigDefinition.gatewayInternalSecret` etc. reference the contract's own `RuntimeConfig.define` leaves directly, not a secrets seam), contradicting the `members.secrets.find` calls seen in the process half. Two different resolution paths for the same three values exist in the tree today.

Port difficulty: needs-a-decision
Notes: `assertGatewaySecretsAllOrNone` is an "all three or none" cross-field refusal spanning three secrets — same shape problem as `auth`'s browser-session check, now with secrets only (no config mixed in), so likely easier: the check can run after all three resolve through `secrets.into`.

---

### github

Config leaves:
| field | env spelling | schema | default | source |
| appId | GITHUB_LANGY_APP_ID | z.string().optional() | — | contract |
| host | GITHUB_LANGY_HOST | z.string().optional() | — | contract |
| appSlug | GITHUB_LANGY_APP_SLUG | z.string().optional() | — | contract |

Secrets found via `members.secrets.find(...)` in `github.app.ts` — **none declared in the contract at all**:
| handle | id | optional | consumed by |
| privateKey | GITHUB_LANGY_PRIVATE_KEY | falls back to `""` | GitHub App installation-token minting |
| webhookSecret | GITHUB_LANGY_WEBHOOK_SECRET | falls back to `""` | webhook signature verification |
| signingKey | **CREDENTIALS_SECRET** | falls back to `""` | — see collision below |

Supplied by the deleted app config (`slices.github`): `{ appId: config.infrastructure.github.appId, privateKey: config.infrastructure.github.privateKey, appSlug: config.infrastructure.github.appSlug, webhookSecret: config.infrastructure.github.webhookSecret, host: config.infrastructure.github.host }` — a `config.infrastructure.github` object this survey did not find any top-level `RuntimeConfig.define` source for (the contract's own `githubServerConfigDefinition` has only `appId`/`host`/`appSlug` — `privateKey`/`webhookSecret` are absent from it entirely). Confirm `infrastructure.github`'s own definition before porting; it was not reached by this survey's read of `apiConfigDefinition`'s literal fields.

Port difficulty: needs-a-decision
Notes: `signingKey` reading raw `CREDENTIALS_SECRET` is the manifest's named collision — see below. **Update mid-survey**: `github.config.ts` was migrated to the new `Config.env` shape while this document was being written (three leaves only, matching the table above; its own comment now points to `GithubApp.secrets` for credentials) — the contract-side rename is already done, the `CREDENTIALS_SECRET`/`GITHUB_LANGY_PRIVATE_KEY`/`GITHUB_LANGY_WEBHOOK_SECRET` handles and the process-side wiring are still open.

---

### governance (enterprise)

Config leaves (contract-declared, `governanceAppConfigSchema`, **no env var named anywhere in this file** — every value is meant to arrive from a composition root):
| field | shape | note |
| gatewayBaseUrl | z.string().min(1) | where a personal virtual key sends traffic |
| publicBaseUrl | z.string().min(1) | shared `BASE_HOST` fact |
| ingestionSecretPepper | z.string().default("") | **secret-shaped, declared as config, defaults to the empty string** |
| ottl.baseUrl / ottl.secret | nullable strings, default null | `ottl.secret` is secret-shaped |

Supplied by the deleted app config: **not present in either app's `slices` map at all**, and `governance.app.ts` has no `configSchema` static — the entire `governanceAppConfigSchema` is unwired at both ends found by this survey.

Port difficulty: needs-a-decision
Notes: fully orphaned — no visible producer or consumer of this schema in the current tree. A lane needs to find whether governance's config is composed some other way (an enterprise-only composition file this survey's manifest paths didn't include) before treating this as "declares nothing."

---

### hosted-mcp

Config leaves: none in contract.

Secrets: none.

Supplied by the deleted app config (`slices["hosted-mcp"]`): `{ baseHost: publicBaseUrl }` — shared `BASE_HOST` fact only.

Process half's own inline `configSchema = z.object({ baseHost: z.string().min(1) })` (required, no default — unlike dashboard's optional variant of the same fact).

Port difficulty: mechanical

---

### identity

Config leaves: none in contract.

Secrets: none.

Supplied by the deleted app config (`slices.identity`): `{ adminEmails: (config.deployment.adminEmails ?? "").split(",").map(trim).filter(Boolean) }` where `config.deployment.adminEmails` is `saasServerConfigDefinition.adminEmails` — **`ADMIN_EMAILS`, declared only in the `saas` module's contract, which is not in the installed 49.**

Process half's own `identityAppConfigSchema = z.object({ adminEmails: z.array(z.string()).default([]), registersPipelines: z.boolean().default(true) })`.

Port difficulty: needs-a-decision
Notes: see the `ADMIN_EMAILS` shared-fact note below — `ops` derives the exact same field, from the exact same source, with the exact same split/trim/filter transform.

---

### langy

Config leaves:
| field | env spelling | schema | default | source |
| agentUrl | LANGY_AGENT_URL | z.string().optional() | — | contract |

Secrets found via `members.secrets.find(...)`:
| handle | id | optional | consumed by |
| internalSecret | LANGY_INTERNAL_SECRET | — | `assertLangyServerConfig`'s "both or neither" check against `agentUrl` |

Supplied by the deleted app config (`slices.langy`): `{ internalSecret: config.langyInternalSecret }` — again a **plain config field** in the deleted file (`apiConfigDefinition.langyInternalSecret` references `langyServerConfigDefinition` directly, no secrets seam), vs. the process half's own `members.secrets.find`. Same two-paths-for-one-value pattern as `gateway`.

Port difficulty: mechanical
Notes: single secret, single "both or neither" check — straightforward once one resolution path is picked.

---

### licensing (enterprise)

Config leaves:
| field | env spelling | schema | default | source |
| publicKey | LANGWATCH_LICENSE_PUBLIC_KEY | blank→absent string | — | contract |

Secrets: none (a public key verifies, does not authenticate — correctly a config leaf under the classification rule).

Supplied by the deleted app config (`slices.licensing`): `config.infrastructure.licensing` — the same leaf, passed straight through with no top-level definition found beyond the contract's own.

Process half's own `configSchema = licensingServerConfigSchema` directly, no extra app schema.

Port difficulty: mechanical

---

### log

Config leaves (**already migrated to the new shape**):
| field | env spelling | schema | default | source |
| processingShards | LOG_PROCESSING_SHARDS | z.string().optional() | — | contract, `Config.env` (new shape) |

Secrets: none.

Supplied by the deleted app config (`slices.log`): `{}` — nothing.

Process half: `static readonly config = logConfig` (new shape, already attached).

Port difficulty: mechanical (done)
Notes: use this module as the worked example for every other one in this list.

---

### managed-provider (enterprise)

Config leaves:
| field | env spelling | schema | default | source |
| bedrock | MANAGED_BEDROCK_CONFIGS | JSON → `Record<orgId, BedrockConfig>` | {} | contract |

Secrets: none declared (each per-org Bedrock config's own credentials are presumably inside the JSON blob — confirm the shape of `managedBedrockConfigSchema` before treating the directory as non-secret).

Supplied by the deleted app config (`slices["managed-provider"]`): `{ bedrock: config.managedProvider.bedrock }` — the already-parsed directory, passed straight through. A second schema, `managedProviderAppConfigSchema`, exists purely so the PROCESS-supplied (already-parsed) value isn't re-run through the env-reading JSON-parse schema.

Port difficulty: mechanical
Notes: worth checking whether `managedBedrockConfigSchema`'s per-org fields (in `managed-provider.api.ts`) hold credentials — if so, this directory is secret-shaped and the "declared as config" flag applies here too.

---

### metric

Config leaves (**already migrated to the new shape**, discovered mid-survey — see snapshot caveat):
| field | env spelling | schema | default | source |
| processingShards | METRIC_PROCESSING_SHARDS | z.string().optional() | — | contract, `Config.env` (new shape) |

Secrets: none.

Supplied by the deleted app config: **not in either `slices` map.**

Process half: `static readonly config = metricConfig` (new shape, already attached).

Port difficulty: mechanical (done)

---

### model-provider

Config leaves:
| field | env spelling | schema | default | source |
| blockLocalHttpCalls | BLOCK_LOCAL_HTTP_CALLS | "1 or true, else off" | — | contract |
| allowedProxyHosts | ALLOWED_PROXY_HOSTS | comma-list → string[] | [] | contract |
| nlpServiceUrl | LANGWATCH_NLP_SERVICE | trimmed optional string | — | contract |
| defaultModel | LANGWATCH_DEFAULT_MODEL | trimmed optional string | — | contract |

Secrets: none in contract (per-project provider API keys are a different, per-tenant surface, not process config).

Supplied by the deleted app config (`slices["model-provider"]`):
| field | where it came from | note |
| isSaas | `config.infrastructure.modelProvider.isSaas` (`IS_SAAS`) | shared deployment fact |
| egress.blockLocal / egress.allowedHosts | the contract's own two leaves | passthrough |
| egress.verifyTls | literal `true` | never configurable today — the process half's comment notes this needs a new field on apps/api's own resolution first |
| executionProxyBaseUrl | built from `config.infrastructure.execution.nlpServiceUrl` via `HttpWorkflowNlpRuntimeAdapter.proxyBaseUrl` | derived, not a raw env value; `execution.nlpServiceUrl` itself is not `LANGWATCH_NLP_SERVICE` above — a SEPARATE nlp address (workflow's own, see `workflow` below) |
| environment | not shown in the slice literal — see `modelProviderAppConfigSchema`'s own `environment: z.record(...)` field, described as "the process environment a system provider's fallback credential is read from" | a raw env-var passthrough map, worth flagging on its own |

Process half's own `modelProviderAppConfigSchema` (shown above) — note it is a DIFFERENT, richer shape than the contract's four leaves.

Port difficulty: needs-a-decision
Notes: the `environment` field is a literal escape hatch — the module receives a `Record<string, string | undefined>` of arbitrary env vars for "a system provider's fallback credential," which is exactly the ambient-environment pattern §6 exists to close off. Needs an explicit decision on which named credentials those are and whether they become named `Secret.load` handles instead.

---

### monitor

No config or secrets found anywhere in the module. Not in either deleted app's `slices` map.

Port difficulty: mechanical
Notes: declares nothing; nothing to port.

---

### notification

Config leaves:
| field | env spelling | schema | default | source |
| defaultFrom | EMAIL_DEFAULT_FROM | z.string().optional() | — | contract |
| provider | EMAIL_PROVIDER | z.string().optional() | — | contract |
| ses.enabled | USE_AWS_SES | z.string().optional() | — | contract |
| ses.region | AWS_REGION | z.string().optional() | — | contract |
| ses.endpoint | AWS_SES_ENDPOINT | z.string().optional() | — | contract |
| smtp.host | SMTP_HOST | z.string().optional() | — | contract |
| smtp.port | SMTP_PORT | z.string().optional() | — | contract |
| smtp.user | SMTP_USER | z.string().optional() | — | contract |
| smtp.secure | SMTP_SECURE | z.string().optional() | — | contract |

Secrets (already correctly separated in the old shape via `Config.optionalSecret`):
| handle | id | optional | consumed by |
| sendgrid.apiKey | SENDGRID_API_KEY | yes | `EmailProviderService` |
| smtp.url | SMTP_URL | yes | same |
| smtp.password | SMTP_PASSWORD | yes | same |
| resend.apiKey | RESEND_API_KEY | yes | same |

Supplied by the deleted app config: **not in either `slices` map at all.** The contract's `notificationServerConfigDefinition` is instead read at `apiConfigDefinition.mail = {...notificationServerConfigDefinition}` and fed directly into a process-level `MailerConfiguration`/`EmailProviderService` construction — a domain-driven `mail` global config object per §6 layer 2, not a module-named slice, and consistent with `notification.app.ts` having no `configSchema` static.

Port difficulty: needs-a-decision
Notes: less about mechanics than ownership — confirm this is meant to live as `mail` on the process-global config object rather than as the `notification` module's own slice, per the architecture's domain-driven-global rule, and that the notification module receives the constructed `EmailProviderService`/mailer as a dependency, never the raw config.

---

### ops

Config leaves:
| field | env spelling | schema | default | source |
| apiKey | LANGWATCH_OPS_API_KEY | z.string().optional() | — | contract — **secret-shaped (a bearer token), declared as config** |
| metricsApiKey | METRICS_API_KEY | z.string().optional() | — | contract — **secret-shaped, declared as config** |
| clickhouseOpsUrl | CLICKHOUSE_OPS_URL | z.string().optional() | — | contract — a connection string, see the store-connection flag below |
| usageStats.disabled | DISABLE_USAGE_STATS | "1 or true, else off" | — | contract |
| usageStats.installMethod | INSTALL_METHOD | z.string().optional() | — | contract |
| collectClickHouseBackupMetrics | CLICKHOUSE_BACKUP_METRICS_ENABLED | off-list → boolean | true | contract |
| productAnalytics.key | POSTHOG_KEY | z.string().optional() | — | contract (surfaced to the browser as-is — not secret-shaped, it's a client-safe project key) |
| productAnalytics.host | POSTHOG_HOST | z.string().optional() | — | contract |

Supplied by the deleted app config (`slices.ops`):
| field | where it came from | note |
| adminEmails | `config.deployment.adminEmails` (`ADMIN_EMAILS`) | **same source, same transform as `identity`'s slice** — shared-fact candidate |
| opsApiKey | `config.opsApiKey` (`LANGWATCH_OPS_API_KEY`, referenced directly, not a secret) | |
| opsClickHouseUrl | `config.infrastructure.clickhouse.opsUrl` | a THIRD ClickHouse connection identity, alongside the main and LWQL ones |
| isProduction | `config.nodeEnvironment === "production"` | derived process fact |
| legacySsoStringWritesRetired | `config.legacySsoStringWritesRetired` (`SSOCONN_ROUTING === "enforce"`) | a cross-cutting SSO-connection-write-path switch, oddly homed on `ops` |

Process half's own `opsAppConfigSchema` matches these five fields (`adminEmails`, `opsApiKey`, `opsClickHouseUrl`, `isProduction`, `legacySsoStringWritesRetired`) — note `usageStats`/`collectClickHouseBackupMetrics`/`productAnalytics` (contract leaves) never reach the process app schema at all.

Port difficulty: needs-a-decision
Notes: (1) `opsApiKey`/`metricsApiKey` authenticate cross-tenant admin endpoints — reclassify as secrets. (2) `opsClickHouseUrl` is a store connection string and belongs to the process's stores config per §6 layer 1, not to a module. (3) `usageStats`/`productAnalytics`/`collectClickHouseBackupMetrics` are declared in the contract but not wired into `create()` at all — same orphan pattern as `authz`/`governance`. (4) `legacySsoStringWritesRetired` reads an SSO-shaped env var (`SSOCONN_ROUTING`) into an `ops`-owned field — confirm this isn't better homed with the `sso`/`identity` modules that actually gate on it.

---

### organization

Config leaves: none in contract.

Secrets: none.

Supplied by the deleted app config (`slices.organization`):
| field | where it came from | note |
| processName | `config.serviceName` | process fact |
| demoProject.userId / .projectId | `config.authz.demoProjectUserId` / `.demoProjectId` (`DEMO_PROJECT_USER_ID`/`DEMO_PROJECT_ID`, both owned by `authz`'s contract) | organization needs a value `authz` already declares — a candidate for reading `authz`'s `*Api` instead of duplicating the env-derived value in its own slice |
| baseHost | `publicBaseUrl` (`BASE_HOST`) | shared deployment fact |

Process half's own `organizationAppConfigSchema = z.object({ processName, demoProject: {...}, baseHost })`.

Port difficulty: needs-a-decision
Notes: the `demoProject` fields are `authz`'s own declared env leaves, reused here under new names. Decide whether organization should keep its own copies (fine, since it's the SAME meaning — see the shared-facts rule) or call through `AuthzApi`.

---

### platform-health

Config leaves:
| field | env spelling | schema | default | source |
| publicBaseUrl | (via `deploymentPublicBaseUrl`, i.e. `BASE_HOST`) | — | — | contract — the one module in this survey that already imports the canonical shared leaf rather than re-declaring it |

Secrets found via `members.secrets.find(...)`:
| handle | id | optional | consumed by |
| probeApiKey | PLATFORM_HEALTH_PROBE_API_KEY | falls back to `""` | the canary project credential |
| apiKey | PLATFORM_HEALTH_API_KEY | falls back to `""` | the external monitor's own key |

Supplied by the deleted app config (`slices["platform-health"]`): `config.platformHealth` — passthrough, no extra derivation.

Process half's own `configSchema = platformHealthServerConfigSchema` directly.

Port difficulty: mechanical
Notes: model every other module's `BASE_HOST` usage on this one — it already imports `deploymentPublicBaseUrl` instead of re-declaring the fact.

---

### presence

No config or secrets found anywhere in the module. Not in either deleted app's `slices` map.

Port difficulty: mechanical
Notes: declares nothing; nothing to port.

---

### project

No config or secrets found anywhere in the module. Not in either deleted app's `slices` map.

Port difficulty: mechanical
Notes: declares nothing; nothing to port.

---

### prompt

Config leaves: none in contract.

Secrets: none.

Supplied by the deleted app config (`slices.prompt`): `{ publicBaseUrl }` — shared `BASE_HOST` fact only.

Process half's own inline `configSchema = z.object({ publicBaseUrl: z.url() })` (required, unlike most other `BASE_HOST` consumers which treat it as optional).

Port difficulty: mechanical

---

### role

No config or secrets found anywhere in the module. Not in either deleted app's `slices` map.

Port difficulty: mechanical
Notes: declares nothing; nothing to port.

---

### scenario

Config: `scenario.config.ts` does not exist; the two files found under `contract/src/voice/` (`caller-voice.config.ts`, `voice-agent.config.ts`) are per-run DOMAIN configuration (a scenario's voice/transport settings, stored per row) — not deployment facts, and name no environment variable. They are out of scope for this survey.

Secrets: `run-secret-ciphertext.ts` defines only a wire SHAPE (`Record<paramName, ciphertext>`) for encrypted run parameters — not a deployment secret handle.

Supplied by the deleted app config (`slices.scenario`): `{ publicBaseUrl }` — shared `BASE_HOST` fact only.

Process half's own inline `configSchema = z.object({ publicBaseUrl: z.string().optional() }).default({})`.

Port difficulty: mechanical
Notes: only the `BASE_HOST` fact is a real deployment config; the two `voice/*.config.ts` files are misnamed relative to this survey's search (they are domain schemas, not `RuntimeConfig`) — do not confuse them with a deployment declaration when porting.

---

### scim (enterprise)

Config leaves:
| field | env spelling | schema | default | source |
| auth0WebhookSecret | AUTH0_SCIM_WEBHOOK_SECRET | z.string().optional() | — | contract — **secret-shaped (verifies an inbound webhook signature), declared as config** |
| provenOffboarding | SCIM_V2_GRANTS | environmentBooleanSchema | false | contract |

Supplied by the deleted app config (`slices.scim`): `config.scim` — passthrough of both fields, no extra derivation (`config.scim = {...scimServerConfigDefinition}` at the top level).

Process half's own `configSchema = scimServerConfigSchema` directly.

Port difficulty: needs-a-decision
Notes: `auth0WebhookSecret` authenticates an inbound call and should become a `Secret.load` handle, not a config leaf — the module's own comment ("a blank webhook secret answers 404... so an unconfigured install looks unrouted") means the refusal behaviour on absence must be preserved across the reclassification.

---

### secret

No config or secrets declared anywhere in `modules/secret`. The `secretServerConfigDefinition` symbol the deleted `apps/api/src/config.ts` imports from `@langwatch/secret-contract` (for `storedSecretEncryptionKey`, i.e. `CREDENTIALS_SECRET`) **does not exist in the current tree** — `modules/secret/contract/src/` has no `.config.ts` file at all (only a stale `dist/secret.config.d.ts` build artifact from before it was deleted). Not in either deleted app's `slices` map (the module gets no config injected at all — its `create()` takes only a repository).

Port difficulty: needs-a-decision
Notes: this is the OTHER half of the `CREDENTIALS_SECRET` collision named in the manifest (`secret.encryptionKey`). The cipher-key concept that `packages/storage-seed/src/api-key-pepper.ts` and other framework packages already read `CREDENTIALS_SECRET` for lives OUTSIDE this module entirely today — confirm whether the secret module is meant to own this handle at all, or whether it belongs to a framework package (`@langwatch/secrets` itself, or wherever the cipher is constructed).

---

### share

No config or secrets found anywhere in the module. Not in either deleted app's `slices` map.

Port difficulty: mechanical
Notes: declares nothing; nothing to port.

---

### sso (enterprise)

Config: **no contract `.config.ts` file exists.** The module's entire configuration is one flat schema, `ssoConfigurationSchema` (`sso.contract.ts`), attached directly as `static readonly configSchema` — no environment variable is named anywhere in the module:

| field | shape | note |
| isSaas | z.boolean() | shared deployment fact (`IS_SAAS`) |
| provider | z.string().min(1) | |
| baseUrl | z.string().min(1) | shared `BASE_HOST`-family fact |
| instanceLicenseKey | optional min(1) string | secret-shaped |
| {google,github,gitlab,azureAd,auth0,okta,cognito,oneLogin,oidc}ClientId | optional min(1) string ×9 | plain config (client IDs are not secret) |
| {google,github,gitlab,azureAd,auth0,okta,cognito,oneLogin,oidc}ClientSecret | optional min(1) string ×9 | **secret-shaped, declared as config** |
| azureAdTenantId, auth0Issuer, oktaIssuer, cognitoIssuer, oneLoginIssuer, oidcIssuer | optional min(1) string | plain config |

Supplied by the deleted app config (`slices.sso`): `{ isSaas: config.infrastructure.modelProvider.isSaas, provider: "none", baseUrl: config.browserSession?.baseUrl ?? publicBaseUrl ?? "http://localhost" }` — **every one of the 20+ OAuth-provider fields above is entirely unfed by the deleted app file.** The literal `provider: "none"` hard-codes SSO off in this composition; no client id/secret ever reaches `create()` through this path in either app file this survey found.

Port difficulty: needs-a-decision
Notes: nine client-secret fields, all secret-shaped, all currently plain config — the largest single reclassification in this inventory. No env spelling exists to carry forward (the deleted files never populated them) — the actual production wiring for a live SSO connection must live somewhere this survey's manifest paths did not cover (likely a runtime, per-org row from the `identity`/organization-settings side, not process boot config at all — `ssoConfigurationSchema`'s own comment calls it "supplied by an application composition root," which may mean per-request/per-org, not per-process). This needs a decision before any port: is this even a boot-time module config at all, or was it misclassified as one?

---

### stored-object

Config leaves:
| field | env spelling | schema | default | source |
| backend | STORED_OBJECTS_BACKEND | z.enum(["s3","azure"]).optional() | — | contract |
| localFilesystemRoot | LANGWATCH_LOCAL_STORAGE_PATH | z.string().optional() | — | contract |
| azureSpoolRetentionConfirmed | AZURE_BLOB_SPOOL_RETENTION_CONFIRMED | "1 or true, else off" | — | contract |
| s3.bucket | S3_BUCKET_NAME | z.string().optional() | — | contract |
| s3.endpoint | S3_ENDPOINT | z.string().optional() | — | contract |
| s3.region | S3_REGION | z.string().optional() | — | contract |
| azure.authMode | AZURE_BLOB_AUTH_MODE | z.string().optional() | — | contract |
| azure.accountName | AZURE_BLOB_ACCOUNT_NAME | z.string().optional() | — | contract |
| azure.container | AZURE_BLOB_CONTAINER | z.string().optional() | — | contract |
| azure.endpoint | AZURE_BLOB_ENDPOINT | z.string().optional() | — | contract |
| azure.authorityHost | AZURE_BLOB_AUTHORITY_HOST | z.string().optional() | — | contract |
| azure.tokenAudience | AZURE_BLOB_TOKEN_AUDIENCE | z.string().optional() | — | contract |
| azure.allowInsecureTokenEndpointForTests | AZURE_BLOB_ALLOW_INSECURE_TOKEN_ENDPOINT_FOR_TESTS | z.string().optional() | — | contract |
| azure.identity.tenantId | AZURE_TENANT_ID | z.string().optional() | — | contract |
| azure.identity.clientId | AZURE_CLIENT_ID | z.string().optional() | — | contract |
| azure.identity.federatedTokenFile | AZURE_FEDERATED_TOKEN_FILE | z.string().optional() | — | contract |

Secrets found via `members.secrets.find(...)` in `stored-object-composition.build.ts`:
| handle | id | optional | consumed by |
| accessKeyId | S3_ACCESS_KEY_ID | — | S3 client |
| secretAccessKey | S3_SECRET_ACCESS_KEY | — | S3 client |
| sessionToken | S3_SESSION_TOKEN | — | S3 client |
| accountKey | AZURE_BLOB_ACCOUNT_KEY | — | Azure blob client |

Supplied by the deleted app config (`slices["stored-object"]`): passthrough of every contract leaf plus `routes: Object.fromEntries(config.infrastructure.storedObjects.routes)` — a per-organization S3-account directory (its own `endpoint`/`bucket`/`accessKeyId`/`secretAccessKey` per org, all four secret-shaped for the credential pair).

Port difficulty: needs-a-decision
Notes: `routes`' per-organization `accessKeyId`/`secretAccessKey` pairs are a directory of SECRETS keyed dynamically by org id — the same "dynamic key set" shape as `feature-flag`'s per-flag env vars and `managed-provider`'s per-org Bedrock directory. `Secret.load` takes one static id; a directory of runtime-determined secrets needs a different primitive or an explicit ruling that these are NOT process-boot secrets (they read like per-tenant data, not deployment facts).

---

### suite

Config leaves: none in contract.

Secrets: none.

Supplied by the deleted app config (`slices.suite`): `{ publicBaseUrl }` — shared `BASE_HOST` fact only.

Process half's own inline `configSchema = z.object({ publicBaseUrl: z.string().optional() }).default({})`.

Port difficulty: mechanical

---

### topic

No config or secrets found anywhere in the module. Not in either deleted app's `slices` map.

Port difficulty: mechanical
Notes: declares nothing; nothing to port.

---

### trace

Config leaves:
| field | env spelling | schema | default | source |
| spanProcessingShards | TRACE_SPAN_PROCESSING_SHARDS | z.string().optional() | — | contract |
| tokenizer.bpeDirectory | TIKTOKENS_PATH | z.string().optional() | — | contract |
| tokenizer.fetchTimeoutMs | TIKTOKEN_FETCH_TIMEOUT_MS | string/number union, optional | — | contract |

Secrets: none.

Supplied by the deleted app config (`slices.trace`): `{ processName: config.serviceName, publicBaseUrl }` — a process fact and the shared `BASE_HOST` fact; the contract's own three leaves above are never referenced in the `slices.trace` literal this survey found.

Process half's own `traceAppConfigSchema` (shown in full above) adds `fallbackVisibilityDays` (default 14, "since both processes must read the same number and a core module may not import the licensing contract") and `registersProcessingPipeline` — neither traceable to any deleted-app field found by this survey.

Port difficulty: needs-a-decision
Notes: confirm where `fallbackVisibilityDays`/`registersProcessingPipeline` are actually set today (a licensing-tier-driven default, per the comment) before assuming they're simply unconfigured-and-defaulted.

---

### user

Config leaves: none in contract.

Secrets: none.

Supplied by the deleted app config (`slices.user`): `{ passkeysEnabled: config.browserSession?.passkeysEnabled ?? false, baseUrl: config.browserSession?.publicBaseUrl ?? null }` — both values are `auth`'s own already-parsed fields, reused here under new names.

Process half's own `userAppConfigSchema = z.object({ passkeysEnabled, baseUrl }).default({...})`.

Port difficulty: needs-a-decision
Notes: same shape as `organization`'s reuse of `authz`'s demo-project fields — user needs a value `auth` already owns. Decide: duplicate the leaf (same meaning, permitted) or call through `AuthApi`.

---

### webhook

Config leaves:
| field | env spelling | schema | default | source |
| allowInsecureLocalUrls | WEBHOOKS_UNSAFE_ALLOW_LOCAL_URLS | boolean/"1"/"0"/"" union | false | contract |
| allowAmbientAwsCredentials | WEBHOOKS_UNSAFE_ALLOW_AMBIENT_CREDENTIALS | same union | false | contract |

Secrets: none.

Supplied by the deleted app config: **not in either `slices` map**, and `webhook.app.ts` has no `configSchema` static — the two leaves are consumed directly inside `webhook-endpoint-policy.service.ts` and the prisma/memory repositories, meaning they must be constructed and handed in some other way (an explicit constructor argument from a composition file this survey's manifest paths did not include) rather than through the module's own `create()` config.

Port difficulty: needs-a-decision
Notes: same orphan-wiring pattern as `authz`/`data-privacy`/`governance`/`ops`'s unwired fields. Both leaves are legitimate deployment facts (unsafe-mode switches) that are simple to port mechanically ONCE the wiring question is answered.

---

### workflow

Config leaves:
| field | env spelling | schema | default | source |
| nlpLambdaFleet | LANGWATCH_NLP_LAMBDA_CONFIG | JSON → `NlpLambdaFleetFields` | — | contract |
| codeBlockTimeoutSeconds | NLPGO_ENGINE_CODE_BLOCK_TIMEOUT_SECONDS | z.string().optional() | — | contract |
| stagingThresholdBytes | LANGEVALS_STAGING_THRESHOLD_BYTES | z.string().optional() | — | contract |
| stagingTtlSeconds | LANGEVALS_STAGING_TTL_SECONDS | z.string().optional() | — | contract |

Secrets: none (the Lambda fleet's own `AWS_ACCESS_KEY_ID`/`AWS_SECRET_ACCESS_KEY` are INSIDE the JSON blob `nlpLambdaFleet` parses — see note).

Supplied by the deleted app config (`slices.workflow`): `{ nlpServiceUrl: config.infrastructure.execution.nlpServiceUrl }` — a DIFFERENT field from any of the contract's own four leaves; `nlpLambdaFleet`/`codeBlockTimeoutSeconds`/staging fields are never referenced in this slice.

Process half's own `workflowAppConfigSchema = z.object({ nlpServiceUrl: z.string().optional() })` — matches the slice, not the contract. The contract's four leaves are used elsewhere in the deleted file (`resolveNlpLambdaFleetConfig`, called with `value.workflow` at the TOP-LEVEL `ApiConfig`, feeding a separate `nlpLambdaFleet`/`nlpLambdaFleetNamed` pair on `ProcessConfig`, not on the module's own slice).

Port difficulty: needs-a-decision
Notes: (1) the JSON blob's `AWS_ACCESS_KEY_ID`/`AWS_SECRET_ACCESS_KEY` fields are secret-shaped values nested inside a single config leaf — `Secret.load` has no way to model "a secret inside a parsed JSON config value" as it stands. (2) `nlpServiceUrl` here is workflow's OWN NLP address, separate from `model-provider`'s `LANGWATCH_NLP_SERVICE`/`execution.nlpServiceUrl` used to build `executionProxyBaseUrl` above — confirm these really are two different addresses (studio Lambda vs. inference proxy) before merging them as a "shared fact."

---

## Collisions and shared facts

### Config-claims-secret collisions (boot-refusing under the new wall)

- **`CREDENTIALS_SECRET`** (the manifest's named collision, confirmed): read as a raw secret handle by `github.app.ts` (`signingKey`), used as the fallback source for `secret`'s stored-object cipher key (`storedSecretEncryptionKey`, via `STORED_SECRET_ENCRYPTION_KEY_ENV_PRECEDENCE = ["CREDENTIALS_SECRET", "NEXTAUTH_SECRET"]`), AND as the second fallback for `api-key`'s pepper (`API_KEY_PEPPER_ENV_PRECEDENCE = ["CREDENTIALS_SECRET", "NEXTAUTH_SECRET"]`, itself applied after `CREDENTIALS_SECRET`'s own fallback). Three different semantic purposes (GitHub App signing, stored-secret cipher key, API-key pepper) resolve from the same raw material through a layered fallback chain — `Secret.load(id)` has no fallback-chain primitive, so this cannot be a mechanical three-way rename. **Needs a decision**: either the fallback chain gets a new primitive, or each purpose gets its own env var and a migration note for deployments still relying on the shared default.

### Env spellings read by two-or-more modules with the SAME meaning (shared-leaf candidates per §6 layer 3)

- **`BASE_HOST`** (via `deploymentPublicBaseUrl`/`publicBaseUrl`): read identically by `agent`, `analytics`, `dashboard`, `hosted-mcp`, `organization`, `prompt`, `suite`, `dataset`, `evaluator`, `scenario`, `trace`, `automation`, `platform-health` (already correctly imports the canonical leaf), and indirectly `sso`'s `baseUrl` fallback. This is the architecture record's own worked example — every other module here should follow `platform-health`'s pattern (import `deploymentPublicBaseUrl`, do not re-declare).
- **`IS_SAAS`**: read identically (`saasServerConfigDefinition.isSaas`) by `auth`, `entitlement`, `model-provider`, and `sso`. Declared today only in the **`saas` module's contract, which is not in the installed 49-module list** — the shared fact's canonical home is currently an uninstalled module. Needs to become a real `@langwatch/config` `deployment-facts.ts` leaf per the architecture record, not stay module-owned.
- **`ADMIN_EMAILS`**: read identically (same split/trim/filter transform) by `identity` and `ops`, both sourced from `saasServerConfigDefinition.adminEmails` — same uninstalled-module-ownership problem as `IS_SAAS`.
- **`DEMO_PROJECT_ID`/`DEMO_PROJECT_USER_ID`**: declared by `authz`'s contract, reused verbatim by `organization`'s slice. Not a raw env collision (organization never reads the env var itself) but the same value crosses a module boundary as a plain field rather than an `AuthzApi` call — flag for the architecture question, not the boot-refusal one.

### Values that are store connections, not module config (§6 layer 1 — a module declaring one is a finding)

- **`CLICKHOUSE_OPS_URL`**, declared on `ops`'s own contract (`clickhouseOpsUrl`) — a third ClickHouse identity, alongside the main `CLICKHOUSE_URL` and the `LWQL_CLICKHOUSE_URL` analytics identity. All three are connection strings and belong on the process's stores config, not a module schema.
- `LWQL_CLICKHOUSE_URL`/`_USER`/`_PASSWORD`/`_DATABASE` on `analytics` are the SAME class of finding — a full second ClickHouse connection identity declared at module level.

### Secret-shaped values currently declared as plain config (reclassify, not rename)

`analytics.langwatchQl.password` (LWQL_CLICKHOUSE_PASSWORD) · `ops.apiKey` (LANGWATCH_OPS_API_KEY) · `ops.metricsApiKey` (METRICS_API_KEY) · `scim.auth0WebhookSecret` (AUTH0_SCIM_WEBHOOK_SECRET) · `governance.ingestionSecretPepper` and `governance.ottl.secret` · `auth.passkeyHandleSecret` (PASSKEY_HANDLE_SECRET) and the nested `browserSessionIdentitySchema.secret` · every one of `sso`'s nine `*ClientSecret` fields plus `instanceLicenseKey`.

### Dynamic / non-static env-name sets (no single `Config.env(NAME, schema)` leaf fits)

`feature-flag`'s per-registered-flag override variables, `evaluation`'s per-evaluator-plugin `envVars`, `stored-object.routes`'s per-organization S3 credential directory, and `managed-provider.bedrock`'s per-organization directory (confirm whether its per-org fields are secret-shaped too) all need an explicit ruling on how a registry- or tenant-keyed set of names is declared under the new primitives.

### Modules with a contract config schema the process half never wires into `create()` (orphaned, found by this survey)

`authz`, `data-privacy`, `evaluation`'s dynamic resolver, `governance`, `webhook`, and several of `ops`'s own leaves (`usageStats`, `productAnalytics`, `collectClickHouseBackupMetrics`). Each needs its actual production wiring path confirmed before a lane can port it — it may be composed some other way this survey's manifest paths did not reach, or it may be genuinely dead.
