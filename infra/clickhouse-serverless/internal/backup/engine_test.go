package backup

import (
	"context"
	"errors"
	"io"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"

	"go.uber.org/zap"

	"github.com/langwatch/langwatch/infra/clickhouse-serverless/internal/bootstrap"
	"github.com/langwatch/langwatch/infra/clickhouse-serverless/internal/chclient"
)

var errBoom = errors.New("boom")

// fakeStore is an in-memory Store: backups started with Exec complete after
// polls reads of Status, with the outcome finalStatus.
type fakeStore struct {
	mu          sync.Mutex
	inFlight    []Backup
	created     []Backup
	fullsEver   int
	lastFull    time.Time
	lastInc     time.Time
	execs       []string
	polls       int
	finalStatus string
	statusOf    map[string]*Backup
	failRead    error
	replicas    Replicas
	replicasErr error
	flushes     int
}

func (f *fakeStore) FlushLogs(context.Context) error {
	f.mu.Lock()
	f.flushes++
	f.mu.Unlock()
	return nil
}
func (f *fakeStore) InFlight(context.Context) ([]Backup, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	return append([]Backup(nil), f.inFlight...), f.failRead
}
func (f *fakeStore) Created(context.Context, time.Time) ([]Backup, error) {
	return f.created, f.failRead
}
func (f *fakeStore) Summary(_ context.Context, mode Mode) (int, time.Time, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	if mode == Full {
		return f.fullsEver, f.lastFull, f.failRead
	}
	return 0, f.lastInc, f.failRead
}
func (f *fakeStore) Exec(_ context.Context, stmt string) error {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.execs = append(f.execs, stmt)
	id := stmt[strings.Index(stmt, "id = '")+6:]
	id = id[:strings.Index(id, "'")]
	if f.statusOf == nil {
		f.statusOf = map[string]*Backup{}
	}
	f.statusOf[id] = &Backup{ID: id, Path: id, Status: "CREATING_BACKUP", Start: now}
	return nil
}
func (f *fakeStore) Status(_ context.Context, id string) (Backup, bool, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	b, ok := f.statusOf[id]
	if !ok {
		return Backup{}, false, nil
	}
	f.polls++
	if f.polls >= 2 && b.Status == "CREATING_BACKUP" {
		b.Status = f.finalStatus
		b.End = now.Add(90 * time.Second)
		b.Bytes = 4096
		if b.Status != "BACKUP_CREATED" && b.Status != "RESTORED" {
			b.Error = "Code: 243. Not enough space\nstack"
		}
	}
	return *b, true, nil
}
func (f *fakeStore) List(context.Context, int) ([]Backup, error) { return f.created, nil }
func (f *fakeStore) Replicas(context.Context) (Replicas, error)  { return f.replicas, f.replicasErr }

func engineFor(f *fakeStore) *Engine {
	return &Engine{Store: f, Policy: policy, Log: zap.NewNop(), Now: func() time.Time { return now }, PollInterval: time.Millisecond}
}

// @scenario "A backup run never reports success without writing a backup"
func TestEngine_NoSuccessWithoutABackup(t *testing.T) {
	t.Run("a failed read fails the run", func(t *testing.T) {
		f := &fakeStore{failRead: errBoom}
		if res := engineFor(f).Run(context.Background(), Full, RunOptions{}); res.Outcome != Failed || len(f.execs) != 0 {
			t.Errorf("%+v, execs %v", res, f.execs)
		}
	})
	t.Run("a backup the server fails fails the run", func(t *testing.T) {
		f := &fakeStore{finalStatus: "BACKUP_FAILED"}
		res := engineFor(f).Run(context.Background(), Full, RunOptions{})
		if res.Outcome != Failed || !strings.Contains(res.Err.Error(), "Not enough space") {
			t.Errorf("%+v", res)
		}
	})
	t.Run("a backup that vanished fails the run", func(t *testing.T) {
		f := &fakeStore{}
		e := engineFor(f)
		res := e.wait(context.Background(), Result{}, "gone")
		if res.Outcome != Failed {
			t.Errorf("%+v", res)
		}
	})
	t.Run("only a created backup succeeds", func(t *testing.T) {
		f := &fakeStore{finalStatus: "BACKUP_CREATED"}
		res := engineFor(f).Run(context.Background(), Full, RunOptions{})
		if res.Outcome != Succeeded || res.Backup.Path != "langwatch_full_20261023T123000Z" || res.Duration() != 90*time.Second {
			t.Errorf("%+v", res)
		}
		if len(f.execs) != 1 || !strings.HasSuffix(f.execs[0], " ASYNC") {
			t.Errorf("execs %v", f.execs)
		}
	})
	t.Run("an interrupted wait is not a success", func(t *testing.T) {
		f := &fakeStore{finalStatus: "CREATING_BACKUP"}
		ctx, cancel := context.WithCancel(context.Background())
		cancel()
		if res := engineFor(f).Run(ctx, Full, RunOptions{}); res.Outcome != Interrupted {
			t.Errorf("%+v", res)
		}
	})
}

