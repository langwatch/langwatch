package domain

// PostgresService is the routed name for a stack's Postgres: it always
// resolves (postgres.<slug>.langwatch.localhost), pointing at the one shared
// managed server. Per-worktree isolation is by database, not server — same
// story as ClickHouse (see DatabaseForSlug, reused here: one naming scheme for
// both, since they are separate servers and the names never collide).
const PostgresService = "postgres"

// PostgresRole is the role haven creates on the shared server and every
// worktree's DATABASE_URL connects as. Matches the username/password the
// previous compose-based postgres:16 service used (POSTGRES_USER=prisma,
// POSTGRES_PASSWORD=prisma), so nothing downstream needs to change.
const PostgresRole = "prisma"

// PostgresRolePassword is deliberately a fixed, well-known local-only value —
// Homebrew Postgres's default pg_hba.conf trusts both the local socket and
// 127.0.0.1 TCP unconditionally (verified: `local all all trust` / `host all
// all 127.0.0.1/32 trust`), so this password is never actually checked by the
// server. It exists only so DATABASE_URL has a well-formed shape.
const PostgresRolePassword = "prisma"

// DefaultPostgresFormula is the brew formula haven starts when no
// postgresql@NN service is already running. Matches the major version the
// previous compose-based setup used (postgres:16), for parity.
const DefaultPostgresFormula = "postgresql@16"

// DefaultPostgresPort is Postgres's conventional port. Unlike ClickHouse or the
// observability stack, haven does not allocate an ephemeral port for this: a
// brew-managed Postgres always binds its formula's configured port (5432
// unless a contributor customised it), and detecting an already-running
// instance (see the postgresbrew adapter) matters more than choosing a fresh
// port every time.
const DefaultPostgresPort = 5432
