package apidiff

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/url"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
	"syscall"
	"time"
)

// Boot orchestration constants, verified against dev/compose.dev.yml and
// packages/prisma-client/prisma/seed.ts. The dev compose file publishes no
// host ports for postgres/clickhouse, so boot generates a ports/volumes
// override file and brings the stack up under its own compose project.
const (
	composeServiceFile = "dev/compose.dev.yml"

	pgUser    = "prisma"
	pgPass    = "prisma"
	pgAdminDB = "mydb"

	chUser = "default"
	chPass = "langwatch"

	// throwawayCredentialsSecret matches the cipher's 32-bytes-of-hex rule
	// (apps/api/src/platform/config/api.config.ts). Both instances share it;
	// each hashes and verifies its own seeded keys under the same pepper.
	throwawayCredentialsSecret = "0000000000000000000000000000000000000000000000000000000000000000"
	throwawayNextAuthSecret    = "apidiff-throwaway-nextauth-secret"

	// Both layouts read LANGWATCH_INSTANCE_ADMIN_API_KEY for instance-admin
	// operations (branch: apps/api api.config.ts; main: platform/app
	// organizations route). Fixed and throwaway; probing defaults to it. The
	// 32+ character length is main's env-create.mjs minimum.
	throwawayInstanceAdminKey = "apidiff-instance-admin-key-00000000"

	// scimProbeToken is provisioned into both instances' ScimToken tables so
	// scim_bearer operations authenticate. Tokens verify by plain sha256 in
	// both layouts (scim.service.ts hashToken), so a fixed hash inserted at
	// boot works everywhere. The table shape is identical on both layouts
	// (branch adds a nullable connectionId, which stays NULL).
	scimProbeToken   = "apidiff-scim-token-value"
	scimProbeTokenID = "apidiff-scim-token"

	healthPath = "/api/health"
)

// Seeded credential defaults from packages/prisma-client/prisma/seed.ts.
const (
	DefaultProjectKey = "sk-lw-local-development-key"
	DefaultOrgKey     = "sk-lw-LocalDevPrivate1_LocalDevPrivateAccessTokenSecretFixedValue000000"
)

// BootConfig configures `apidiff run`.
type BootConfig struct {
	MainRef        string
	BranchDir      string
	WorkRoot       string
	Keep           bool
	ReuseWorktrees bool
	SkipInstall    bool
	BootTimeout    time.Duration
	PGURL          string // external postgres server URL; empty = compose
	CHURL          string
	RedisURL       string
	ComposeProject string
}

// Instance is one booted API copy.
type Instance struct {
	Name    string // "branch" or "main"
	Dir     string
	URL     string
	Port    int
	Profile bootProfile
}

// Booted holds the two running instances plus the teardown hooks.
type Booted struct {
	A        Instance // branch (candidate)
	B        Instance // main (base)
	WorkRoot string
	Teardown func()
}

// DatabaseName names each instance's Postgres and ClickHouse database,
// run-scoped so no run can cross over with a previous run's data, even if a
// previous teardown failed.
func DatabaseName(runID, instance string) string {
	return "apidiff_" + runID + "_" + instance
}

// RunID derives the run identity from the work root's base name (the
// timestamp directory by default), sanitized to a valid Postgres identifier
// fragment.
func RunID(workRoot string) string {
	base := strings.ToLower(filepath.Base(filepath.Clean(workRoot)))
	var id strings.Builder
	for _, character := range base {
		if (character >= 'a' && character <= 'z') || (character >= '0' && character <= '9') {
			id.WriteRune(character)
			continue
		}
		id.WriteByte('_')
	}
	result := strings.Trim(id.String(), "_")
	if result == "" {
		return "run"
	}
	return result
}

// pgDatabaseURL points a postgres server URL at one database.
func pgDatabaseURL(serverURL, database string) (string, error) {
	parsed, err := url.Parse(serverURL)
	if err != nil {
		return "", fmt.Errorf("postgres URL: %w", err)
	}
	parsed.Path = "/" + database
	return parsed.String(), nil
}

// chDatabaseURL points a ClickHouse server URL at one database.
func chDatabaseURL(serverURL, database string) (string, error) {
	parsed, err := url.Parse(serverURL)
	if err != nil {
		return "", fmt.Errorf("clickhouse URL: %w", err)
	}
	parsed.Path = "/" + database
	return parsed.String(), nil
}

// portsOverrideYAML renders the compose override that publishes host ports
// and isolates volumes for the apidiff stack. The !override tag (compose
// spec, docker compose v2.24+) replaces the base file's list entries rather
// than merging with them — redis's fixed 6379 binding and the shared named
// volumes must not leak into this stack. Memory: ClickHouse is capped at 2g
// (the dev stack's 4g does not fit a 4 GiB VM beside everything else) and
// postgres raised to 512m — the dev stack's 256m cgroup limit is a plausible
// kill reason when 297 migrations run while two Node APIs boot.
func portsOverrideYAML(pgPort, chPort, redisPort int) string {
	return fmt.Sprintf(`services:
  postgres:
    ports: !override
      - "127.0.0.1:%d:5432"
    volumes: !override
      - apidiff-pg-data:/var/lib/postgresql/data
    deploy:
      resources:
        limits:
          memory: 512m
          cpus: "0.5"
  redis:
    ports: !override
      - "127.0.0.1:%d:6379"
    volumes: !override
      - apidiff-redis-data:/data
  clickhouse:
    ports: !override
      - "127.0.0.1:%d:8123"
    volumes: !override
      - apidiff-ch-data:/var/lib/clickhouse
    deploy:
      resources:
        limits:
          memory: 2g
          cpus: "1.0"
volumes:
  apidiff-pg-data:
  apidiff-redis-data:
  apidiff-ch-data:
`, pgPort, redisPort, chPort)
}

