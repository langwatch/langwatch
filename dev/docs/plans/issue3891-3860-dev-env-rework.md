# Plan: boxd Makefile + quickstart rework (issues #3891 + #3860)

**Branch:** `issue3891/boxd-mk-and-quickstart-rework`
**Bundles:** [#3891](https://github.com/langwatch/langwatch/issues/3891) + [#3860](https://github.com/langwatch/langwatch/issues/3860)
**Owner:** Drew (autonomy-delegated to Claude)

## Bundling decision

**Verdict: keep bundled, full scope of both issues.**

Re-scoped 2026-05-06 after Drew's clarification:

> *"default to remote" really just means "default to whatever is in `.env`, everything else is an override." Profiles are URL-rewrite overrides on top of the contributor's existing `.env`. There is no shared remote dev backend to stand up — that was a misread of the spec.*

So #3860 AC2 / AC3 / AC6 are **back in scope**. The mental model:

- **Contributor's `langwatch/.env` is the source of truth** for non-overridden URLs.
- **Each mode is a URL-rewrite preset** — it controls (a) which compose services start and (b) which URLs in env get rewritten to localhost (overriding the `.env` value).
- "default to remote" = "leave `.env` alone unless a mode explicitly overrides".

Implementation: a `langwatch/.env.dev-up` overlay file is loaded LAST as `env_file` in the relevant services. Compose's `x-common-env` no longer hard-sets `DATABASE_URL` / `REDIS_URL` / `CLICKHOUSE_URL` / `LANGWATCH_NLP_SERVICE` / `LANGEVALS_ENDPOINT` — those come from `langwatch/.env` by default and are overridden by `.env.dev-up` when a mode wants the local container.

Mode → (services, URL overrides):

| Mode | Compose services | URL overrides written to `.env.dev-up` |
|---|---|---|
| `frontend-only` | (no compose) | (none — pure `pnpm dev` against `.env`) |
| `backend-shared` | postgres + redis + clickhouse + app + init | `DATABASE_URL`, `REDIS_URL`, `CLICKHOUSE_URL` |
| `migration` | postgres + clickhouse (host-ports exposed) | `DATABASE_URL`, `CLICKHOUSE_URL` (localhost forms) |
| `nlp` | + langwatch_nlp + langevals | + `LANGWATCH_NLP_SERVICE`, `LANGEVALS_ENDPOINT` |
| `full-local` | `--profile full` (everything) | all five |

Migration mode uses a `compose.dev.migration.yml` overlay that adds host port mappings to postgres + clickhouse so the contributor can run `pnpm prisma migrate dev` and `pnpm clickhouse:migrate` from their host shell.

`make quickstart` accepts a positional mode arg for non-interactive usage: `make quickstart frontend-only`, `make quickstart backend-shared`, etc. `make quickstart help` continues to print the mode reference.

Deprecated targets (`make dev*` / `make dev-up`) become thin shims onto the new modes:
- `make dev` → `backend-shared`
- `make dev-nlp` → `nlp`
- `make dev-scenarios` → `full-local`
- `make dev-test` → `full-local`
- `make dev-full` → `full-local`

## Investigation answers (#3860 open questions)

1. **Are remote dev services provisioned?** No documented endpoint. CI uses isolated localhost services (see `.github/workflows/langwatch-app-ci.yml`); there's no shared `dev.langwatch.ai`-style backend a contributor can point at. Conclusion: filing a separate prerequisite issue.
2. **Should `quickstart help` exist non-interactively?** Yes — cheap to add, gives docs/agents a parseable surface. Format: `make quickstart help` prints mode → service-set table.
3. **Clickhouse — per-worktree state worth isolating?** No. ClickHouse data is observability spans, scoped by `TenantId`. Two worktrees sharing CH data means dev traces co-mingle in the same store, which is mildly confusing but not corrupting. The user-account / sign-up problem is in **postgres**, not CH. Treating CH as stateful-shared (same as postgres) keeps the model simple — same default everywhere.
4. **Boxd ↔ quickstart interaction?** A boxd VM is a single workspace. The worktree-isolation logic in `dev.sh` (`COMPOSE_PROJECT_NAME` derived from `basename`) is a no-op when there's only one checkout. Inside a boxd VM, the shared stable volume names just work — no special-casing needed beyond what the volume rename already gives us.

## Scope split

### #3891 — boxd.mk

| Deliverable | File |
|---|---|
| Make targets | `boxd.mk` (new), `Makefile` (include) |
| Pure shell helpers (slug, env discovery, hostname rewrite) | `scripts/boxd-fork.sh` (new) |
| Unit + integration tests for helpers | `scripts/__tests__/boxd-fork.unit.bats` (new), `scripts/__tests__/boxd-fork.integration.bats` (new) |
| Docs (philosophy, target reference, troubleshooting, threat model) | `dev/docs/boxd-makefile.md` (new) |
| BDD spec for verifiable behavior | `specs/setup/boxd-fork-vm.feature` (new, `@unimplemented` per repo convention) |

### #3860 — quickstart rework (subset)

| Deliverable | File |
|---|---|
| Stable named volumes for stateful services + singleton redis with host port | `compose.dev.yml` (edit) |
| `quickstart help` non-interactive mode + per-mode hint + fail-fast on env mismatch + idempotency notes | `scripts/dev.sh` (edit) |
| Deprecation wrappers around `make dev*` and `make dev-up` | `Makefile` (edit) |
| Updated dev section + new entry point | `CLAUDE.md` (edit), `dev/docs/adr/004-docker-dev-environment.md` (amendment) |
| BDD spec for new behavior | `specs/setup/quickstart-entry-point.feature` (new, `@unimplemented`) |

## boxd.mk design

### File layout

```
boxd.mk                       # Make targets (orchestration only)
scripts/boxd-fork.sh          # Shell helpers (pure-ish: slug, env discovery, hostname rewrite, env-cp, port mapping)
scripts/__tests__/boxd-fork.unit.bats        # tests for slugifier, env discovery, hostname rewrite
scripts/__tests__/boxd-fork.integration.bats # tests with mocked boxd, gh, git
dev/docs/boxd-makefile.md     # human-facing docs
specs/setup/boxd-fork-vm.feature # behavior spec (unimplemented stub)
```

The targets are thin orchestrators that source `scripts/boxd-fork.sh` and call its functions. This keeps the Makefile readable and makes the slug/env/rewrite logic unit-testable with bats.

### Slugifier — exact spec

Per #3891 AC#13:

```bash
boxd_slug() {
  local input="$1"
  local s
  s=$(printf '%s' "$input" \
    | tr '[:upper:]' '[:lower:]' \
    | sed -E 's#/+#-#g; s/[^a-z0-9-]+/-/g; s/-+/-/g; s/^-+//; s/-+$//')
  # truncate to 40 chars (no word-boundary cut)
  if [ "${#s}" -gt 40 ]; then
    s="${s:0:40}"
    s="${s%-}"
  fi
  printf '%s' "$s"
}
```

Examples (asserted in unit tests):
- `feat/Foo Bar!` → `feat-foo-bar`
- `issue3891/boxd-mk-and-quickstart-rework` → `issue3891-boxd-mk-and-quickstart-rework`
- 60-char input → truncated to ≤40, no trailing `-`.

Distinct from `scripts/worktree.sh::generate_slug` (50 chars, word-boundary truncation): `worktree.sh` makes branch names from titles; `boxd-fork.sh` makes VM names from already-slug-shaped branches. Different concerns; not unifying yet.

### Naming

| Target | VM name | tmux session |
|---|---|---|
| `boxd-golden` | `<namespace>--langwatch-golden` (namespace from `BOXD_NAMESPACE` → `gh api user` → `whoami`) | n/a |
| `boxd-fork-pr PR=N` | `langwatch-<branch_slug(PR.head)>` | `claude-<branch_slug>` |
| `boxd-fork-branch BRANCH=B` | `langwatch-<branch_slug(B)>` | `claude-<branch_slug>` |
| `boxd-fork-issue ISSUE=N` | **always** `langwatch-issue<N>` (literal) | `claude-issue<N>` |

Collision rule (AC#14): `fork-branch BRANCH=issue42/foo` produces `langwatch-issue42-foo`, distinct from `fork-issue ISSUE=42` (`langwatch-issue42`). If a branch slug starts with `issue<N>-`, the target prints a friendly nudge to use `fork-issue` instead, but doesn't block.

### `.env` discovery

```bash
# Glob-walk repo root, filter by allowlist + blocklist
boxd_env_files() {
  git ls-files -co --exclude-standard \
    | grep -E '(^|/)\.env($|\.[^/]*$)' \
    | grep -vE '\.(example|template|sample|local)$' \
    | grep -vE '(^|/)(node_modules|\.next|dist|build|\.git|vendor|coverage)/' \
    || true
}
```

Using `git ls-files -co --exclude-standard` instead of `find` so we honour `.gitignore`. `.env` itself is gitignored by repo convention but `-c` (cached) catches anything tracked, `-o` (other) catches untracked-but-not-ignored — wait, `.env` is git-ignored. Need `-co --exclude-standard` *plus* explicit `--others --include=.env` semantics. Actually simpler: `find . -name '.env' -not -path '*/node_modules/*' …` — same idea with explicit excludes per AC#24.

Decision: use `find` with explicit excludes, since `.env` files are gitignored and would not show up in `git ls-files`.

```bash
boxd_env_files() {
  find . \
    -type d \( -name node_modules -o -name .next -o -name dist -o -name build \
              -o -name .git -o -name vendor -o -name coverage \) -prune \
    -o -type f -name '.env' -print
}
```

### Hostname rewrite

Allowlist (AC#26):
- Exact key match: `NEXTAUTH_URL`, `BASE_HOST`, `LW_GATEWAY_BASE_URL`
- Value pattern match: `localhost:<port>` and `127.0.0.1:<port>`

For `langwatch-issue3891`:
- `NEXTAUTH_URL`/`BASE_HOST` → `https://langwatch-issue3891.boxd.sh`
- `LW_GATEWAY_BASE_URL` → `https://aigw.langwatch-issue3891.boxd.sh`
- Any `localhost:<port>` value → `https://<port-subdomain>.langwatch-issue3891.boxd.sh` *only if a corresponding port mapping exists*; otherwise leave alone with a warning.

Implementation: pure-bash awk-style line filter, applied to each `.env` file before it's `boxd cp`-ed.

### Port mapping

Per AC#27 + extension informed by #3860's port discussion:

| Subdomain | Internal port | Source |
|---|---|---|
| (default proxy) | 5560 | langwatch app (compose) |
| `aigw.<vm>` | 5563 | AI gateway (Go service) |
| `bullboard.<vm>` | 6380 | bullboard |
| `ai-server.<vm>` | 3456 | ai test server |

`boxd-fork-*` calls `boxd proxy set-port --port=5560` once + `boxd proxy new <name> --port=<n>` for each subdomain. Idempotent — `proxy new` on existing returns success.

### Credentials transport

`boxd cp ~/.claude/.credentials.json langwatch-<slug>:.claude/.credentials.json`

Path is a parameter (AC#22): `CLAUDE_CREDS=/path/to/credentials.json` overrides default. If the path doesn't exist, the target prints clear next-steps and exits non-zero.

### Git auth

Confirmed: the host's git uses `credential.https://github.com.helper=boxd` — boxd has a built-in credential helper. Forks inherit this from the golden image. AC#23 satisfied with no extra work.

### connect-* targets

```make
boxd-connect-issue:
	@vm="langwatch-issue$(ISSUE)"; tmux="claude-issue$(ISSUE)"; \
	  $(BOXD_CONNECT) "$$vm" "$$tmux"
```

`BOXD_CONNECT` is a function in `scripts/boxd-fork.sh` that:
1. Checks VM exists (`boxd list --json | jq …`); error+exit if not (AC#19)
2. If suspended, runs `boxd resume <vm>` and waits for ready (AC#20)
3. SSHes via `boxd connect <vm>` and runs `tmux attach -t <tmux>` — with a fallback if the session isn't there (AC#18: clear message + nonzero exit, no attach into nothing)

## #3860 design (subset)

### compose.dev.yml volume changes

```yaml
volumes:
  # Stateful — shared across worktrees + boxd VMs (AC4)
  db-data:
    name: langwatch-db-data
  clickhouse-data:
    name: langwatch-clickhouse-data
  # Stateless — singleton (AC5)
  redis-data:
    name: langwatch-redis-data
  # Per-worktree (Linux-vs-host platform isolation, see ADR-004)
  app_modules:
    name: ${VOLUME_PREFIX:-langwatch}-app-modules
  bullboard_modules:
    name: ${VOLUME_PREFIX:-langwatch}-bullboard-modules
  goose_bin:
    name: ${VOLUME_PREFIX:-langwatch}-goose-bin
  pnpm_store:
    name: langwatch-pnpm-store    # already shared
```

Plus expose redis on a fixed host port (AC5):
```yaml
redis:
  ports:
    - "6379:6379"
```

### Cross-worktree collision (AC4)

Two worktrees can both `up` postgres simultaneously — they'd both bind the container to the same volume, but only one can have the container *up* at a time per the AC ("Only one worktree can have a given stateful container `up` at a time"). Compose project name (`COMPOSE_PROJECT_NAME`) is still per-worktree, so the *container* name is unique, but the underlying volume is shared.

Wait — that's wrong. If two compose projects both create a container named `langwatch-issue123-postgres` and `langwatch-issue456-postgres`, both binding `/var/lib/postgresql/data` to volume `langwatch-db-data`, postgres will refuse to start the second one (lock file). That's actually the desired behavior — the second `quickstart` errors clearly.

`scripts/dev.sh` adds detection: before `up`, check if any container named `*-postgres` is running with the shared volume mounted. If yes, print a clear message: *"postgres is already up in another worktree (project=<other>). Stop it first or reuse it."*

### Quickstart help

```
make quickstart help

LangWatch development environment

  Modes:
    dev              postgres + redis + clickhouse + app
    dev-nlp          + nlp + langevals
    dev-scenarios    + scenario worker + bullboard + nlp
    dev-test         + ai test server
    dev-full         everything

  Stateful services share data across worktrees (langwatch-db-data, langwatch-clickhouse-data).
  Redis is a singleton on host :6379.
```

Implemented by checking `$1` in `scripts/dev.sh`: if it's `help`, print and exit.

### Deprecation wrappers in Makefile

```make
dev: _dev-deprecation-warning
	@$(SANITIZE_DEV_ENV) && $(COMPOSE) up

_dev-deprecation-warning:
	@printf '\033[33m[deprecated] make dev → make quickstart\033[0m\n' >&2
	@printf 'See: dev/docs/adr/004-docker-dev-environment.md\n' >&2
```

One release of grace. Filing a follow-up to remove.

### Fail-fast in dev.sh

```bash
# Inside ensure_prepared, before docker up:
if grep -qE '^IS_SAAS\s*=\s*"?true"?\s*$' langwatch/.env 2>/dev/null \
   && ! grep -qE '^BLOCK_LOCAL_HTTP_CALLS\s*=\s*"?true"?\s*$' langwatch/.env 2>/dev/null; then
  echo "ERROR: IS_SAAS=true requires BLOCK_LOCAL_HTTP_CALLS=true (SSRF guard)" >&2
  exit 1
fi
```

(`compose.dev.yml`'s common-env already sets `BLOCK_LOCAL_HTTP_CALLS: "true"` so this is a defense-in-depth check on the source `.env`, not the runtime.)

## AC → task mapping

### #3891 (boxd Makefile) — 29 ACs

| AC | Where addressed |
|---|---|
| 1 (boxd.mk + include) | `boxd.mk`, `Makefile` |
| 2 (target list) | `boxd.mk` |
| 3 (philosophy line in help) | `boxd.mk` `help` target |
| 4 (each target prints intent + confirm destructive) | `boxd.mk` per-target |
| 5 (golden VM pre-warmed) | `boxd-golden` calls `make dev-full` inside the VM via `boxd exec` |
| 6 (golden-reset) | `boxd.mk` |
| 7 (seed hook) | `boxd.mk` defines empty `seed-golden:` target documented as override-me |
| 8 (staleness ops doc) | `dev/docs/boxd-makefile.md` |
| 9 (naming convention) | `scripts/boxd-fork.sh` |
| 10 (single fork primitive) | `_boxd-fork-impl` make target shared across pr/branch/issue |
| 11 (fork has branch checked out + ready) | impl |
| 12 (fork-issue creates worktree branch + tmux+claude inside VM) | impl |
| 13 (slugifier spec) | `scripts/boxd-fork.sh::boxd_slug` + bats tests |
| 14 (collision rule) | impl + warning |
| 15 (existing-worktree behavior) | impl: idempotent reuse, error on existing VM |
| 16 (cross-fork PRs via gh) | impl |
| 17 (connect targets share resolution) | shared functions |
| 18 (clear msg if tmux missing) | impl |
| 19 (clear msg if VM missing) | impl |
| 20 (wake suspended VM) | impl: `boxd resume` + readiness wait |
| 21 (single source of truth resolution) | shared `boxd_vm_name`, `boxd_tmux_name` functions |
| 22 (CLAUDE_CREDS path param) | impl |
| 23 (git auth via boxd credential helper) | confirmed; documented |
| 24 (env glob excludes) | impl, tested |
| 25 (same-key precedence: each .env separate) | impl: cp preserves paths |
| 26 (hostname-rewrite allowlist) | impl, tested |
| 27 (ports 3000, 5563, others) | impl |
| 28 (dev/docs/ entry) | `dev/docs/boxd-makefile.md` |
| 29 (make help grep-able) | `boxd.mk` `help` target |

### #3860 (quickstart) — 10 ACs

| AC | Where addressed | Status |
|---|---|---|
| 1 (single entry point) | `Makefile` deprecation wrappers, `CLAUDE.md`, `ADR-004` | done |
| 2 (intent-based prompting) | `scripts/dev.sh` 5-mode prompt | done |
| 3 (default = fastest path) | `frontend-only` mode = no compose, ~instant | done |
| 4 (stateful shared volumes + collision detection) | `compose.dev.yml`, `scripts/dev.sh` | done |
| 5 (redis singleton + host port) | `compose.dev.yml` | done |
| 6 (URL rewrite on profile flip) | `scripts/dev.sh` writes `langwatch/.env.dev-up` per mode; `compose.dev.yml` honours it via env_file overlay | done |
| 7 (idempotent + fail-fast IS_SAAS guard) | `scripts/dev.sh` | done |
| 8 (per-mode hints + `quickstart help`) | `scripts/dev.sh` | done |
| 9 (deprecation warnings on old paths) | `Makefile`, `CLAUDE.md`, `ADR-004` | done |
| 10 (no CI regressions, `pnpm test:*` pass) | verified by running typecheck + test:unit | gate |

## Risk register

| Risk | Likelihood | Mitigation |
|---|---|---|
| Stable shared `db-data` volume conflicts with someone's existing per-worktree volume | High (everyone has stale `lw-<hash>-db-data`) | Migration note in ADR-004 amendment + `make quickstart` prints warning if old volumes detected |
| `boxd.mk` external-vs-internal CLI surface drift (issue calls out both) | Med | Use only commands that exist in both: `info`, `list`, `new`, `fork`, `exec`, `cp`, `proxy`, `connect`, `pause`, `resume`, `destroy`. No `local` / `auto-suspend` calls |
| Bats tests don't run in CI (no workflow runs them) | Low | They run locally for the slugifier + env helpers; integration via @unimplemented spec for parity tracking |
| Fork pruning is out of scope but the user's quota fills up | Low | Documented in `dev/docs/boxd-makefile.md`; follow-up issue filed |
| `make dev` deprecation warning breaks someone's muscle-memory workflow | Med | Warning is on stderr only; command still works for one release |
| Compose project name collision between worktrees with shared db-data | Med (this is the AC) | Detect via `docker ps` + clear error in `dev.sh`. Document in CLAUDE.md |
| The `boxd-fork-issue` flow assumes the developer's laptop has `worktree.sh` and the repo cloned | Low | This is the existing dev environment — same precondition as `make worktree` already imposes |
| Time pressure compresses #3860 scope further | Med | The deferred slice is documented in PR body + a follow-up issue is filed |

## Test strategy

- **`scripts/__tests__/boxd-fork.unit.bats`** — slugifier (5 cases per AC#13), `boxd_vm_name`, `boxd_tmux_name`, env-file discovery, hostname rewrite (allowlist + value-pattern + leave-alone)
- **`scripts/__tests__/boxd-fork.integration.bats`** — fork-pr/branch/issue with mocked `boxd`, `gh`, `git`. Asserts the orchestration order: resolve → fork → cp creds → cp envs → proxy new → exec tmux. Same mocking pattern as `worktree.integration.bats`.
- **`specs/setup/boxd-fork-vm.feature`** — `@unimplemented` BDD scenarios mirroring the bats tests for parity tracking.
- **`specs/setup/quickstart-entry-point.feature`** — `@unimplemented` BDD scenarios for the deprecation, help-mode, and shared-volume behavior.
- **No JS/TS tests added** — neither feature touches TS code paths. `pnpm typecheck` and `pnpm test:unit` run only as regression gates (AC10 of #3860).
- **Manual end-to-end** — once the boxd CLI surface is in place, run `make boxd-fork-issue ISSUE=3891` from the laptop and verify the fork comes up. **Will not block PR merge** — surface in PR body if the VM env doesn't allow this.

## Implementation order

1. ✅ Investigation (this doc)
2. Branch + git config
3. `scripts/boxd-fork.sh` skeleton + slugifier + bats unit tests (TDD)
4. `boxd.mk` skeleton + golden + connect-* targets
5. fork-* targets including env discovery, hostname rewrite, creds transport, port mapping
6. Bats integration tests (mocked boxd)
7. `compose.dev.yml` shared-volume changes + redis host port
8. `scripts/dev.sh` help mode + per-mode hints + idempotency / fail-fast / collision detection
9. `Makefile` deprecation wrappers
10. `CLAUDE.md` + `ADR-004` updates
11. `dev/docs/boxd-makefile.md`
12. `specs/setup/boxd-fork-vm.feature` + `specs/setup/quickstart-entry-point.feature`
13. `pnpm typecheck` + `pnpm test:unit` regression gate
14. Open PR, request review from `rogeriochaves`
15. Drive CI green; surface any blockers
