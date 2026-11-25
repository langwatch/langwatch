# Domain map (proposal, 2026-10-01)

Domains are cut by behaviour, not by noun. Source: the 351 edges in
`packages/architecture-enforcer/tests/baselines/peer-cycle-edges.json`, with the
operations each edge calls (`.claude/tmp/domains/scout.py` → `edges.json`).
Today every one of the 49 modules sits in a single strongly connected component.

## The rule

A module calls a peer `*Api` only **down** a layer or **within** its layer, and
never in a cycle. A lower module learns about an upper one's work only through
a peer subscriber (`.withPeerSubscriber`, record §9) or a **supplied source**
(the lower module declares a token, the upper one supplies it; the exemplar is
licensing's `licensing-entitlement-source.service.ts`).

## Layers (bottom first)

| #   | Layer            | Modules                                                                                                                                           | What it does                                |
| --- | ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------- |
| 1   | Tenancy          | user, auth, identity, scim, sso, organization, role, authz, project, api-key, share, data-privacy, audit-log                                      | who, where, may they                        |
| 2   | Commercial       | entitlement, usage (new), billing, licensing, saas                                                                                                | what the tenant has paid for and used       |
| 3   | Platform edge    | model-provider, secret, gateway, enterprise-gateway, managed-provider, webhook, github, feature-flag, stored-object, hosted-mcp                   | the outside world                           |
| 4   | Data             | trace (+log), topic, annotation, analytics, metric, dashboard, data-retention                                                                     | ingest and read telemetry                   |
| 5   | Build & evaluate | workflow → agent, prompt, dataset, evaluator → evaluation → monitor, experiment, automation, instant-eval, scenario (+suite), langy, coding-agent | build agents and judge them                 |
| 6   | Growth & ops     | nurturing, onboarding, notification, digest, demo-data, sample-agents, ops, governance, platform-health, presence, rum                            | react to, and look across, everything below |

Arrows in layer 5 give the order inside the layer.

## Behaviours that cause the cycles

These six behaviours explain most of the 43 two-way pairs. Fix the behaviour
once and many edges go.

| Behaviour                                                                                                        | Where it is today                                                                          | Cut                                                                                                           |
| ---------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------- |
| **Usage counting** (`countUsage` is called from about 15 modules; ops→user ×25)                                  | Every owner answers `countUsage`, and consoles fan in                                      | A `usage` module projects counts from owner events. Consoles and entitlement read `usage`.                    |
| **Archive/copy cascade** (`archive`, `copy`, `cascadeArchive`, `syncFromSource`)                                 | workflow ⇄ agent, evaluator, monitor, experiment; scenario ⇄ suite                         | The owner emits archived/copied events; dependents react with peer subscribers                                |
| **Personal workspace provisioning** (`ensurePersonalWorkspace`, called from auth, user, org, governance)         | Called on demand from four places                                                          | One process manager in organization, reacting to the user-created event. Readers use `getPersonalWorkspace`.  |
| **Membership lifecycle** (`approve`, `reject`, `withdraw`, `createMembership`, `applyPendingInvite`, `isMember`) | Split across identity and organization                                                     | Moves wholly into organization; identity keeps people, accounts and SSO links                                 |
| **Browser sessions** (`listBrowserSessions`, `revokeAll…`)                                                       | user ⇄ auth, and org, ops and governance call through user                                 | Auth owns sessions. User emits deactivated; auth subscribes and revokes. Consoles call auth.                  |
| **Ingest enrichment and reactions**                                                                              | trace calls up into coding-agent, instant-eval, evaluation, automation, topic and scenario | Enrichment becomes a supplied "span contributor" source. Reactions become peer subscribers on trace's events. |

## Cut per two-way pair

Kinds:

- **EV**: event plus peer subscriber in the upper module.
- **SRC**: the lower module declares a source; the upper one supplies it.
- **MOVE**: the behaviour moves to another module.
- **COMPOSE**: the read moves to the UI, or to the reader.
- **MERGE**: the two modules become one.
- **CHECK**: the scout matched on a name only; verify first.

Counts are name matches, so `getById`, `archive` and `copy` are noisy.

| Pair (kept direction first)                                                                 | Back edge dropped                                                                                                              | Kind                                                          | Lane  |
| ------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------- | ----- |
| auth → user                                                                                 | user → auth (sessions ×3 each)                                                                                                 | EV (user.deactivated) + MOVE (sessions to auth)               | dd-09 |
| auth → identity                                                                             | identity → auth (`offersTwoStepVerification`, `linkProviderAccount`)                                                           | **RULING**: see question 1                                    | dd-09 |
| organization → identity                                                                     | identity → organization (`isMember`, `createMembership`, `applyPendingInvite`)                                                 | MOVE (membership into organization)                           | dd-09 |
| scim → identity                                                                             | identity → scim (`getUser`, `moveToConnection`)                                                                                | EV                                                            | dd-09 |
| organization → user                                                                         | user → organization (`ensurePersonalWorkspace`)                                                                                | MOVE (process manager in organization)                        | dd-09 |
| project → organization                                                                      | organization → project (`updateSettings`, `listByOrganization`)                                                                | COMPOSE (org pages read project) + EV                         | dd-10 |
| role → authz; organization → role                                                           | role → organization (`getOrganizationIdByTeamId`)                                                                              | SRC, or pass the org id in the command                        | dd-10 |
| api-key → organization, api-key → project                                                   | organization → api-key (`revoke`); project → api-key (`regenerateLegacyProjectKey`)                                            | EV (api-key subscribes to member-removed and project-created) | dd-10 |
| share → project                                                                             | project → share (`revokeAllTraceShares`)                                                                                       | EV                                                            | dd-10 |
| data-privacy → project                                                                      | project → data-privacy (`get/setPiiRedactionLevel`)                                                                            | COMPOSE                                                       | dd-10 |
| langy → project                                                                             | project → langy (`provisionVirtualKey`)                                                                                        | EV                                                            | dd-10 |
| agent → audit-log                                                                           | audit-log → agent (`findIdsCreatedInWindow`, `getNamesByIds`)                                                                  | COMPOSE (the writer stores the name at write time)            | dd-10 |
| billing → organization                                                                      | organization → billing (`notifyResourceLimitReached`)                                                                          | EV                                                            | dd-11 |
| entitlement → organization                                                                  | organization → entitlement (`getActivePlan`, `requestBound`)                                                                   | SRC (a bounds source supplied by entitlement)                 | dd-11 |
| trace → entitlement                                                                         | entitlement → trace (`countTracesByProjects`)                                                                                  | MOVE to usage                                                 | dd-11 |
| ops → user                                                                                  | user → ops (`isAdmin`)                                                                                                         | MOVE (platform admin into user or authz)                      | dd-11 |
| instant-eval → licensing                                                                    | licensing → instant-eval (`classify`, `priceOf`, `recordSpendForHostedCalls`)                                                  | EV (spend events) + **RULING** on who owns pricing            | dd-11 |
| agent, evaluator, experiment, monitor → workflow                                            | workflow → them (cascade)                                                                                                      | EV                                                            | dd-12 |
| scenario → agent                                                                            | agent → scenario (cascade, `count`)                                                                                            | EV + usage                                                    | dd-12 |
| experiment → dataset                                                                        | dataset → experiment (`getBySlugOrId` ×19)                                                                                     | CHECK, then COMPOSE                                           | dd-12 |
| monitor → evaluator                                                                         | evaluator → monitor                                                                                                            | EV (cascade)                                                  | dd-12 |
| automation → trace, evaluation → trace, topic → trace, annotation → trace, scenario → trace | trace → them (`handleTraceTriggerMatch`, `queueTraceEvaluation`, `bootstrapClustering`, `listScoreNames`, `computeRunMetrics`) | EV for reactions, COMPOSE for reads                           | dd-13 |
| coding-agent → trace, instant-eval → trace                                                  | trace → them (`contributeReceivedSpan`, `shouldFilterSpan`, `classify`)                                                        | SRC (span contributors)                                       | dd-13 |
| trace ⇄ log                                                                                 | both directions                                                                                                                | MERGE log into trace (one ingest)                             | dd-13 |
| monitor, experiment, automation → evaluation                                                | evaluation → them (`recordTargetResult`, `handleEvaluation…`, `findBySlug`)                                                    | EV; the caller passes config in the command                   | dd-13 |
| coding-agent → github                                                                       | github → coding-agent (`backfillPullRequestMappings`, `countUsage`)                                                            | EV + usage                                                    | dd-13 |
| scenario ⇄ suite                                                                            | both directions                                                                                                                | MERGE suite into scenario                                     | dd-14 |
| governance → organization, user, scim                                                       | organization, user and scim → governance                                                                                       | EV (governance subscribes); COMPOSE for personal usage        | dd-04 |
| project → audit-log                                                                         | wiring only                                                                                                                    | Drop the unused dependency                                    | dd-10 |

## Questions for Alex

1. auth, identity and user are three slices of "account". Should they merge into
   one `account` module (people, credentials, sessions, SSO links), or keep three
   with the order user ← auth ← identity?
2. Should the `usage` module be built now as the counting projection (it
   unblocks entitlement ↔ trace and about 15 `countUsage` fan-ins)?
3. Hosted-call pricing (`priceOf`, `classify`): does it belong to instant-eval,
   licensing, or managed-provider?
4. Merges: suite into scenario and log into trace now; monitor into evaluation
   later, once dd-12 and dd-13 are collected?
5. Every EV and SRC row adds an event type or a token. Approve this table as one
   batch, instead of approving each new operation separately?
