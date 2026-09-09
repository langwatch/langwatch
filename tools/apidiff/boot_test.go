package apidiff

import (
	"context"
	"io"
	"strings"
	"testing"
)

func TestDatabaseName(t *testing.T) {
	if got := DatabaseName(RunID("/repo/.apidiff/20260905-120000"), "branch"); got != "apidiff_20260905_120000_branch" {
		t.Fatalf("DatabaseName = %q", got)
	}
	if got := DatabaseName("final3", "main"); got != "apidiff_final3_main" {
		t.Fatalf("DatabaseName = %q", got)
	}
	// Distinct runs never share a database name.
	if DatabaseName("run1", "branch") == DatabaseName("run2", "branch") {
		t.Fatal("run-scoped names must differ across runs")
	}
}

func TestRunID(t *testing.T) {
	cases := []struct{ workRoot, want string }{
		{"/repo/.apidiff/20260905-120000", "20260905_120000"},
		{"/repo/.apidiff/final3", "final3"},
		{"/repo/.apidiff/My Run!", "my_run"},
		{"/", "run"},
	}
	for _, testCase := range cases {
		if got := RunID(testCase.workRoot); got != testCase.want {
			t.Errorf("RunID(%q) = %q, want %q", testCase.workRoot, got, testCase.want)
		}
	}
}

func TestPGDatabaseURL(t *testing.T) {
	got, err := pgDatabaseURL("postgres://prisma:prisma@127.0.0.1:55432/mydb", "apidiff_branch")
	if err != nil {
		t.Fatal(err)
	}
	want := "postgres://prisma:prisma@127.0.0.1:55432/apidiff_branch"
	if got != want {
		t.Fatalf("pgDatabaseURL = %q, want %q", got, want)
	}
}

func TestPsqlServerURLDropsPrismaOnlyParameters(t *testing.T) {
	got, err := psqlServerURL("postgres://u:p@127.0.0.1:5432/langwatch?schema=langwatch_db&sslmode=disable&connection_limit=5")
	if err != nil {
		t.Fatal(err)
	}
	if got != "postgres://u:p@127.0.0.1:5432/langwatch?sslmode=disable" {
		t.Fatalf("psqlServerURL = %q", got)
	}
	args, err := psqlArgs("postgres://u:p@127.0.0.1:5432/langwatch?schema=langwatch_db", "apidiff_x_main", "SELECT 1")
	if err != nil {
		t.Fatal(err)
	}
	if args[0] != "postgres://u:p@127.0.0.1:5432/apidiff_x_main" {
		t.Fatalf("psqlArgs URL = %q", args[0])
	}
}

func TestCHDatabaseURL(t *testing.T) {
	got, err := chDatabaseURL("http://default:langwatch@127.0.0.1:58123", "apidiff_main")
	if err != nil {
		t.Fatal(err)
	}
	want := "http://default:langwatch@127.0.0.1:58123/apidiff_main"
	if got != want {
		t.Fatalf("chDatabaseURL = %q, want %q", got, want)
	}
}

func TestPortsOverrideYAML(t *testing.T) {
	yaml := portsOverrideYAML(55432, 58123, 56379)
	for _, want := range []string{
		`"127.0.0.1:55432:5432"`, `"127.0.0.1:58123:8123"`, `"127.0.0.1:56379:6379"`,
		"!override", "apidiff-pg-data", "apidiff-ch-data", "apidiff-redis-data",
		"memory: 2g",
	} {
		if !strings.Contains(yaml, want) {
			t.Errorf("override missing %q:\n%s", want, yaml)
		}
	}
}

func TestInstanceEnv(t *testing.T) {
	inherit := []string{
		"HOME=/home/user",
		"DATABASE_URL=postgres://real:secret@prod/db",
		"REDIS_URL=redis://prod:6379",
		"OPENAI_API_KEY=sk-user-passthrough",
	}
	env := instanceEnv(inherit, instanceEnvSpec{
		port:         6560,
		portEnv:      []string{"API_PORT=6560"},
		database:     "postgres://prisma:prisma@127.0.0.1:55432/apidiff_branch",
		chDatabase:   "http://default:langwatch@127.0.0.1:58123/apidiff_branch",
		redisURL:     "redis://127.0.0.1:56379",
		redisDBIndex: "14",
	})
	joined := strings.Join(env, "\n")

	for _, stale := range []string{"prod/db", "prod:6379"} {
		if strings.Contains(joined, stale) {
			t.Errorf("inherited managed value %q must be filtered:\n%s", stale, joined)
		}
	}
	for _, want := range []string{
		"HOME=/home/user",
		"OPENAI_API_KEY=sk-user-passthrough",
		"API_PORT=6560",
		"DATABASE_URL=postgres://prisma:prisma@127.0.0.1:55432/apidiff_branch",
		"CLICKHOUSE_URL=http://default:langwatch@127.0.0.1:58123/apidiff_branch",
		"REDIS_URL=redis://127.0.0.1:56379",
		"REDIS_DB_INDEX=14",
		"CREDENTIALS_SECRET=" + throwawayCredentialsSecret,
		"NEXTAUTH_SECRET=" + throwawayNextAuthSecret,
		"BASE_HOST=http://localhost:6560",
	} {
		found := false
		for _, entry := range env {
			if entry == want {
				found = true
				break
			}
		}
		if !found {
			t.Errorf("env missing %q:\n%s", want, joined)
		}
	}
}

