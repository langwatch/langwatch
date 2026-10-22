# ADR-186: Services authenticate with short-lived tokens, and every call names whose behalf it acts on

**Date:** 2026-10-23

**Status:** Proposed

**Builds on:** ADR-045 (handled errors), ADR-092 (the authorization engine, §12 passports), ADR-115 (identity packages), the run keys in `modules/api-key` (`RUN_KEY_LIFETIME_MS`).

**Spec:** [`specs/security/service-identity.feature`](../../../specs/security/service-identity.feature)

> One line: the app becomes the only token issuer. It signs short-lived, asymmetric, kid-rotated tokens and publishes their public keys on an internal JWKS endpoint. Every call from the app to another service carries a **delegation token** that names the person, key or system actor behind the call. A service that calls the app first proves who it is (a Kubernetes projected token, or a per-service bootstrap secret where there is no cluster) and exchanges that proof for a **service token**. Receivers verify one token format against one JWKS. The shared static secrets go away hop by hop, behind a dual-accept window that metrics close.

## Context

### What we want

1. A service proves **which service** it is with a credential that expires in minutes, not with a value that lives until someone rotates it by hand.
2. Each call says **on whose behalf** it acts: the user, the API key, or the system actor that started the work. Receivers log that chain, so an audit line reads "nlpgo, called by the app, acting for user U in project P".
3. No hop forwards a customer's long-lived credential. A forwarded key spreads the credential to every service that sees it.

### Inventory: every service-to-service hop today

Paths are at `origin/main` as of this ADR. "Context" means user, API key or project identity that crosses the hop.

