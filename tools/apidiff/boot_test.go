package apidiff

import (
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