func TestWorktreeAddArgs(t *testing.T) {
	got := strings.Join(worktreeAddArgs("/tmp/wt/main", "main"), " ")
	want := "worktree add --detach /tmp/wt/main main"
	if got != want {
		t.Fatalf("worktreeAddArgs = %q, want %q", got, want)
	}
}

func TestComposeArgs(t *testing.T) {
	cmd := composeCmd{project: "apidiff", branchDir: "/repo", override: "/repo/.apidiff/x/compose.apidiff.yml"}
	got := composeArgs(cmd, "up", "-d")
	want := "compose -p apidiff -f /repo/dev/compose.dev.yml -f /repo/.apidiff/x/compose.apidiff.yml up -d"
	if strings.Join(got, " ") != want {
		t.Fatalf("composeArgs = %q, want %q", strings.Join(got, " "), want)
	}
}

func TestPGAdminArgs(t *testing.T) {
	cmd := composeCmd{project: "apidiff", branchDir: "/repo", override: "/o.yml"}
	got := pgAdminArgs(cmd, "apidiff_branch", "INSERT INTO x VALUES (1)")
	joined := strings.Join(got, " ")
	for _, want := range []string{"exec", "-T", "postgres", "psql", "-U prisma", "-d apidiff_branch", "INSERT INTO x VALUES (1)"} {
		if !strings.Contains(joined, want) {
			t.Errorf("pgAdminArgs missing %q: %s", want, joined)
		}
	}
}

func TestExternalInfra(t *testing.T) {
	if ok, err := externalInfra(BootConfig{}); err != nil || ok {
		t.Fatalf("no URLs: ok=%v err=%v, want false/nil", ok, err)
	}
	if _, err := externalInfra(BootConfig{PGURL: "postgres://x"}); err == nil {
		t.Fatal("partial URLs must error")
	}
	ok, err := externalInfra(BootConfig{PGURL: "postgres://x", CHURL: "http://y", RedisURL: "redis://z"})
	if err != nil || !ok {
		t.Fatalf("all URLs: ok=%v err=%v, want true/nil", ok, err)
	}
}

// recordingRunner captures every external command a boot stage would run.
type recordingRunner struct {
	commands []commandSpec
	output   string
	err      error
}

func (recorder *recordingRunner) run(_ context.Context, spec commandSpec, log io.Writer) error {
	recorder.commands = append(recorder.commands, spec)
	if recorder.output != "" {
		if _, err := io.WriteString(log, recorder.output); err != nil {
			return err
		}
	}
	return recorder.err
}

func (recorder *recordingRunner) ran(name string) bool {
	for _, spec := range recorder.commands {
		if spec.name == name {
			return true
		}
	}
	return false
}

func externalBootState(recorder *recordingRunner, cfg BootConfig) *bootState {
	state := &bootState{cfg: cfg, stderr: io.Discard, run: recorder.run, runID: "testrun"}
	state.infra = infraURLs{
		pgServer:    cfg.PGURL,
		chServer:    cfg.CHURL,
		redisServer: cfg.RedisURL,
		branchRedis: 3,
		mainRedis:   11,
	}
	return state
}

// A malformed infrastructure URL used to fall back to os.Environ(), which
// carries the developer's own DATABASE_URL — the instance then migrated and
// seeded into their database.
func TestEnvForRejectsUnparseableInfraURL(t *testing.T) {
	t.Setenv("DATABASE_URL", "postgres://developer:secret@127.0.0.1:5432/their_own_db")
	state := externalBootState(&recordingRunner{}, BootConfig{})
	state.infra.pgServer = "://"
	env, err := state.envFor(Instance{Name: "branch", Port: 6560, Profile: modularProfile})
	if err == nil {
		t.Fatalf("unparseable postgres URL must error, got env of %d entries", len(env))
	}
	if env != nil {
		t.Fatal("no environment may be returned alongside the error")
	}
	if !strings.Contains(err.Error(), "branch") {
		t.Fatalf("error must name the instance: %v", err)
	}
}