| # | Hop | Credential minted / attached | Credential checked | Mechanism | Lifetime | Context that crosses | Rotation |
|---|---|---|---|---|---|---|---|
| 1 | app → nlpgo (HTTP, `LANGWATCH_NLP_SERVICE`) | `packages/process/src/nlp-internal-secret.ts:21` (`nlpInternalSecretHeaders`), used at `modules/workflow/process/src/channels/http/http.workflow-nlp-runtime.channel.ts:184`, `http.workflow-studio-stream.channel.ts:44`, `aws.lambda-workflow-studio-stream.channel.ts:64`, `modules/model-provider/process/src/services/model-provider-playground.service.ts:72`, `modules/model-provider/process/src/rules/execution-handle.rules.ts:22` | `services/nlpgo/adapters/httpapi/internal_auth.go:36`, mounted at `router.go:86` | Static shared value in `X-LangWatch-NLP-Secret` (`LANGWATCH_NLP_INTERNAL_SECRET`), constant-time compare. **Unset means no check**: the middleware is a pass-through (`internal_auth.go:37`) | Until rotated | Project id in the body (`project_id`), plus a run key (row 3) and the project's decrypted secrets (`studio-workflow-event-enricher.service.ts:110-134`). The engine never authenticates the project the body names | One env var on both ends, restart, no overlap |
| 1b | app → nlpgo playground proxy `/go/proxy/v1/*` | same helper | same middleware | as row 1. `Authorization` belongs to the OpenAI-compatible client here, so the credential cannot use it (`nlp-internal-secret.ts:1-6`) | as row 1 | Decrypted provider credentials in headers | as row 1 |
| 2 | app → NLP Lambda (managed deployments) | `modules/workflow/process/src/channels/http/http.workflow.channels.ts:75-89`, `aws.nlp-lambda-invoke.channel.ts:54` | AWS IAM | SigV4 with static IAM access keys read from `LANGWATCH_NLP_LAMBDA_CONFIG` | As long as the IAM key | Same body as row 1 | Deployment-side key rotation, app restart |
| 3 | nlpgo → app callbacks (`batch/log_results`, evaluator, agent workflow) and per-tenant OTLP | `services/nlpgo/app/engine/evaluation.go:83`, `pkg/otelsetup/tenant_router.go:128` (`X-Auth-Token: <workflow.api_key>`) | app API-key resolution (`modules/api-key`) | **Run key**: an API key minted per run by `RunKeyMintService` (`modules/api-key/process/src/services/run-key-mint.service.ts`), scoped to the run's permissions, parented to the caller's key, carrying the starter's user id or `system:unattended-run` | 15 min default, at most 60 min (`modules/api-key/contract/src/api-key.run-key.ts`) | Yes: project, starter user, parent key | Fresh per run |
| 4 | gateway → control plane `/api/internal/gateway/*` | `services/aigateway/adapters/controlplane/signer.go:59-88` | `modules/gateway/process/src/services/gateway-internal-identity.service.ts:83,105` | HMAC-SHA256 with `LW_GATEWAY_INTERNAL_SECRET` over `METHOD\nPATH\nTS\nsha256(body)`. Query string and `X-LangWatch-Gateway-Node` are outside the signed form; no nonce | Each signature ±300 s; the key until rotated | The virtual key the customer presented travels in the resolve-key body | One env var on both ends, restart, no overlap |
| 5 | app → gateway `/internal/*` (OTTL validate / transform) | `enterprise/modules/governance/process/src/channels/http/http.ottl-transform.channel.ts` | `services/aigateway/adapters/httpapi/internal_middleware.go:25,163` | Same HMAC, **same secret as row 4**, opposite direction | ±300 s | Project id in the body | as row 4 |
| 6 | control plane → gateway: resolved-key token | `modules/gateway/process/src/services/gateway-jwt.service.ts:11,57-73` | `pkg/jwtverify/verifier.go:67` via `services/aigateway/deps.go` | JWT, HS256, shared `LW_GATEWAY_JWT_SECRET`; the verifier accepts any HMAC alg | 15 min or the key's own expiry | Yes: `vk_id`, `project_id`, `team_id`, `org_id`, `principal_id`, `revision` | Verifier reads `LW_GATEWAY_JWT_SECRET_PREVIOUS` (`services/aigateway/config.go:114`); the signer has one key |
| 7 | app/workers → langyagent `/worker/*` | `modules/langy/process/src/channels/http/http.langy-worker.channel.ts:39` | `services/langyagent/transport/rpc/http.go:115` | Static bearer `LANGY_INTERNAL_SECRET`, constant-time compare | Until rotated | Body: project, acting user, conversation, plus a 6 h Langy session key (`langy-session-key.service.ts:52`), a virtual key, a GitHub installation token | One env var, restart, no overlap |
| 8 | langyagent → app `/api/internal/langy/*` (turn result, revoke, relay) | `services/langyagent/adapters/controlplane/{finalizer,revoker,relay}.go` | `modules/langy/process/src/app/langy.app.ts:302` (`BearerIdentity "langy-internal"`) | **Same static bearer as row 7**, opposite direction | Until rotated | Project and conversation ids taken from the body (`langy-internal.service.ts:41`) | as row 7 |
| 8b | langyagent → app relay frames | `services/langyagent/internal/frameauth/frameauth.go` | `modules/langy/process/src/rules/langy-frame-auth.rules.ts:74` | HMAC-SHA256 per frame, keyed by a per-conversation run token, nonce checked | Per conversation | project, user, conversation, turn | Fresh per conversation |
| 9 | app → langevals (HTTP, `LANGEVALS_ENDPOINT`) | `modules/evaluation/process/src/channels/http/http.langevals.channel.ts:66,99` | `services/langevals/langevals/server.py` | **None at the application level**; network placement only | — | Project id for payload staging; evaluator provider keys in the body | — |
| 9b | app → evaluator Lambdas behind a private API Gateway (managed deployments) | same channel, `LANGEVALS_ENDPOINT` points at the API | API Gateway, then Lambda | Network placement (private endpoint); no IAM authorizer | — | as row 9 | — |
| 10 | scenario child process → app | `modules/scenario/process/src/channels/scenario-child.node.channel.ts:247` (`LANGWATCH_API_KEY`) | app API-key resolution | Run key (as row 3) | 15–60 min | Yes | Per run |
| 11 | workers → app | none: workers share the process code and reach Postgres, ClickHouse and Redis directly | — | — | — | — | — |
| 12 | operator surfaces: platform health, ops EXPLAIN, cron | `modules/platform-health/process/src/app/platform-health.app.ts:60-61` (`PLATFORM_HEALTH_API_KEY`), `modules/ops/process/src/app/ops.app.ts:1604` | `packages/api/src/rest/bearer-identity.ts:22` | Static bearer through `BearerIdentity` | Until rotated | None | env var, restart |
| 13 | internal tools in the deployment repo (customer-pulse, nexus) | per-service `random_password` agent tokens | each tool's own bearer check | Static bearer | Until rotated | None (shared agent identity), or a personal key | Manual |
| 14 | app → Postgres / ClickHouse / Redis (**out of scope**) | `DATABASE_URL`, `CLICKHOUSE_URL`, `REDIS_URL` | the datastore | Password in the URL | Until rotated | — | — |