// managedEnvKeys are removed from the inherited environment before the
// composed values are appended, so the instance env always wins.
var managedEnvKeys = []string{
	"API_PORT", "PORT", "LANGWATCH_API_PORT",
	"DATABASE_URL", "CLICKHOUSE_URL", "REDIS_URL", "REDIS_DB_INDEX",
	"CREDENTIALS_SECRET", "NEXTAUTH_SECRET", "NEXTAUTH_URL", "BASE_HOST",
	"NODE_ENV",
	"API_TOKEN_JWT_SECRET", "LANGWATCH_NLP_SERVICE", "LANGWATCH_ENDPOINT",
	"LANGWATCH_INSTANCE_ADMIN_API_KEY",
}

// instanceEnvSpec carries the per-instance values instanceEnv composes.
type instanceEnvSpec struct {
	port         int
	portEnv      []string // profile-specific port variables
	extraEnv     []string // profile-specific extras (see bootProfile.extraEnv)
	database     string
	chDatabase   string
	redisURL     string
	redisDBIndex string
}

// instanceEnv composes one instance's process environment: user env
// passthrough minus the managed keys, plus the composed values.
func instanceEnv(inherit []string, spec instanceEnvSpec) []string {
	managed := map[string]bool{}
	for _, key := range managedEnvKeys {
		managed[key] = true
	}
	env := make([]string, 0, len(inherit)+10)
	for _, entry := range inherit {
		name, _, _ := strings.Cut(entry, "=")
		if managed[name] {
			continue
		}
		env = append(env, entry)
	}
	base := fmt.Sprintf("http://localhost:%d", spec.port)
	env = append(env,
		"NODE_ENV=development",
		"DATABASE_URL="+spec.database,
		"CLICKHOUSE_URL="+spec.chDatabase,
		"REDIS_URL="+spec.redisURL,
		"REDIS_DB_INDEX="+spec.redisDBIndex,
		"CREDENTIALS_SECRET="+throwawayCredentialsSecret,
		"NEXTAUTH_SECRET="+throwawayNextAuthSecret,
		"LANGWATCH_INSTANCE_ADMIN_API_KEY="+throwawayInstanceAdminKey,
		"BASE_HOST="+base,
		"NEXTAUTH_URL="+base,
	)
	env = append(env, spec.extraEnv...)
	return append(env, spec.portEnv...)
}

// worktreeAddArgs builds `git worktree add --detach <dir> <ref>`.
func worktreeAddArgs(dir, ref string) []string {
	return []string{"worktree", "add", "--detach", dir, ref}
}

// composeCmd identifies one docker compose invocation target: project, repo
// checkout holding the base file, and the generated override file.
type composeCmd struct {
	project   string
	branchDir string
	override  string
}

// composeArgs prefixes every docker compose invocation with the project and
// both compose files.
func composeArgs(cmd composeCmd, args ...string) []string {
	base := []string{
		"compose", "-p", cmd.project,
		"-f", filepath.Join(cmd.branchDir, composeServiceFile),
	}
	if cmd.override != "" {
		base = append(base, "-f", cmd.override)
	}
	return append(base, args...)
}

// pgAdminArgs runs one SQL statement against a database on the compose
// postgres service.
func pgAdminArgs(cmd composeCmd, database, sql string) []string {
	return composeArgs(cmd,
		"exec", "-T", "postgres", "psql", "-U", pgUser, "-d", database, "-v", "ON_ERROR_STOP=1", "-c", sql)
}

// freePort allocates an ephemeral port that is free right now.
func freePort() (int, error) {
	listener, err := new(net.ListenConfig).Listen(context.Background(), "tcp", "127.0.0.1:0")
	if err != nil {
		return 0, err
	}
	defer listener.Close()
	return listener.Addr().(*net.TCPAddr).Port, nil
}

// externalInfra reports whether all three infrastructure URLs point at
// user-managed servers, skipping compose entirely.
func externalInfra(cfg BootConfig) (bool, error) {
	given := 0
	for _, value := range []string{cfg.PGURL, cfg.CHURL, cfg.RedisURL} {
		if value != "" {
			given++
		}
	}
	if given != 0 && given != 3 {
		return false, errors.New("-pg-url, -ch-url and -redis-url must be given together or not at all")
	}
	return given == 3, nil
}

// commandSpec describes one external command invocation.
type commandSpec struct {
	name string
	args []string
	dir  string
	env  []string
}

// runner executes external commands; tests swap it out.
type runner func(ctx context.Context, spec commandSpec, log io.Writer) error