// @scenario "A restore needs an explicit name and confirmation"
func TestEngine_Restore(t *testing.T) {
	for _, tc := range []struct {
		name    string
		confirm bool
	}{{"full-20261023_050000/", false}, {"", true}, {"latest", true}, {"LATEST/", true}, {"../x", true}} {
		f := &fakeStore{}
		if res := engineFor(f).Restore(context.Background(), tc.name, tc.confirm); res.Outcome != Failed || len(f.execs) != 0 {
			t.Errorf("restore %q confirm=%v: %+v", tc.name, tc.confirm, res)
		}
	}
	f := &fakeStore{finalStatus: "RESTORED"}
	res := engineFor(f).Restore(context.Background(), "full-20261023_050000/", true)
	if res.Outcome != Succeeded || len(f.execs) != 1 || !strings.Contains(f.execs[0], "RESTORE DATABASE `langwatch` FROM Disk('backups', 'full-20261023_050000/')") {
		t.Errorf("%+v %v", res, f.execs)
	}
}

func sidecarFor(f *fakeStore, mode SidecarMode, preferred int) *Sidecar {
	full, _ := ParseSchedule("0 5 */3 * *")
	inc, _ := ParseSchedule("30 * * * *")
	return &Sidecar{
		Engine:    engineFor(f),
		Mode:      mode,
		Preferred: preferred,
		Schedules: map[Mode]*Schedule{Full: full, Incremental: inc},
		Metrics:   NewMetrics(mode, now),
		Log:       zap.NewNop(),
		Now:       func() time.Time { return now },
	}
}

func tick(s *Sidecar) {
	var wg sync.WaitGroup
	s.TickOnce(context.Background(), &wg)
	wg.Wait()
}

// @scenario "The sidecar adopts a backup in flight instead of starting a second"
func TestSidecar_AdoptsAfterRestart(t *testing.T) {
	running := inFlight(Full, "langwatch_full_20261023T120000Z", ago(30*time.Minute))
	f := &fakeStore{
		inFlight:    []Backup{running},
		statusOf:    map[string]*Backup{running.ID: &running},
		finalStatus: "BACKUP_CREATED",
		replicas:    Replicas{Total: 1, Reachable: []int{0}},
		lastInc:     ago(time.Minute), // the incremental slot is covered
	}
	s := sidecarFor(f, SidecarRun, 0)
	tick(s)
	if len(f.execs) != 0 {
		t.Fatalf("a second backup started: %v", f.execs)
	}
	st := s.Metrics.Status()
	if st.Modes[Full].LastOutcome != string(Succeeded) || st.Modes[Full].LastBackup != running.Path {
		t.Errorf("adopted backup not reported: %+v", st.Modes[Full])
	}
}

// @scenario "Exactly one replica runs backups, failing over to the next that answers"
func TestSidecar_OnlyTheRunnerBacksUp(t *testing.T) {
	for self := 0; self < 3; self++ {
		f := &fakeStore{finalStatus: "BACKUP_CREATED", replicas: Replicas{Total: 3, Self: self, Reachable: []int{0, 1}}}
		s := sidecarFor(f, SidecarRun, 2) // the preferred position is down: 0 takes over
		tick(s)
		if isRunner := self == 0; isRunner != (len(f.execs) > 0) {
			t.Errorf("position %d: runner %v, backups started %d", self, isRunner, len(f.execs))
		}
		if r := s.Metrics.Status().Runner; r == nil || *r != (self == 0) {
			t.Errorf("position %d runner metric %v", self, r)
		}
	}
}