What the table says:

- **No hop identifies the calling service** except by holding a shared value. Rows 4–5 and 7–8 use one value in both directions, so either side can act as the other.
- **The weakest hop is row 1.** The engine runs user-authored Python for whichever project the body names, and its guard is off when the variable is unset.
- **On-behalf-of already exists on the callback leg.** Run keys (rows 3, 10) and Langy session keys (row 7) are short-lived, scoped, parented credentials that carry the starter. The **outbound** leg is the gap: nlpgo, langevals, langyagent and the gateway's internal surface learn the project and user from the body, unsigned.
- **There is no JWKS and no asymmetric service signing anywhere** in the app. The one HS256 JWT (row 6) is the precedent ADR-092 §12 cites for its L2 passports.
- Helm pods decline the default service-account mount (`specs/security/helm-strict-admission.feature`). A projected `serviceAccountToken` volume with an explicit audience is still possible; `charts/langwatch/templates/app/old-writers-gone-hook.yaml` already uses one.

## Options

### Who verifies what

- **A. Each receiver verifies Kubernetes projected tokens against the cluster's issuer.** The recommended starting point. It works on EKS, but every receiver (Go, Python, TS) needs the cluster's JWKS, docker compose and `pnpm dev` have no cluster, Lambdas have no projected token, and the user's identity still needs a second token. So two formats and two trust anchors, at every receiver.
- **B. The app is the only issuer (chosen).** Workload proof (projected token, bootstrap secret) is shown **only** to the app's token endpoint, which exchanges it for an app-signed service token. Outbound app calls need no exchange at all: a token the app signed already proves the app made the call. Every receiver checks one format against one JWKS, the same on EKS, a self-hosted cluster, compose and haven.
- **C. mTLS through a mesh or SPIFFE.** Strong workload identity, but no on-behalf-of, a new control plane for every self-hosted install, and nothing for Lambdas.
- **D. Keep shared secrets, add rotation overlap.** Cheapest. Fixes rotation outages; does not identify the service, does not carry the principal, and leaves one value in both directions.

### Where the signing keys live

- **K1. Generated by the app, sealed in Postgres with `CREDENTIALS_SECRET`, rotated by a scheduled job (chosen).** No new env var, the same on every install, and all replicas read the same key set.
- **K2. A PEM in an env var or mounted secret.** Rotation is manual again, which is what we are removing.
- **K3. A cloud KMS asymmetric key.** Managed deployments only, and a network round trip per signature.

### How long a token lives

- **L1. 120 s for every token; a holder that needs longer re-exchanges (chosen).** A long run's holder trades its expiring delegation token plus its own service token for a fresh one, up to the run's bound.
- **L2. One token for the whole run (up to 60 min).** Simpler, but a leaked token is useful for an hour.

## Decision

