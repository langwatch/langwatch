package apidiff

import (
	"context"
	"errors"
	"io"
	"strings"
	"testing"
)

func managedBootState(t *testing.T, recorder *recordingRunner, composePostgres bool) *bootState {
	t.Helper()
	root := t.TempDir()
	state := &bootState{
		cfg:    BootConfig{BranchDir: root, ComposeProject: "apidiff", ComposePostgres: composePostgres},
		stderr: io.Discard, run: recorder.run, workRoot: root, runID: "testrun",
	}
	if err := state.resolveInfra(); err != nil {
		t.Fatal(err)
	}
	return state
}

// @scenario "A -no-haven run keeps Postgres on haven's host server"
func TestANoHavenRunKeepsPostgresOnTheHostServer(t *testing.T) {
	recorder := &recordingRunner{}
	state := managedBootState(t, recorder, false)
	if state.infra.pgServer != hostPostgresURL || state.pgInCompose() {
		t.Fatalf("postgres = %q (compose %t), want the host server", state.infra.pgServer, state.pgInCompose())
	}
	if state.adminDatabase() != "postgres" {
		t.Errorf("admin database = %q, want postgres", state.adminDatabase())
	}
	if !strings.Contains(state.infra.chServer, "127.0.0.1:") || state.infra.chPort == 0 {
		t.Errorf("clickhouse must stay on the compose stack: %q", state.infra.chServer)
	}
	if err := state.startInfra(context.Background()); err != nil {
		t.Fatal(err)
	}
	up := argv(recorder.commands[0])
	if strings.Contains(up, "postgres") || !strings.Contains(up, "up -d redis clickhouse --wait") {
		t.Errorf("compose up = %q, want redis and clickhouse only", up)
	}
	branch, main := DatabaseName(state.runID, "branch"), DatabaseName(state.runID, "main")
	if branch == main || branch == DatabaseName("otherrun", "branch") {
		t.Errorf("databases must differ per side and per run: %q %q", branch, main)
	}
	for _, name := range []string{branch, main} {
		if !strings.HasPrefix(name, "apidiff_") || strings.HasPrefix(name, "lw_") {
			t.Errorf("%q could name a dev stack's database", name)
		}
	}
}

func TestHostPostgresPreflightNamesTheWayOut(t *testing.T) {
	recorder := &recordingRunner{err: errors.New("connection refused")}
	state := managedBootState(t, recorder, false)
	err := state.preflight(context.Background())
	if err == nil || !strings.Contains(err.Error(), "-compose-postgres") {
		t.Fatalf("preflight = %v, want a refusal naming -compose-postgres", err)
	}
}

// @scenario "-compose-postgres keeps the fully isolated compose stack"
func TestComposePostgresKeepsTheIsolatedStack(t *testing.T) {
	recorder := &recordingRunner{}
	state := managedBootState(t, recorder, true)
	if !state.pgInCompose() || state.adminDatabase() != pgAdminDB || strings.Contains(state.infra.pgServer, ":5432/") {
		t.Fatalf("postgres = %q, want the compose stack's own port", state.infra.pgServer)
	}
	if err := state.startInfra(context.Background()); err != nil {
		t.Fatal(err)
	}
	if up := argv(recorder.commands[0]); !strings.Contains(up, "up -d postgres redis clickhouse --wait") {
		t.Errorf("compose up = %q, want all three services", up)
	}
	if err := state.pgAdmin(context.Background(), "SELECT 1"); err != nil {
		t.Fatal(err)
	}
	if last := recorder.commands[len(recorder.commands)-1]; last.name != "docker" {
		t.Errorf("compose postgres must be administered through compose exec, ran %s", argv(last))
	}
}

func TestDryRunNamesTheHostDatabases(t *testing.T) {
	plan, err := PlanBoot(BootConfig{BranchDir: t.TempDir(), WorkRoot: "/tmp/.apidiff/run1", MainRef: "origin/main"})
	if err != nil {
		t.Fatal(err)
	}
	if joined := strings.Join(plan.Commands, "\n"); !strings.Contains(joined, "apidiff_run1_branch and apidiff_run1_main") {
		t.Errorf("plan does not name the host databases:\n%s", joined)
	}
}