// @scenario "Observe mode decides and reports but never backs up"
func TestSidecar_ObserveNeverBacksUp(t *testing.T) {
	f := &fakeStore{finalStatus: "BACKUP_CREATED", replicas: Replicas{Total: 1, Reachable: []int{0}}}
	s := sidecarFor(f, SidecarObserve, 0)
	tick(s)
	tick(s)
	if len(f.execs) != 0 {
		t.Fatalf("observe mode ran SQL: %v", f.execs)
	}
	var b strings.Builder
	s.Metrics.WritePrometheus(&b)
	for _, want := range []string{
		`clickhouse_backup_sidecar_info{state="observe"} 1`,
		`clickhouse_backup_dry_run_decisions_total{mode="full",action="start"} 1`,
		`clickhouse_backup_dry_run_decisions_total{mode="incremental",action="stand-down"} 1`,
	} {
		if !strings.Contains(b.String(), want) {
			t.Errorf("missing %s in\n%s", want, b.String())
		}
	}
}

// @scenario "A scheduled firing is owed until a backup of its mode completes after it"
func TestSidecar_CountsBackupsOthersWrote(t *testing.T) {
	// A CronJob finished both slots: the sidecar owes nothing.
	f := &fakeStore{replicas: Replicas{Total: 1, Reachable: []int{0}}, fullsEver: 1, lastFull: ago(6 * time.Hour), lastInc: ago(time.Minute)}
	s := sidecarFor(f, SidecarRun, 0)
	tick(s)
	if len(f.execs) != 0 {
		t.Errorf("ran although both slots were covered: %v", f.execs)
	}
}

// @scenario "The runner reports its own telemetry on /metrics and /status"
func TestMetrics(t *testing.T) {
	m := NewMetrics(SidecarRun, time.Unix(1000, 0))
	m.SetRunner(true)
	m.Begin(Full, time.Unix(2000, 0))
	m.Finish(Result{Mode: Full, Outcome: Succeeded, Backup: Backup{Path: "p", Start: time.Unix(2000, 0), End: time.Unix(2090, 0), Bytes: 4096}}, time.Unix(2090, 0))
	m.Begin(Incremental, time.Unix(3000, 0))
	m.Finish(Result{Mode: Incremental, Outcome: Failed, Err: errBoom}, time.Unix(3005, 0))
	m.ObserveSuccess(Incremental, time.Unix(2500, 0))
	m.ObserveSuccess(Full, time.Unix(1500, 0)) // older: ignored

	srv := httptest.NewServer(m.Handler())
	defer srv.Close()
	resp, err := srv.Client().Get(srv.URL + "/metrics")
	if err != nil {
		t.Fatal(err)
	}
	body, _ := io.ReadAll(resp.Body)
	resp.Body.Close()
	for _, want := range []string{
		"clickhouse_backup_runner 1",
		`clickhouse_backup_last_success_timestamp_seconds{mode="full"} 2090`,
		`clickhouse_backup_last_success_timestamp_seconds{mode="incremental"} 2500`,
		`clickhouse_backup_last_attempt_timestamp_seconds{mode="incremental"} 3000`,
		`clickhouse_backup_last_failure_timestamp_seconds{mode="incremental"} 3005`,
		`clickhouse_backup_last_duration_seconds{mode="full"} 90`,
		`clickhouse_backup_last_size_bytes{mode="full"} 4096`,
		`clickhouse_backup_failures_total{mode="incremental"} 1`,
		`clickhouse_backup_failures_total{mode="full"} 0`,
		`clickhouse_backup_in_flight{mode="full"} 0`,
		"clickhouse_backup_sidecar_start_timestamp_seconds 1000",
		"clickhouse_backup_config_error 0",
		"# TYPE clickhouse_backup_failures_total counter",
	} {
		if !strings.Contains(string(body), want) {
			t.Errorf("missing %q in\n%s", want, body)
		}
	}
	resp, err = srv.Client().Get(srv.URL + "/status")
	if err != nil {
		t.Fatal(err)
	}
	body, _ = io.ReadAll(resp.Body)
	resp.Body.Close()
	for _, want := range []string{`"runner": true`, `"last_error": "boom"`, `"state": "run"`} {
		if !strings.Contains(string(body), want) {
			t.Errorf("status missing %s:\n%s", want, body)
		}
	}
}