1. **D1. The app is the sole issuer (option B).** Its issuer id is `langwatch-app` plus the install's base URL. No receiver trusts a cluster issuer directly.
2. **D2. Workload proof, per platform.** Kubernetes: a projected `serviceAccountToken` with audience `langwatch-app` and a 10 min expiry, mounted at a fixed path, checked by the app's token endpoint with a `TokenReview` (default) or the cluster's JWKS (operator option). Docker compose, haven and `pnpm dev`: one bootstrap secret **per service** (`LANGWATCH_SERVICE_BOOTSTRAP_SECRET_<SERVICE>`), generated by the compose bootstrap and haven, used only against the token endpoint, never on a data call. Lambdas never call the app with workload proof; the app invokes them (D12).
3. **D3. Two token types, one format.** JWT, **ES256**, `kid` in the header, `typ` `delegation+jwt` or `service+jwt`.
   - **Delegation token** (minted by the app on each outbound call or run): `iss`, `aud` (one target service), `sub` (`user:<id>`, `apikey:<id>` (the key's id, never the key), or a `SYSTEM_ACTORS` name), `act` (`{ "sub": "service:langwatch-app" }`, nested one level per hop), `org`, `project`, `scope` (permission names from the ADR-092 vocabulary, the ceiling of what the receiver may do for the principal), `jti`, `iat`, `nbf`, `exp`. RFC 8693 shape.
   - **Service token** (returned by the exchange): `sub` `service:<name>`, `aud` the target, no principal claims. A service that calls for a principal sends both, and the app checks that the delegation token's innermost `act.sub` is the service the service token names.
4. **D4. Lifetime is 120 s, re-exchanged for longer work (L1).** Clock leeway is 30 s on `nbf` and `exp`. A re-exchange cannot widen `scope`, change `sub`, or outlive the run bound the first token recorded (`run_exp`).
5. **D5. Run keys and Langy session keys stay for now.** They already carry the principal on the callback leg and are revocable. This ADR covers the outbound leg and service identity. Folding run keys into delegation tokens is a follow-up ADR, decided once the audit data from D13 exists.
6. **D6. Signing keys follow K1.** A new key is published on the JWKS 24 h before it signs, signs for 30 days, and stays published for the longest token lifetime plus leeway after it stops. The JWKS is served at `/api/internal/service-identity/jwks`, behind the existing internal-path ingress block; receivers fetch it from the app's internal address and cache it.
7. **D7. One header on every hop: `X-LangWatch-Service-Token`** (and `X-LangWatch-Delegation-Token` when a principal rides). Not `Authorization`: the engine's proxy routes and the gateway hand that header to customer clients, and run keys and virtual keys already use it.
8. **D8. Receivers bind the body to the token.** A request whose body names a project other than the delegation token's `project` is refused. This removes the "the body names the project" trust on rows 1, 5, 8 and 9.
9. **D9. Failures, per ADR-045.** The caller of every one of these is one of our services, which can act on all but the last. Each code gets a presentation-registry entry for the rare case it reaches a customer inside a run error.

   | Failure | Code | HTTP | Fault | What the caller does |
   |---|---|---|---|---|
   | token past `exp` (with leeway) | `service_token_expired` | 401 | platform | re-mint or re-exchange once, then retry |
   | `aud` is not this service | `service_token_wrong_audience` | 401 | platform | none at runtime; the operator fixes the target's configured audience |
   | `kid` absent from the JWKS after one refetch | `service_token_unknown_key` | 401 | platform | retry after a short delay; a new key is still propagating |
   | body project ≠ token project | `delegation_project_mismatch` | 403 | platform | none; it is a caller bug |
   | action outside `scope` | `delegation_scope_exceeded` | 403 | platform | none; the principal lacks the permission |
   | `act` chain deeper than 4 | `delegation_chain_too_deep` | 403 | platform | none |
   | token absent where the hop requires one | `service_token_required` | 401 | platform | the operator finishes the rollout step (D11) |
   | JWKS unreachable and nothing cached, signature invalid, malformed token | plain `Error` | 401 / 503 | — | none: it is logged with the trace id and degrades to unknown |

   An unreachable issuer is not a handled error: receivers keep the last JWKS they fetched and serve from it, so only a cold receiver with the app down fails, and that receiver has nothing to do for anyone until the app is back.
10. **D10. Where the code lives.** A TS issuer and verifier in a new `packages/service-identity` (no module imports it except through the api door), a Go verifier in `pkg/serviceidentity` shared by nlpgo, the gateway and langyagent, and a Python verifier in langevals. `packages/api` gains a `ServiceTokenIdentity` beside `BearerIdentity`, returning `internal: { type: "serviceToken", service }` and the principal as `actor`.
11. **D11. Migration is one switch per hop, three values.** Receivers read `LANGWATCH_SERVICE_AUTH_<HOP>=secret|dual|token`; senders always send both once they ship the issuer. Every accepted call increments `langwatch_service_auth_total{hop, path="secret"|"token", result}`. Steps per hop:
    1. Ship issuer and verifier; the receiver is `secret` (default). Senders start attaching tokens; receivers verify and record, but do not refuse.
    2. Receiver set to `dual`: it refuses an invalid token, accepts a valid token or the secret.
    3. When `path="secret"` has been zero for 7 days, set `token`.
    4. Next release: the secret's env var, Helm value and code are deleted.

    Self-hosted installs move one step per minor release, so an upgrade never needs two services changed together.
12. **D12. Lambdas use IAM.** The app's existing workload role (IRSA) invokes the NLP Lambda instead of static IAM keys, and evaluator API Gateway methods require `AWS_IAM`. The delegation token rides in the payload so the Lambda logs the principal and applies D8.
13. **D13. Audit.** Every receiver writes `auth.path`, `auth.service`, `auth.principal`, `auth.act` (the chain, outermost first) and `auth.jti` on its request log line and span. A token's `jti` is not stored; tokens are short enough that a replay store is not worth its cost, except at the exchange endpoint, which refuses a reused workload proof `jti`.
14. **D14. The gateway's resolved-key JWT and ADR-092's L2 passports use this issuer.** Row 6 moves from HS256 to the same ES256 keys, which deletes `LW_GATEWAY_JWT_SECRET`. ADR-092 §12 passports, when stage F lands, are delegation tokens whose `scope` claim carries the permission bitmap, rather than a second HMAC key.
15. **D15. Order of hops** (see Rollout): engine, Langy, gateway, langevals, gateway JWT, Lambdas.

## Rollout

| Step | Hop | Why this order | Repo changes | Deployment changes |
|---|---|---|---|---|
| 0 | issuer, JWKS, exchange endpoint, verifiers | everything else needs them | `packages/service-identity`, `pkg/serviceidentity`, `ServiceTokenIdentity`, key-rotation job, metric | none |
| 1 | **app → nlpgo** (rows 1, 1b) | weakest current guard, highest blast radius (user code for any named project), one sender helper to change, Go receiver reused by later hops, no workload proof needed because the app is the caller | `nlpInternalSecretHeaders` becomes a token-attaching helper; `RequireInternalSecret` gains the `secret/dual/token` switch; D8 check on `project_id` | Helm: `langwatch_nlp` gets `LANGWATCH_SERVICE_AUTH_NLP` and the JWKS URL. Managed deployment: the same two env vars on the engine Deployment and the app; no new secret |
| 2 | langyagent ↔ app (rows 7, 8) | one secret both ways; turn results trust the body | sender on both sides; langyagent exchanges its projected token | Helm `charts/langyagent`: dedicated service account, projected token volume with audience `langwatch-app`; app RBAC for `TokenReview`. Managed deployment: the same, in its langy-agent Terraform |
| 3 | gateway ↔ control plane (rows 4, 5) | HMAC both ways, one secret | gateway exchanges its projected token; control plane verifies | `charts/gateway`: service account plus projected volume (it already disables the automount). Managed deployment: same, and a per-workload service account for the gateway |
| 4 | app → langevals (rows 9, 9b) | no application auth today | Python verifier; D8 on the staging project | Helm: JWKS URL and switch on langevals. Managed deployment: API Gateway methods to `AWS_IAM`, invoke permission on the app's workload role |
| 5 | resolved-key JWT (row 6) | removes a shared signing key | ES256 signer and JWKS verifier in `pkg/jwtverify` | delete `LW_GATEWAY_JWT_SECRET` and its previous value |
| 6 | NLP Lambda (row 2) | static IAM keys | channel uses the default credential chain | drop the IAM user; the app's IRSA role already carries invoke rights |

Operator surfaces (row 12) and internal tools (row 13) are not service-to-service calls with a principal and stay static bearers; datastores (row 14) are out of scope.

## Consequences

- Receivers stop trusting the body for tenant identity, and audit lines name the service chain and the principal.
- The app becomes a dependency of every service-to-app call's credential. Those calls target the app anyway; outbound tokens need no exchange, and receivers cache the JWKS, so an app outage does not stop a receiver from verifying tokens already in flight.
- A long-lived customer credential never crosses a hop that this ADR touches; the run key and Langy session key are already short-lived and stay until the follow-up.
- Every Helm chart that hosts a calling service gains a service account and a projected token volume, and the app gains `TokenReview` RBAC (or a configured cluster JWKS URL).
- Compose and haven generate one bootstrap secret per calling service. That is a static secret again, but only at the exchange, only on one host, and never on a data call.

## Open questions

- Is `TokenReview` acceptable on every self-hosted cluster the chart supports, or should the cluster-JWKS mode be the default?
- Should the engine forward the delegation token into a code block's sandbox? This ADR says no: the sandbox gets nothing new.