// Boot brings up both instances and returns them with a teardown hook. On
// any failure the resources created so far are torn down before returning.
func Boot(ctx context.Context, cfg BootConfig, stderr io.Writer) (*Booted, error) {
	state := &bootState{cfg: cfg, stderr: stderr, run: execRunner}
	return state.boot(ctx)
}

type bootState struct {
	cfg       BootConfig
	stderr    io.Writer
	run       runner
	workRoot  string
	runID     string
	mainDir   string
	override  string
	infra     infraURLs
	ownsMain  bool
	processes []*exec.Cmd
}

type infraURLs struct {
	pgServer    string
	chServer    string
	redisServer string
	pgPort      int
	chPort      int
	redisPort   int
	branchRedis int // run-scoped logical DB indices; see RedisIndices
	mainRedis   int
}

func (state *bootState) logf(format string, args ...any) {
	fmt.Fprintf(state.stderr, format+"\n", args...)
}

func (state *bootState) boot(ctx context.Context) (booted *Booted, err error) {
	defer func() {
		if err != nil && booted != nil {
			booted.Teardown()
			booted = nil
		}
	}()

	if err := state.prepareLayout(); err != nil {
		return nil, err
	}
	if err := state.setupWorktree(ctx); err != nil {
		return nil, err
	}

	booted = &Booted{
		WorkRoot: state.workRoot,
		A:        Instance{Name: "branch", Dir: state.cfg.BranchDir},
		B:        Instance{Name: "main", Dir: state.mainDir},
	}
	booted.Teardown = state.teardown

	if err := state.prepareInstances(booted); err != nil {
		return booted, err
	}
	if err := state.bootInstances(ctx, booted); err != nil {
		return booted, err
	}
	return booted, nil
}

// prepareLayout resolves the branch dir and creates the work root.
func (state *bootState) prepareLayout() error {
	branchDir, err := filepath.Abs(state.cfg.BranchDir)
	if err != nil {
		return err
	}
	state.cfg.BranchDir = branchDir
	state.workRoot = state.cfg.WorkRoot
	if state.workRoot == "" {
		state.workRoot = filepath.Join(branchDir, ".apidiff", time.Now().Format("20060102-150405"))
	}
	if err := os.MkdirAll(filepath.Join(state.workRoot, "logs"), 0o750); err != nil {
		return err
	}
	state.runID = RunID(state.workRoot)
	branchRedis, mainRedis, err := RedisIndices(state.runID)
	if err != nil {
		return err
	}
	state.infra.branchRedis, state.infra.mainRedis = branchRedis, mainRedis
	state.logf("work root: %s (run %s, redis DBs %d/%d)", state.workRoot, state.runID, branchRedis, mainRedis)
	return nil
}

// prepareInstances detects each side's boot profile and allocates its API
// port up front, so the env overlay (written before migrate) can carry the
// final port values.
func (state *bootState) prepareInstances(booted *Booted) error {
	for _, instance := range []*Instance{&booted.A, &booted.B} {
		profile, err := detectProfile(instance.Dir)
		if err != nil {
			return err
		}
		instance.Profile = profile
		port, err := freePort()
		if err != nil {
			return err
		}
		instance.Port = port
		instance.URL = fmt.Sprintf("http://127.0.0.1:%d", port)
		state.logf("%s: %s profile (%s)", instance.Name, profile.name, instance.Dir)
	}
	return nil
}

// bootInstances runs the per-instance bring-up stages in order.
func (state *bootState) bootInstances(ctx context.Context, booted *Booted) error {
	stages := []func() error{
		func() error { return state.resolveInfra() },
		func() error { return state.preflight(ctx) },
		func() error { return state.install(ctx, booted.A) },
		func() error { return state.install(ctx, booted.B) },
		func() error { return state.startInfra(ctx) },
		func() error { return state.waitPostgres(ctx) },
		func() error { return state.prepareDatabases(ctx) },
		func() error { return state.writeOverlay(booted.A) },
		func() error { return state.writeOverlay(booted.B) },
		func() error { return state.migrateAndSeed(ctx, booted.A) },
		func() error { return state.verifyMigrationTarget(ctx, booted.A) },
		func() error { return state.provision(ctx, booted.A) },
		func() error { return state.migrateAndSeed(ctx, booted.B) },
		func() error { return state.verifyMigrationTarget(ctx, booted.B) },
		func() error { return state.provision(ctx, booted.B) },
		func() error { return state.startAPI(ctx, &booted.A) },
		func() error { return state.startAPI(ctx, &booted.B) },
	}
	for _, stage := range stages {
		if err := stage(); err != nil {
			return err
		}
	}
	return nil
}

func (state *bootState) setupWorktree(ctx context.Context) error {
	state.mainDir = filepath.Join(state.workRoot, "main")
	if state.cfg.ReuseWorktrees {
		if _, err := os.Stat(state.mainDir); err == nil {
			state.logf("reusing worktree %s", state.mainDir)
			return nil
		}
		return fmt.Errorf("-reuse-worktrees but %s does not exist", state.mainDir)
	}
	state.logf("git worktree add %s at %s", state.cfg.MainRef, state.mainDir)
	if err := state.runHost(ctx, "git", worktreeAddArgs(state.mainDir, state.cfg.MainRef)...); err != nil {
		return fmt.Errorf("git worktree add: %w", err)
	}
	state.ownsMain = true
	return nil
}