func TestEnvForUsesTheRunScopedRedisIndex(t *testing.T) {
	state := externalBootState(&recordingRunner{}, BootConfig{})
	state.infra.pgServer = "postgres://prisma:prisma@127.0.0.1:5432/postgres"
	state.infra.chServer = "http://default:langwatch@127.0.0.1:8123"
	state.infra.redisServer = "redis://127.0.0.1:6379"
	for name, want := range map[string]string{"branch": "REDIS_DB_INDEX=3", "main": "REDIS_DB_INDEX=11"} {
		env, err := state.envFor(Instance{Name: name, Port: 6560, Profile: modularProfile})
		if err != nil {
			t.Fatal(err)
		}
		if !slicesContain(env, want) {
			t.Fatalf("%s env missing %q", name, want)
		}
	}
}

func slicesContain(values []string, want string) bool {
	for _, value := range values {
		if value == want {
			return true
		}
	}
	return false
}

// pgAdmin used to hardcode the compose constant "mydb", so every external
// run died at the first CREATE DATABASE.
func TestPGAdminUsesSuppliedDatabaseForExternalInfra(t *testing.T) {
	state := externalBootState(&recordingRunner{}, BootConfig{PGURL: "postgres://apidiff@127.0.0.1:5432/apidiff_admin"})
	if got := state.adminDatabase(); got != "apidiff_admin" {
		t.Fatalf("adminDatabase = %q, want apidiff_admin", got)
	}
	args, err := psqlArgs(state.infra.pgServer, state.adminDatabase(), "SELECT 1")
	if err != nil {
		t.Fatal(err)
	}
	joined := strings.Join(args, " ")
	if !strings.Contains(joined, "/apidiff_admin") || strings.Contains(joined, "mydb") {
		t.Fatalf("psql argv = %q, want the supplied database", joined)
	}
	// The compose stack keeps its own constant.
	managed := externalBootState(&recordingRunner{}, BootConfig{})
	managed.override = "/tmp/compose.apidiff.yml"
	if got := managed.adminDatabase(); got != pgAdminDB {
		t.Fatalf("managed adminDatabase = %q, want %q", got, pgAdminDB)
	}
}

// A -pg-url without a username passes psql (which falls back to $USER) and
// dies at prisma with P1010 — eight minutes and two installs later.
func TestPreflightRejectsUsernamelessPostgresURL(t *testing.T) {
	err := validateInfraURLs(infraURLs{
		pgServer:    "postgres://127.0.0.1:5432/postgres",
		chServer:    "http://default:langwatch@127.0.0.1:8123",
		redisServer: "redis://127.0.0.1:6379",
	})
	if err == nil || !strings.Contains(err.Error(), "username") {
		t.Fatalf("err = %v, want a username complaint", err)
	}
	if err := validateInfraURLs(infraURLs{
		pgServer:    "postgres://apidiff@127.0.0.1:5432/postgres",
		chServer:    "http://default:langwatch@127.0.0.1:8123",
		redisServer: "redis://127.0.0.1:6379",
	}); err != nil {
		t.Fatalf("a complete URL set must pass: %v", err)
	}
	if err := validateInfraURLs(infraURLs{
		pgServer:    "postgres://apidiff@127.0.0.1:5432",
		chServer:    "http://127.0.0.1:8123",
		redisServer: "redis://127.0.0.1:6379",
	}); err == nil {
		t.Fatal("a postgres URL with no admin database must be refused")
	}
}

func TestPreflightRunsBeforeInstall(t *testing.T) {
	recorder := &recordingRunner{}
	state := externalBootState(recorder, BootConfig{
		PGURL:    "postgres://127.0.0.1:5432/postgres",
		CHURL:    "http://127.0.0.1:8123",
		RedisURL: "redis://127.0.0.1:6379",
	})
	if err := state.preflight(context.Background()); err == nil {
		t.Fatal("preflight must reject the usernameless postgres URL")
	}
	if recorder.ran("pnpm") {
		t.Fatalf("preflight must fail before any install: %v", recorder.commands)
	}
	if recorder.ran("psql") {
		t.Fatal("a URL that cannot be used must be rejected before it is dialed")
	}
}

// The modular profile writes no env overlay; that the migrate landed in this
// run's database is asserted, not assumed.
func TestVerifyMigrationTargetRejectsAnUnmigratedDatabase(t *testing.T) {
	recorder := &recordingRunner{output: "0\n"}
	state := externalBootState(recorder, BootConfig{})
	state.override = "/tmp/compose.apidiff.yml" // compose path: psql via docker exec
	err := state.verifyMigrationTarget(context.Background(), Instance{Name: "branch"})
	if err == nil || !strings.Contains(err.Error(), "apidiff_testrun_branch") {
		t.Fatalf("err = %v, want the run-scoped database named", err)
	}
	applied := &recordingRunner{output: "297\n"}
	ok := externalBootState(applied, BootConfig{})
	ok.override = "/tmp/compose.apidiff.yml"
	if err := ok.verifyMigrationTarget(context.Background(), Instance{Name: "main"}); err != nil {
		t.Fatalf("a migrated database must pass: %v", err)
	}
}