// @scenario "A bad backup configuration never takes the sidecar down"
func TestConfig(t *testing.T) {
	env := func(kv map[string]string) func(string) string { return func(k string) string { return kv[k] } }

	c, err := LoadConfig(env(map[string]string{"CLICKHOUSE_USER": "default", "CLICKHOUSE_PASSWORD": "pw"}))
	if err != nil || c.Database != "langwatch" || c.RetentionDays != 7 || c.StaleHours != 3 || c.HTTPPort != 8123 || c.Sidecar != SidecarOff {
		t.Errorf("defaults: %+v %v", c, err)
	}
	if _, err := c.Credentials(false); err == nil {
		t.Error("the sidecar accepted a password from the environment")
	}
	if _, err := c.Credentials(true); err != nil {
		t.Errorf("a one-shot command refused CLICKHOUSE_PASSWORD: %v", err)
	}
	if _, err := (Config{PasswordFile: "/x"}).Credentials(false); err == nil {
		t.Error("credentials without a user were accepted")
	}

	for name, value := range map[string]string{
		"BACKUP_MAX_BANDWIDTH": "100; DROP", "BACKUP_DATABASE": "a-b", "BACKUP_SIDECAR": "maybe",
		"BACKUP_FULL_SCHEDULE": "nope", "BACKUP_RETENTION_DAYS": "0", "BACKUP_CLUSTER": "x'y",
	} {
		vars := map[string]string{"BACKUP_SIDECAR": "run", name: value}
		if _, err := LoadConfig(env(vars)); err == nil {
			t.Errorf("%s=%q accepted", name, value)
		}
	}

	// RunSidecar with a bad configuration reports it and waits; it never exits.
	bad, cfgErr := LoadConfig(env(map[string]string{"BACKUP_SIDECAR": "run", "BACKUP_FULL_SCHEDULE": "nope", "BACKUP_METRICS_LISTEN": "127.0.0.1:0"}))
	ctx, cancel := context.WithTimeout(context.Background(), 50*time.Millisecond)
	defer cancel()
	done := make(chan struct{})
	go func() { RunSidecar(ctx, bad, cfgErr, zap.NewNop()); close(done) }()
	select {
	case <-done:
		if ctx.Err() == nil {
			t.Error("RunSidecar returned before its context ended")
		}
	case <-time.After(2 * time.Second):
		t.Error("RunSidecar did not stop with its context")
	}
}

// @scenario "In dynamic-only mode the backup runner logs in as the per-boot local admin"
func TestCredentialsPreferTheLocalAdmin(t *testing.T) {
	dir := t.TempDir()
	env := map[string]string{"CLICKHOUSE_ACCESS_BOOTSTRAP_DIR": dir, "BACKUP_USER": "backup", "BACKUP_PASSWORD_FILE": "/nonexistent"}
	get := func(k string) string { return env[k] }

	c, _ := LoadConfig(get)
	creds, err := c.Credentials(false)
	if err != nil {
		t.Fatal(err)
	}
	if _, ok := creds.(chclient.PasswordFile); !ok {
		t.Errorf("without a bootstrap password: %T, want the password file", creds)
	}

	first, err := bootstrap.Generate(dir)
	if err != nil {
		t.Fatal(err)
	}
	creds, err = c.Credentials(false)
	if err != nil {
		t.Fatal(err)
	}
	user, pw, err := creds.Login()
	if err != nil || user != bootstrap.User || pw != first.Password {
		t.Errorf("login = %s/%v, want the local admin", user, err)
	}
	second, _ := bootstrap.Generate(dir) // a server restart
	if _, pw, _ := creds.Login(); pw != second.Password {
		t.Error("the local admin password is not re-read after a restart")
	}

	// The local admin is loopback-only, so a remote host keeps the file login.
	env["CLICKHOUSE_HOST"] = "ch-0.ch-headless"
	c, _ = LoadConfig(get)
	creds, _ = c.Credentials(false)
	if _, ok := creds.(chclient.PasswordFile); !ok {
		t.Errorf("remote host: %T, want the password file", creds)
	}
}