// runHost runs a command in the branch checkout with the inherited env.
func (state *bootState) runHost(ctx context.Context, name string, args ...string) error {
	return state.run(ctx, commandSpec{name: name, args: args, dir: state.cfg.BranchDir}, state.stderr)
}

// compose identifies this run's compose invocation target.
func (state *bootState) compose() composeCmd {
	return composeCmd{project: state.cfg.ComposeProject, branchDir: state.cfg.BranchDir, override: state.override}
}

func (state *bootState) install(ctx context.Context, instance Instance) error {
	if state.cfg.SkipInstall || (instance.Name == "main" && state.cfg.ReuseWorktrees) {
		state.logf("install %s: skipped", instance.Name)
		return nil
	}
	state.logf("install %s: pnpm install --frozen-lockfile (this is the slow step)", instance.Name)
	install := commandSpec{name: "pnpm", args: []string{"install", "--frozen-lockfile"}, dir: instance.Dir}
	if err := state.run(ctx, install, state.stderr); err != nil {
		return fmt.Errorf("install %s: %w", instance.Name, err)
	}
	for _, argv := range instance.Profile.prepareArgvs {
		prepare := commandSpec{name: "pnpm", args: argv, dir: instance.Dir}
		if err := state.run(ctx, prepare, state.stderr); err != nil {
			return fmt.Errorf("prepare %s (%s): %w", instance.Name, strings.Join(argv, " "), err)
		}
	}
	return nil
}

// writeOverlay writes the composed environment to the profile's env overlay
// file. Only the monolith profile needs one: its env-load.ts applies
// .env.portless with override:true, so the file must exist before any
// task.ts/server.mts run — otherwise a .env copied into the worktree by the
// post-checkout hook would clobber our per-instance DATABASE_URL.
func (state *bootState) writeOverlay(instance Instance) error {
	if !instance.Profile.overlay {
		return nil
	}
	env, err := state.envFor(instance)
	if err != nil {
		return err
	}
	path := filepath.Join(instance.Dir, overlayEnvFile)
	if err := os.WriteFile(path, []byte(overlayContent(env)), 0o600); err != nil {
		return fmt.Errorf("env overlay %s: %w", instance.Name, err)
	}
	state.logf("env overlay %s: %s", instance.Name, path)
	return nil
}

// resolveInfra decides where the infrastructure comes from: external servers
// are adopted here, before anything is installed, so the preflight can reach
// them; the managed stack only allocates its ports and writes its override.
func (state *bootState) resolveInfra() error {
	external, err := externalInfra(state.cfg)
	if err != nil {
		return err
	}
	if external {
		state.infra.pgServer = state.cfg.PGURL
		state.infra.chServer = state.cfg.CHURL
		state.infra.redisServer = state.cfg.RedisURL
		state.logf("infra: using external servers")
		return nil
	}
	for _, port := range []*int{&state.infra.pgPort, &state.infra.chPort, &state.infra.redisPort} {
		value, err := freePort()
		if err != nil {
			return err
		}
		*port = value
	}
	state.override = filepath.Join(state.workRoot, "compose.apidiff.yml")
	if err := os.WriteFile(state.override, []byte(portsOverrideYAML(state.infra.pgPort, state.infra.chPort, state.infra.redisPort)), 0o600); err != nil {
		return err
	}
	state.infra.pgServer = fmt.Sprintf("postgres://%s:%s@127.0.0.1:%d/%s", pgUser, pgPass, state.infra.pgPort, pgAdminDB)
	state.infra.chServer = fmt.Sprintf("http://%s:%s@127.0.0.1:%d", chUser, chPass, state.infra.chPort)
	state.infra.redisServer = fmt.Sprintf("redis://127.0.0.1:%d", state.infra.redisPort)
	return nil
}

// preflight validates external infrastructure BEFORE the two pnpm installs.
// Every precondition it checks used to surface eight minutes in, after two
// installs and six builds: a Postgres URL without a username passes psql
// (which falls back to $USER) and dies at prisma with P1010, and an admin
// database that does not exist dies at the first CREATE DATABASE.
func (state *bootState) preflight(ctx context.Context) error {
	if state.override != "" {
		state.logf("preflight: managed compose stack, no external endpoints to validate")
		return nil
	}
	if err := validateInfraURLs(state.infra); err != nil {
		return err
	}
	state.logf("preflight: checking postgres, clickhouse and redis are reachable")
	if _, err := state.pgQuery(ctx, "SELECT 1"); err != nil {
		return fmt.Errorf("preflight postgres %s: %w", redactURL(state.infra.pgServer), err)
	}
	if err := state.chAdmin(ctx, "SELECT 1"); err != nil {
		return fmt.Errorf("preflight clickhouse: %w", err)
	}
	if err := redisPing(ctx, state.infra.redisServer); err != nil {
		return fmt.Errorf("preflight redis: %w", err)
	}
	state.logf("preflight: all three endpoints answered")
	return nil
}

