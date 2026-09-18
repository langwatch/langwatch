# Design C implementation — issue langwatch-saas#1168 / PR langwatch#7331

Owner (Drew) signed off 2026-09-01. Principle: whoever owns the ClickHouse server owns the access model. Chart-managed + SaaS → XML rendered config; external/BYO ClickHouse → app SQL self-provisioning as fallback only.

## Read first (evidence base)
- /tmp/q6-redesign.md (Design C definition and sequence)
- /tmp/q8-dual-directory.md (measured dual-directory behavior; binding constraints)
- /tmp/q5-xml-pattern.md (named-collection XML mechanics, catches A/B)
- Issue Q&A: https://github.com/langwatch/langwatch-saas/issues/1168#issuecomment-5492562128
- Issue body now carries Documentation ACs AC7–AC11.

## Worktrees
- This worktree: /home/ubuntu/worktrees/langwatch/issue1168-design-c, branch `issue1168/design-c-implementation` off `origin/issue6635/lwql-helm-enablement` @ 28f563af55.
- SaaS terraform: /home/ubuntu/worktrees/langwatch-saas/issue1168-design-c, branch `issue1168/design-c-saas` off `origin/main` @ 40c6a4fa8.

## Work items (in order)
1. Port ~120 lines of LWQL XML rendering from langwatch-saas `infrastructure/clickhouse-serverless/scripts/render-config.sh:210-335` into `charts/clickhouse-serverless` (user `langwatch_lwql`, profile `lwql_restricted`, grants, row filters, `<named_collections>` block for `lwql_postgres`, `named_collection_control`).
2. Mount the two LWQL passwords into the ClickHouse pod as k8s secrets (pattern: `modules/clickhouse/statefulset.tf:359-372` uses `CLICKHOUSE_LWQL_PASSWORD_FILE`).
3. Flip `charts/langwatch/templates/_helpers.tpl:1256` (`langwatch.lwql.selfProvisionActive`): self-provision ONLY when ClickHouse is NOT chart-managed. Must be genuinely mutually exclusive with XML rendering, not merely default-off (Q8 binding constraint).
4. Delete `infra/clickhouse-serverless/internal/render/access.go` `renderUserDirectories` + `renderNamedCollectionsStorage` (:73-111) and the gate in `render.go:70-80`. `replace="replace"` must be gone. No chart-written `user_directories` at all.
5. SaaS repo: render `lwql_postgres` as XML via render-config.sh; retire the bootstrap Job `infrastructure/lwql.tf:144-280`. ORDERING (hard rule): SQL collection must be dropped on every node BEFORE any pod boots with the XML collection — name collision is startup-fatal (measured, NAMED_COLLECTION_ALREADY_EXISTS). Write the migration steps explicitly in the PR description.
6. Documentation ACs AC7–AC11 from the issue body: BYO prerequisites in chart README + clickhouse-external overlay docs (`custom_settings_prefixes`, access management, `named_collection_control`); plaintext-password caveat for `lwql_postgres`; one overview doc tying the two provisioning paths together (the ownership contract); identifiers `langwatch_lwql`/`lwql_restricted`/`lwql_postgres` in markdown; LWQL mentions in both clickhouse-serverless READMEs.

## Constraints
- One owner per entity name, everywhere. XML + SQL both defining a name wedges access entities (495 on all repair statements incl. DROP IF EXISTS) or blocks server boot (collections). Measured on 25.10.2.65.
- Do not touch the proof-harness worktree /home/ubuntu/worktrees/langwatch/issue1168-clickhouse-upgrade-proof.
- Commit with explicit paths, never `git add -A`. Small commits per work item.
- Cite evidence (file:line) for claims in PR text. Do not merge anything; push branch + open/update PR text only when asked.
- After items 1–4: run chart lint/template render checks locally (helm template) to prove no user_directories emitted and XML block present.
- Report progress by writing /tmp/design-c-progress.md (tmux history is shallow).