// validateInfraURLs checks the shape of the three external URLs. The
// Postgres username is required because prisma needs one and psql does not,
// so its absence is invisible until migrate.
func validateInfraURLs(infra infraURLs) error {
	postgres, err := url.Parse(infra.pgServer)
	if err != nil {
		return fmt.Errorf("preflight: -pg-url: %w", err)
	}
	if postgres.User == nil || postgres.User.Username() == "" {
		return errors.New("preflight: -pg-url needs a username (psql falls back to $USER, prisma does not: P1010)")
	}
	if postgres.Host == "" {
		return errors.New("preflight: -pg-url needs a host")
	}
	if strings.Trim(postgres.Path, "/") == "" {
		return errors.New("preflight: -pg-url needs a database to administer from, for example postgres://user@host:5432/postgres")
	}
	clickhouse, err := url.Parse(infra.chServer)
	if err != nil {
		return fmt.Errorf("preflight: -ch-url: %w", err)
	}
	if clickhouse.Host == "" {
		return errors.New("preflight: -ch-url needs a host")
	}
	if _, err := parseRedisURL(infra.redisServer); err != nil {
		return fmt.Errorf("preflight: -redis-url: %w", err)
	}
	return nil
}

// redactURL strips any password from a URL before it reaches a log line.
func redactURL(rawURL string) string {
	parsed, err := url.Parse(rawURL)
	if err != nil {
		return "(unparseable URL)"
	}
	if parsed.User != nil {
		parsed.User = url.User(parsed.User.Username())
	}
	return parsed.String()
}

// startInfra brings the managed compose stack up; with external servers there
// is nothing to start (resolveInfra adopted them and preflight checked them).
func (state *bootState) startInfra(ctx context.Context) error {
	if state.override == "" {
		return nil
	}
	state.logf("infra: docker compose up (pg :%d, clickhouse :%d, redis :%d)", state.infra.pgPort, state.infra.chPort, state.infra.redisPort)
	args := composeArgs(state.compose(), "up", "-d", "postgres", "redis", "clickhouse", "--wait")
	if err := state.runHost(ctx, "docker", args...); err != nil {
		return fmt.Errorf("compose up: %w", err)
	}
	return nil
}

// pgAdmin runs one SQL statement against the admin database, via compose exec
// for the managed stack or a host psql for external servers.
func (state *bootState) pgAdmin(ctx context.Context, sql string) error {
	return state.pgAdminDB(ctx, state.adminDatabase(), sql)
}

// adminDatabase names the database administrative statements run against.
// The compose stack always has "mydb"; an external server has whatever
// -pg-url names, and hardcoding the compose constant there made every
// external run fail at the first CREATE DATABASE with 'database "mydb" does
// not exist'.
func (state *bootState) adminDatabase() string {
	if state.override != "" {
		return pgAdminDB
	}
	parsed, err := url.Parse(state.infra.pgServer)
	if err != nil {
		return pgAdminDB
	}
	if database := strings.Trim(parsed.Path, "/"); database != "" {
		return database
	}
	return pgAdminDB
}

// pgQuery runs one SQL statement and returns its stdout (psql -tA).
func (state *bootState) pgQuery(ctx context.Context, sql string) (string, error) {
	var output bytes.Buffer
	if state.override != "" {
		args := composeArgs(state.compose(), "exec", "-T", "postgres", "psql", "-U", pgUser, "-d", state.adminDatabase(), "-tA", "-v", "ON_ERROR_STOP=1", "-c", sql)
		err := state.run(ctx, commandSpec{name: "docker", args: args, dir: state.cfg.BranchDir}, &output)
		return strings.TrimSpace(output.String()), err
	}
	if _, err := exec.LookPath("psql"); err != nil {
		return "", errors.New("external -pg-url requires psql on PATH for database administration")
	}
	err := state.run(ctx, commandSpec{name: "psql", args: []string{state.infra.pgServer, "-tA", "-v", "ON_ERROR_STOP=1", "-c", sql}, dir: state.cfg.BranchDir}, &output)
	return strings.TrimSpace(output.String()), err
}

// pgQueryDB runs one SQL statement against a NAMED database and returns its
// stdout (psql -tA).
func (state *bootState) pgQueryDB(ctx context.Context, database, sql string) (string, error) {
	var output bytes.Buffer
	if state.override != "" {
		args := composeArgs(state.compose(), "exec", "-T", "postgres", "psql", "-U", pgUser, "-d", database, "-tA", "-v", "ON_ERROR_STOP=1", "-c", sql)
		err := state.run(ctx, commandSpec{name: "docker", args: args, dir: state.cfg.BranchDir}, &output)
		return strings.TrimSpace(output.String()), err
	}
	if _, err := exec.LookPath("psql"); err != nil {
		return "", errors.New("external -pg-url requires psql on PATH for database administration")
	}
	databaseURL, err := pgDatabaseURL(state.infra.pgServer, database)
	if err != nil {
		return "", err
	}
	err = state.run(ctx, commandSpec{name: "psql", args: []string{databaseURL, "-tA", "-v", "ON_ERROR_STOP=1", "-c", sql}, dir: state.cfg.BranchDir}, &output)
	return strings.TrimSpace(output.String()), err
}

// waitPostgres polls the server itself past the container healthcheck: a
// fresh-volume postgres can still be in crash recovery when compose --wait
// goes green, and migrating or probing against a recovering server produces
// false findings (observed: P2039 wrapping 57P03 "the database system is in
// recovery mode" mid-probe).
func (state *bootState) waitPostgres(ctx context.Context) error {
	deadline := time.Now().Add(state.bootTimeout())
	for {
		ready, err := state.postgresReady(ctx)
		if err == nil && ready {
			state.logf("infra: postgres accepting writes (not in recovery)")
			return nil
		}
		if time.Now().After(deadline) {
			return fmt.Errorf("postgres not ready within %s (last error: %w)", state.bootTimeout(), err)
		}
		select {
		case <-ctx.Done():
			return ctx.Err()
		case <-time.After(2 * time.Second):
		}
	}
}

// postgresReady reports whether the server answers SELECT 1 and is not in
// recovery.
func (state *bootState) postgresReady(ctx context.Context) (bool, error) {
	if _, err := state.pgQuery(ctx, "SELECT 1"); err != nil {
		return false, err
	}
	recovery, err := state.pgQuery(ctx, "SELECT pg_is_in_recovery()")
	if err != nil {
		return false, err
	}
	return recovery == "f", nil
}

func (state *bootState) bootTimeout() time.Duration {
	if state.cfg.BootTimeout <= 0 {
		return 5 * time.Minute
	}
	return state.cfg.BootTimeout
}

// pgAdminDB runs one SQL statement against a specific database.
func (state *bootState) pgAdminDB(ctx context.Context, database, sql string) error {
	if state.override != "" {
		return state.runHost(ctx, "docker", pgAdminArgs(state.compose(), database, sql)...)
	}
	if _, err := exec.LookPath("psql"); err != nil {
		return errors.New("external -pg-url requires psql on PATH for database administration")
	}
	args, err := psqlArgs(state.infra.pgServer, database, sql)
	if err != nil {
		return err
	}
	return state.runHost(ctx, "psql", args...)
}

// psqlArgs builds the host psql argv for one statement against one database
// on an external server.
func psqlArgs(serverURL, database, sql string) ([]string, error) {
	databaseURL, err := pgDatabaseURL(serverURL, database)
	if err != nil {
		return nil, err
	}
	return []string{databaseURL, "-v", "ON_ERROR_STOP=1", "-c", sql}, nil
}

// chAdmin runs one ClickHouse statement over the HTTP interface.
func (state *bootState) chAdmin(ctx context.Context, query string) error {
	endpoint, err := url.Parse(state.infra.chServer)
	if err != nil {
		return err
	}
	// A server URL may carry a database as its path; administrative
	// statements address the server itself.
	endpoint.Path = "/"
	endpoint.RawQuery = "query=" + url.QueryEscape(query)
	request, err := http.NewRequestWithContext(ctx, http.MethodPost, endpoint.String(), nil)
	if err != nil {
		return err
	}
	client := &http.Client{Timeout: 30 * time.Second}
	response, err := client.Do(request)
	if err != nil {
		return fmt.Errorf("clickhouse %q: %w", query, err)
	}
	defer response.Body.Close()
	body, _ := io.ReadAll(io.LimitReader(response.Body, 4096))
	if response.StatusCode != http.StatusOK {
		return fmt.Errorf("clickhouse %q: status %d: %s", query, response.StatusCode, strings.TrimSpace(string(body)))
	}
	return nil
}

// prepareDatabases recreates both instances' databases unless -keep is set.
// ClickHouse databases are created by the clickhouse-migrate task's goose
// bootstrap; here they only need dropping for freshness.
func (state *bootState) prepareDatabases(ctx context.Context) error {
	if state.cfg.Keep {
		state.logf("databases: -keep set, reusing existing")
		return nil
	}
	for _, instance := range []string{"branch", "main"} {
		database := DatabaseName(state.runID, instance)
		state.logf("databases: recreate %s", database)
		if err := state.pgAdmin(ctx, fmt.Sprintf("DROP DATABASE IF EXISTS %s WITH (FORCE)", database)); err != nil {
			return err
		}
		if err := state.pgAdmin(ctx, "CREATE DATABASE "+database); err != nil {
			return err
		}
		if err := state.chAdmin(ctx, "DROP DATABASE IF EXISTS "+database); err != nil {
			return err
		}
	}
	return state.flushRedis(ctx)
}

// flushRedis empties both instances' logical databases. Without it a
// previous run's queues, idempotency ledger and caches survive on external
// infrastructure and one side boots onto another run's state.
func (state *bootState) flushRedis(ctx context.Context) error {
	for name, index := range map[string]int{"branch": state.infra.branchRedis, "main": state.infra.mainRedis} {
		state.logf("databases: flush redis DB %d (%s)", index, name)
		if err := redisFlushDB(ctx, state.infra.redisServer, index); err != nil {
			return fmt.Errorf("flush redis DB %d: %w", index, err)
		}
	}
	return nil
}

// migrateAndSeed runs the profile's migrate and seed commands in one
// worktree with the instance environment.
func (state *bootState) migrateAndSeed(ctx context.Context, instance Instance) error {
	env, err := state.envFor(instance)
	if err != nil {
		return err
	}
	state.logf("migrate %s: prisma + clickhouse", instance.Name)
	steps := []struct {
		name string
		args []string
	}{
		{"prisma migrate", instance.Profile.prismaMigrateArgv},
		{"clickhouse migrate", instance.Profile.clickhouseMigrateArgv},
		{"seed", instance.Profile.seedArgv},
	}
	for _, step := range steps {
		spec := commandSpec{name: "pnpm", args: step.args, dir: instance.Dir, env: env}
		if err := state.run(ctx, spec, state.stderr); err != nil {
			return fmt.Errorf("%s %s: %w", step.name, instance.Name, err)
		}
	}
	return nil
}

// provision inserts the run's fixed fixtures into one instance's database:
// the SCIM probe token and the permission-probe projects/orgs.
func (state *bootState) provision(ctx context.Context, instance Instance) error {
	if err := state.seedScimToken(ctx, instance); err != nil {
		return err
	}
	state.logf("fixtures %s: permission-probe projects", instance.Name)
	if err := state.pgAdminDB(ctx, DatabaseName(state.runID, instance.Name), provisioningSQL()); err != nil {
		return fmt.Errorf("fixtures %s: %w", instance.Name, err)
	}
	return nil
}

// seedScimToken provisions the fixed SCIM probe token into one instance's
// database, so scim_bearer operations authenticate identically on both sides.
func (state *bootState) seedScimToken(ctx context.Context, instance Instance) error {
	hash := sha256Hex(scimProbeToken)
	state.logf("scim token %s: provision %s", instance.Name, scimProbeTokenID)
	sql := fmt.Sprintf(`INSERT INTO "ScimToken" ("id", "organizationId", "hashedToken", "description", "createdAt")`+
		` VALUES ('%s', 'local-dev-organization', '%s', 'apidiff probe token', NOW())`+
		` ON CONFLICT ("id") DO NOTHING`, scimProbeTokenID, hash)
	if err := state.pgAdminDB(ctx, DatabaseName(state.runID, instance.Name), sql); err != nil {
		return fmt.Errorf("scim token %s: %w", instance.Name, err)
	}
	return nil
}

func sha256Hex(value string) string {
	sum := sha256.Sum256([]byte(value))
	return hex.EncodeToString(sum[:])
}

// envFor composes the process environment for one instance. A URL that will
// not parse is an error, never a fallback to os.Environ(): the inherited
// environment carries the developer's own DATABASE_URL, and migrating and
// seeding into it is a data-loss event, not a warning.
func (state *bootState) envFor(instance Instance) ([]string, error) {
	database, err := pgDatabaseURL(state.infra.pgServer, DatabaseName(state.runID, instance.Name))
	if err != nil {
		return nil, fmt.Errorf("env %s: %w", instance.Name, err)
	}
	chDatabase, err := chDatabaseURL(state.infra.chServer, DatabaseName(state.runID, instance.Name))
	if err != nil {
		return nil, fmt.Errorf("env %s: %w", instance.Name, err)
	}
	redisIndex := state.infra.branchRedis
	if instance.Name == "main" {
		redisIndex = state.infra.mainRedis
	}
	baseURL := fmt.Sprintf("http://127.0.0.1:%d", instance.Port)
	return instanceEnv(os.Environ(), instanceEnvSpec{
		port:         instance.Port,
		portEnv:      instance.Profile.portEnv(instance.Port),
		extraEnv:     instance.Profile.extraEnv(baseURL),
		database:     database,
		chDatabase:   chDatabase,
		redisURL:     state.infra.redisServer,
		redisDBIndex: strconv.Itoa(redisIndex),
	}), nil
}

// verifyMigrationTarget proves the migrate that just ran landed in THIS
// run's database and not in whatever DATABASE_URL a worktree's own .env
// carries. The modular profile writes no env overlay and relies on node's
// --env-file not overriding an already-set variable; that invariant is one
// library swap away from pointing a migrate at the developer's database, so
// it is asserted rather than commented.
func (state *bootState) verifyMigrationTarget(ctx context.Context, instance Instance) error {
	database := DatabaseName(state.runID, instance.Name)
	applied, err := state.pgQueryDB(ctx, database, `SELECT count(*) FROM "_prisma_migrations" WHERE finished_at IS NOT NULL`)
	if err != nil {
		return fmt.Errorf("verify migration target %s: %w", instance.Name, err)
	}
	count, err := strconv.Atoi(strings.TrimSpace(applied))
	if err != nil || count == 0 {
		return fmt.Errorf("verify migration target %s: %s holds %s applied migrations; the migrate did not target this run's database", instance.Name, database, applied)
	}
	state.logf("migrate %s: %d migrations applied in %s", instance.Name, count, database)
	return nil
}

// startAPI spawns the API process for one instance and waits for health.
func (state *bootState) startAPI(ctx context.Context, instance *Instance) error {
	logPath := filepath.Join(state.workRoot, "logs", instance.Name+".log")
	logFile, err := os.OpenFile(logPath, os.O_CREATE|os.O_WRONLY|os.O_APPEND, 0o600)
	if err != nil {
		return err
	}
	// Setpgid puts the pnpm wrapper and its tsx child in one process group so
	// teardown can kill both — killing the parent alone orphans the server.
	env, err := state.envFor(*instance)
	if err != nil {
		logFile.Close()
		return err
	}
	// #nosec G204 -- the executable is the allowlisted constant "pnpm" and
	// startArgv comes from the two package-level bootProfile constants.
	command := exec.CommandContext(ctx, "pnpm", instance.Profile.startArgv...)
	command.SysProcAttr = &syscall.SysProcAttr{Setpgid: true}
	command.Dir = instance.Dir
	command.Env = env
	command.Stdout = logFile
	command.Stderr = logFile
	if err := command.Start(); err != nil {
		logFile.Close()
		return fmt.Errorf("start %s: %w", instance.Name, err)
	}
	state.processes = append(state.processes, command)
	state.logf("start %s on :%d (pid %d, log %s); waiting for health", instance.Name, instance.Port, command.Process.Pid, logPath)
	if err := state.waitHealthy(ctx, instance.URL); err != nil {
		return fmt.Errorf("health %s: %w (see %s)", instance.Name, err, logPath)
	}
	return nil
}

// waitHealthy polls the health endpoint until it answers or the boot timeout
// elapses.
func (state *bootState) waitHealthy(ctx context.Context, baseURL string) error {
	timeout := state.bootTimeout()
	deadline := time.Now().Add(timeout)
	client := &http.Client{Timeout: 5 * time.Second}
	for {
		if healthy(ctx, client, baseURL) {
			return nil
		}
		if time.Now().After(deadline) {
			return fmt.Errorf("no healthy response within %s", timeout)
		}
		select {
		case <-ctx.Done():
			return ctx.Err()
		case <-time.After(500 * time.Millisecond):
		}
	}
}

// healthy performs one health-check attempt.
func healthy(ctx context.Context, client *http.Client, baseURL string) bool {
	request, err := http.NewRequestWithContext(ctx, http.MethodGet, baseURL+healthPath, nil)
	if err != nil {
		return false
	}
	response, err := client.Do(request)
	if err != nil {
		return false
	}
	defer response.Body.Close()
	return response.StatusCode >= 200 && response.StatusCode < 300
}

// teardown stops the managed compose stack and removes the main worktree,
// unless -keep is set. With -keep the API processes outlive the tool (the
// context cancel kills the pnpm wrapper; the tsx child survives for
// inspection); without it the whole process groups are killed here, before
// the caller's cancel.
func (state *bootState) teardown() {
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Minute)
	defer cancel()
	if state.cfg.Keep {
		state.logf("teardown: -keep set, leaving infra, databases and worktree in place")
		return
	}
	state.killAPIProcesses()
	if state.override != "" {
		state.logf("teardown: docker compose down -v")
		args := composeArgs(state.compose(), "down", "-v")
		if err := state.runHost(ctx, "docker", args...); err != nil {
			state.logf("teardown: compose down: %v", err)
		}
	} else {
		// External infra has no compose down; drop exactly the run-scoped
		// databases this run created and empty its two Redis logical DBs.
		state.dropDatabases(ctx)
		if err := state.flushRedis(ctx); err != nil {
			state.logf("teardown: flush redis: %v", err)
		}
	}
	if state.ownsMain {
		if err := state.runHost(ctx, "git", "worktree", "remove", "--force", state.mainDir); err != nil {
			state.logf("teardown: worktree remove: %v", err)
		}
	}
}

// killAPIProcesses kills each started API's whole process group — the pnpm
// wrapper and its tsx child share the group Setpgid created.
func (state *bootState) killAPIProcesses() {
	for _, command := range state.processes {
		if command.Process != nil {
			// Negative pid targets the process group.
			_ = syscall.Kill(-command.Process.Pid, syscall.SIGKILL)
		}
	}
}

// dropDatabases drops this run's run-scoped databases on external
// infrastructure. Best-effort: teardown never fails the run over cleanup.
func (state *bootState) dropDatabases(ctx context.Context) {
	for _, instance := range []string{"branch", "main"} {
		database := DatabaseName(state.runID, instance)
		if err := state.pgAdmin(ctx, fmt.Sprintf("DROP DATABASE IF EXISTS %s WITH (FORCE)", database)); err != nil {
			state.logf("teardown: drop %s: %v", database, err)
		}
		if err := state.chAdmin(ctx, "DROP DATABASE IF EXISTS "+database); err != nil {
			state.logf("teardown: drop clickhouse %s: %v", database, err)
		}
	}
}

// allowedCommands are the only executables the boot orchestration runs; every
// commandSpec in this package is built from these constants, and the
// allowlist proves subprocess names are never tainted input.
var allowedCommands = map[string]bool{"git": true, "docker": true, "pnpm": true, "psql": true}

// execRunner runs one command, streaming output to log.
func execRunner(ctx context.Context, spec commandSpec, log io.Writer) error {
	if !allowedCommands[spec.name] {
		return fmt.Errorf("refusing to run unlisted command %q", spec.name)
	}
	// #nosec G204 -- spec.name is restricted to the allowedCommands allowlist
	// above; args are built from constants and tool-owned config in this file.
	command := exec.CommandContext(ctx, spec.name, spec.args...)
	command.Dir = spec.dir
	if spec.env != nil {
		command.Env = spec.env
	}
	command.Stdout = log
	command.Stderr = log
	return command.Run()
}
