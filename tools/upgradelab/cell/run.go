package cell

import (
	"context"
	_ "embed"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"github.com/langwatch/langwatch/tools/upgradelab/generate"
	"github.com/langwatch/langwatch/tools/upgradelab/seed"
	"github.com/langwatch/langwatch/tools/upgradelab/snapshot"
)

//go:embed ops-upgrades.mjs
var opsScript []byte

// Options are one cell: deployment x tier x shape, the two release checkouts and the time budget.
type Options struct {
	Deployment, Tier, Shape, Release string
	Seed                             int64
	FromDir, HeadDir, RunDir         string
	PostgresBase, ClickHouseBase     string
	Before, AtCut, AfterReady        time.Duration // traffic on main, with main's worker paused, after head is ready
	ReadyWithin, SettleWithin        time.Duration
	WorkerDelay, Rate, Hold          time.Duration
	Keep, Shots                      bool
}

// run is one cell in flight: its stores, processes, traffic and what it measured.
type run struct {
	options Options
	profile Profile
	stores  Stores
	env     map[string]string
	apiPort int
	origin  time.Time
	procs   []*Proc
	report  *Report
	seeder  *seed.Seeder
	client  Client
	before  snapshot.Fingerprint
	traffic *Traffic
	poller  *Poller
	queue   []QueueSample
	queueMu sync.Mutex
	marks   map[string]int64
	shotsWG sync.WaitGroup
	atReady []LedgerRow
	private map[string]string // label -> organization on that private ClickHouse target
	tenancy seed.Tenancy

	stopTraffic, stopPoller context.CancelFunc
	trafficDone             chan struct{}
}

// Name is the cell's store suffix and report id, e.g. cloud_s_typical_1.
func (options Options) Name() string {
	return strings.ToLower(strings.ReplaceAll(fmt.Sprintf("%s_%s_%s_%d", options.Deployment, options.Tier, options.Shape, options.Seed), "-", "_"))
}

// Run executes the cell and writes report.json and report.md into RunDir; the error is operational only.
func Run(ctx context.Context, options Options) (*Report, error) {
	cell, err := prepare(options)
	if err != nil {
		return nil, err
	}
	defer cell.teardown()
	steps := []struct {
		name string
		do   func(context.Context) error
	}{
		{"stores", cell.freshStores}, {"from-schema", cell.fromSchema}, {"from-up", cell.fromUp}, {"seed", cell.seed},
		{"traffic-before", cell.trafficBefore}, {"cut", cell.cut}, {"switch", cell.switchToHead}, {"ready", cell.awaitReady},
		{"settle", cell.settle}, {"checks", cell.checks},
	}
	for _, step := range steps {
		started := time.Now()
		err := step.do(ctx)
		cell.report.Timings = append(cell.report.Timings, Timing{Step: step.name, Ms: time.Since(started).Milliseconds()})
		if err != nil {
			cell.report.Error = fmt.Sprintf("step %s: %v", step.name, err)
			break
		}
	}
	cell.finishTraffic()
	return cell.report, cell.write()
}

func prepare(options Options) (*run, error) {
	profile, ok := Profiles[options.Deployment]
	switch {
	case !ok:
		return nil, fmt.Errorf("unknown deployment %q: want cloud, hybrid or self-hosted", options.Deployment)
	case profile.Missing != "":
		return nil, fmt.Errorf("deployment %s cannot run yet: %s", options.Deployment, profile.Missing)
	case !contains(Tiers, options.Tier) || !contains(DataShapes, options.Shape):
		return nil, fmt.Errorf("tier %q shape %q: only %v x %v so far", options.Tier, options.Shape, Tiers, DataShapes)
	}
	for _, dir := range []string{options.FromDir, options.HeadDir} {
		if err := CheckSourceDir(dir); err != nil {
			return nil, err
		}
	}
	if err := os.MkdirAll(filepath.Join(options.RunDir, "shots"), 0o750); err != nil {
		return nil, err
	}
	cell := &run{options: options, profile: profile, origin: time.Now(), marks: map[string]int64{}}
	cell.report = &Report{Cell: options.Name(), Deployment: options.Deployment, Tier: options.Tier, Shape: options.Shape,
		Release: options.Release, Head: options.HeadDir, Started: cell.origin.UTC().Format(time.RFC3339)}
	return cell, nil
}

func contains(values []string, value string) bool {
	for _, each := range values {
		if each == value {
			return true
		}
	}
	return false
}

func (cell *run) mark(name string) { cell.marks[name] = time.Since(cell.origin).Milliseconds() }

func (cell *run) logPath(name string) string { return filepath.Join(cell.options.RunDir, name+".log") }

func (cell *run) freshStores(ctx context.Context) error {
	redisPort, err := FreePort()
	if err != nil {
		return err
	}
	cell.stores = Stores{PostgresBase: cell.options.PostgresBase, ClickHouseBase: cell.options.ClickHouseBase,
		Name: DedicatedPrefix + cell.options.Name(), RedisPort: itoa(redisPort)}
	shape, err := seed.LoadShapeEnv(cell.profile.Shape)
	if err != nil {
		return err
	}
	cell.private = shape.PrivateTargets()
	for label := range cell.private {
		cell.stores.Private = append(cell.stores.Private, label)
	}
	if err := cell.stores.Fresh(ctx); err != nil {
		return err
	}
	redis, err := Start(ProcSpec{Name: "redis", Dir: cell.options.RunDir, Log: cell.logPath("redis"),
		Args: []string{"redis-server", "--port", cell.stores.RedisPort, "--save", "", "--appendonly", "no"}, Env: Env(map[string]string{"PATH": os.Getenv("PATH")})})
	if err != nil {
		return err
	}
	cell.procs = append(cell.procs, redis)
	if cell.apiPort, err = apiPort(); err != nil {
		return err
	}
	email, _ := generate.SeedAccount(cell.options.Seed)
	cell.env, err = BuildEnv(EnvInput{Profile: cell.profile, Stores: cell.stores, APIPort: cell.apiPort, Admin: email})
	return err
}

// apiPort is the one public port both releases serve on; main's dev server binds PORT+1000.
func apiPort() (int, error) {
	for range 20 {
		port, err := FreePort()
		if err != nil {
			return 0, err
		}
		if port > 2024 && port < 65000 {
			return port, nil
		}
	}
	return 0, errors.New("no usable free port")
}

func (cell *run) url() string { return "http://127.0.0.1:" + itoa(cell.apiPort) }

func (cell *run) envWith(extra map[string]string) []string {
	merged := map[string]string{}
	for key, value := range cell.env {
		merged[key] = value
	}
	for key, value := range extra {
		merged[key] = value
	}
	return Env(merged)
}

// fromSchema migrates the stores as the old release does before it serves (main: start:prepare:db).
func (cell *run) fromSchema(ctx context.Context) error {
	command := exec.CommandContext(ctx, "pnpm", "-s", "run", "start:prepare:db") // #nosec G204 -- fixed argv.
	command.Dir, command.Env = filepath.Join(cell.options.FromDir, "platform/app"), cell.envWith(nil)
	out, err := command.CombinedOutput()
	_ = os.WriteFile(cell.logPath("from-schema"), out, 0o600)
	if err != nil {
		return fmt.Errorf("old release start:prepare:db: %w: %s", err, tail(out))
	}
	return nil
}

func (cell *run) fromUp(ctx context.Context) error {
	dir := filepath.Join(cell.options.FromDir, "platform/app")
	base := map[string]string{"PORT": itoa(cell.apiPort - 1000)}
	worker := map[string]string{"PORT": itoa(cell.apiPort - 1000), "WORKER_METRICS_PORT": itoa(mustPort())}
	for _, spec := range []ProcSpec{
		{Name: "from-app", Args: []string{"pnpm", "-s", "run", "runtime:app:dev"}, Env: cell.envWith(base)},
		{Name: "from-worker", Args: []string{"pnpm", "-s", "run", "runtime:workers:dev"}, Env: cell.envWith(worker)},
	} {
		spec.Dir, spec.Log = dir, cell.logPath(spec.Name)
		proc, err := Start(spec)
		if err != nil {
			return err
		}
		cell.procs = append(cell.procs, proc)
	}
	return waitFor(ctx, cell.options.ReadyWithin, func() bool {
		status, _, err := get(ctx, httpClient, cell.url()+"/api/health", "")
		return err == nil && status/100 == 2
	})
}

func mustPort() int {
	port, _ := FreePort()
	return port
}

// waitFor polls until done answers true, ctx ends or within passes.
func waitFor(ctx context.Context, within time.Duration, done func() bool) error {
	deadline := time.Now().Add(within)
	for !done() {
		if time.Now().After(deadline) {
			return fmt.Errorf("not reached within %s", within)
		}
		select {
		case <-ctx.Done():
			return ctx.Err()
		case <-time.After(time.Second):
		}
	}
	return nil
}

// seed writes the tenancy at the old schema, the seed account, every product kind and a base prompt.
func (cell *run) seed(ctx context.Context) error {
	plan, err := generate.Build(generate.Request{Shape: cell.profile.Shape, Release: cell.options.Release, Volume: cell.options.Tier,
		Seed: cell.options.Seed, Anchor: time.Now().UTC().Truncate(24 * time.Hour)})
	if err != nil {
		return err
	}
	cell.tenancy = plan.Tenancy
	if err := psqlFile(ctx, cell.stores.psqlURL(), plan.TenancyS); err != nil {
		return fmt.Errorf("tenancy: %w", err)
	}
	if err := psqlFile(ctx, cell.stores.psqlURL(), generate.AccountSQL(cell.options.Seed)); err != nil {
		return fmt.Errorf("seed account: %w", err)
	}
	email, password := generate.SeedAccount(cell.options.Seed)
	cell.seeder = seed.NewSeeder(seed.ProductInput{AppURL: cell.url(), Email: email, Password: password, Label: cell.options.Name()})
	if err := cell.seeder.Seed(ctx); err != nil {
		cell.report.Notes = append(cell.report.Notes, "product seeds: "+err.Error())
	}
	cell.client = Client{URL: cell.url(), APIKey: cell.seeder.Context.APIKey, Project: cell.seeder.Context.ProjectID,
		Session: cell.seeder.Session(), Seed: cell.options.Seed, BasePrompt: "upgradelab-base"}
	if cell.client.APIKey == "" {
		return errors.New("the seed project has no API key: product seeds never reached it")
	}
	if err := cell.basePrompt(ctx); err != nil {
		cell.report.Notes = append(cell.report.Notes, "base prompt (prompt-update writes to it): "+err.Error())
	}
	return nil
}

func (cell *run) basePrompt(ctx context.Context) error {
	request, err := post(ctx, cell.client, "/api/prompts", map[string]any{"handle": cell.client.BasePrompt, "prompt": "base"})
	if err != nil {
		return err
	}
	response, err := httpClient.Do(request)
	if err != nil {
		return err
	}
	defer func() { _ = response.Body.Close() }()
	if response.StatusCode/100 != 2 {
		body, _ := io.ReadAll(io.LimitReader(response.Body, 600))
		return fmt.Errorf("POST /api/prompts answered %d: %s", response.StatusCode, body)
	}
	return nil
}

// trafficBefore starts the mix and the samplers on main, and lets it run.
func (cell *run) trafficBefore(ctx context.Context) error {
	cell.traffic = &Traffic{Client: cell.client, Kinds: Mix(cell.options.Rate), Origin: cell.origin, Hold: cell.options.Hold}
	trafficCtx, stop := context.WithCancel(context.WithoutCancel(ctx))
	cell.stopTraffic = stop
	cell.trafficDone = make(chan struct{})
	go func() {
		cell.traffic.Run(trafficCtx)
		close(cell.trafficDone)
	}()
	go cell.sampleQueue(trafficCtx)
	cell.mark("trafficStart")
	return sleep(ctx, cell.options.Before)
}

func sleep(ctx context.Context, span time.Duration) error {
	select {
	case <-ctx.Done():
		return ctx.Err()
	case <-time.After(span):
		return nil
	}
}

func (cell *run) sampleQueue(ctx context.Context) {
	for {
		if depth, err := QueueDepth(ctx, cell.stores.RedisPort); err == nil {
			cell.queueMu.Lock()
			cell.queue = append(cell.queue, QueueSample{AtMs: time.Since(cell.origin).Milliseconds(), Depth: depth})
			cell.queueMu.Unlock()
		}
		if sleep(ctx, 2*time.Second) != nil {
			return
		}
	}
}

// cut pauses main's worker so jobs queue, as a deploy's first stopped process leaves them, and fingerprints.
func (cell *run) cut(ctx context.Context) error {
	cell.proc("from-worker").Signal(sigStop)
	cell.mark("fromWorkerPaused")
	if err := sleep(ctx, cell.options.AtCut); err != nil {
		return err
	}
	fingerprint, err := cell.fingerprint(ctx)
	cell.before = fingerprint
	return err
}

func (cell *run) fingerprint(ctx context.Context) (snapshot.Fingerprint, error) {
	postgres, err := snapshot.NewPostgresCLI(cell.stores.DatabaseURL())
	if err != nil {
		return nil, err
	}
	clickhouse, err := snapshot.NewClickHouseHTTP(cell.stores.ClickHouseURL(""))
	if err != nil {
		return nil, err
	}
	return snapshot.TakeFingerprint(ctx, snapshot.Stores{Postgres: postgres, ClickHouse: map[string]snapshot.ClickHouse{"shared": clickhouse}})
}

func (cell *run) proc(name string) *Proc {
	for _, proc := range cell.procs {
		if proc.Name == name {
			return proc
		}
	}
	return &Proc{Name: name}
}

// switchToHead stops main and starts head's api, then its worker after WorkerDelay (api first).
func (cell *run) switchToHead(ctx context.Context) error {
	cell.poller = &Poller{URL: cell.url(), Origin: cell.origin, Every: 500 * time.Millisecond, Notify: make(chan string, 8)}
	go cell.poller.Run(cell.pollerCtx(ctx))
	if cell.options.Shots {
		go cell.shootPhases(ctx)
	}
	cell.proc("from-app").Stop(20 * time.Second)
	cell.proc("from-worker").Stop(20 * time.Second)
	cell.mark("fromStopped")
	if err := cell.startHead("head-api", "apps/api", map[string]string{"API_PORT": itoa(cell.apiPort), "OTEL_EXPORTER_PROMETHEUS_PORT": itoa(mustPort())}); err != nil {
		return err
	}
	cell.mark("headApiStarted")
	if err := sleep(ctx, cell.options.WorkerDelay); err != nil {
		return err
	}
	cell.mark("headWorkerStarted")
	return cell.startHead("head-worker", "apps/worker", map[string]string{"WORKER_METRICS_PORT": itoa(mustPort()), "OTEL_EXPORTER_PROMETHEUS_PORT": itoa(mustPort())})
}

func (cell *run) pollerCtx(ctx context.Context) context.Context {
	pollCtx, stop := context.WithCancel(context.WithoutCancel(ctx))
	cell.stopPoller = stop
	return pollCtx
}

func (cell *run) startHead(name, app string, extra map[string]string) error {
	proc, err := Start(ProcSpec{Name: name, Dir: filepath.Join(cell.options.HeadDir, app), Log: cell.logPath(name),
		Args: []string{"node", "--experimental-transform-types", "src/main.ts"}, Env: cell.envWith(extra)})
	if err == nil {
		cell.procs = append(cell.procs, proc)
	}
	return err
}

func (cell *run) awaitReady(ctx context.Context) error {
	err := waitFor(ctx, cell.options.ReadyWithin, func() bool {
		return FirstAt(cell.poller.Timeline(), "ready") >= 0 || cell.headDied()
	})
	if err != nil || cell.headDied() {
		return errors.Join(err, cell.deathNote())
	}
	cell.mark("ready")
	ledger, err := Ledger(ctx, cell.stores)
	cell.atReady = ledger
	if err != nil {
		return err
	}
	return sleep(ctx, cell.options.AfterReady)
}

func (cell *run) headDied() bool {
	for _, name := range []string{"head-api", "head-worker"} {
		if exited, _ := cell.proc(name).Exited(); exited && cell.proc(name).command != nil {
			return true
		}
	}
	return false
}

func (cell *run) deathNote() error {
	for _, name := range []string{"head-api", "head-worker"} {
		if exited, err := cell.proc(name).Exited(); exited && cell.proc(name).command != nil {
			return fmt.Errorf("%s exited (%v); see %s", name, err, cell.logPath(name))
		}
	}
	return nil
}

// settle stops the traffic and waits until the ledger has nothing outstanding and the queues drained.
func (cell *run) settle(ctx context.Context) error {
	cell.finishTraffic()
	cell.mark("trafficStopped")
	return waitFor(ctx, cell.options.SettleWithin, func() bool {
		rows, err := Ledger(ctx, cell.stores)
		depth, depthErr := QueueDepth(ctx, cell.stores.RedisPort)
		return err == nil && depthErr == nil && len(rows) > 0 && len(Outstanding(rows)) == 0 && depth == 0
	})
}

func (cell *run) finishTraffic() {
	if cell.stopTraffic == nil {
		return
	}
	cell.stopTraffic()
	cell.stopTraffic = nil
	<-cell.trafficDone
}

func (cell *run) teardown() {
	if cell.stopPoller != nil {
		cell.stopPoller()
	}
	cell.shotsWG.Wait()
	for index := len(cell.procs) - 1; index >= 0; index-- {
		cell.procs[index].Stop(15 * time.Second)
	}
	if !cell.options.Keep && cell.stores.Name != "" && cell.report.Error == "" {
		_ = cell.stores.Drop(context.Background())
	}
}

// shootPhases screenshots each phase the poller sees, and Ops > Upgrades once signing in can work.
func (cell *run) shootPhases(ctx context.Context) {
	cell.shotsWG.Add(1)
	defer cell.shotsWG.Done()
	for {
		select {
		case <-ctx.Done():
			return
		case phase, open := <-cell.poller.Notify:
			if !open {
				return
			}
			cell.shoot(ctx, phase)
		}
	}
}

func (cell *run) shoot(ctx context.Context, phase string) {
	signIn := phase == "holding:upgrading" || phase == "ready" || phase == "settled"
	if phase == "down" {
		return
	}
	email, password := generate.SeedAccount(cell.options.Seed)
	name := strings.NewReplacer(":", "-", "/", "-").Replace(phase) + ".png"
	out := filepath.Join(cell.options.RunDir, "shots", name)
	args, _ := json.Marshal(map[string]any{"url": cell.url(), "email": email, "password": password, "out": out, "signIn": signIn})
	script := filepath.Join(cell.options.RunDir, "ops-upgrades.mjs")
	if err := os.WriteFile(script, opsScript, 0o600); err != nil {
		return
	}
	shotCtx, cancel := context.WithTimeout(ctx, 90*time.Second)
	defer cancel()
	command := exec.CommandContext(shotCtx, "node", script, string(args)) // #nosec G204 -- harness-written script.
	command.Dir = filepath.Join(cell.options.HeadDir, "apps/ui")
	output, err := command.Output()
	shot := Shot{Phase: phase, AtMs: time.Since(cell.origin).Milliseconds(), File: filepath.Join("shots", name)}
	var page struct{ URL, Text string }
	if err != nil || json.Unmarshal(output, &page) != nil {
		shot.Error = fmt.Sprint(err)
	}
	shot.URL, shot.State = page.URL, OpsState(page.Text)
	cell.addShot(shot)
}

func (cell *run) addShot(shot Shot) {
	cell.queueMu.Lock()
	defer cell.queueMu.Unlock()
	cell.report.Shots = append(cell.report.Shots, shot)
}

// OpsState is which of the Upgrades page's eight states the text shows, or "".
func OpsState(text string) string {
	for _, state := range []string{"Up to date", "Finishing in background", "Behind", "Never upgraded", "Upgrading", "Rolled back", "Needs attention", "Unsupported"} {
		if strings.Contains(text, state) {
			return state
		}
	}
	if strings.Contains(text, "LangWatch is upgrading") {
		return "holding page"
	}
	return ""
}

func (cell *run) write() error {
	data, err := json.MarshalIndent(cell.report, "", "  ")
	if err != nil {
		return err
	}
	if err := os.WriteFile(filepath.Join(cell.options.RunDir, "report.json"), data, 0o600); err != nil {
		return err
	}
	return os.WriteFile(filepath.Join(cell.options.RunDir, "report.md"), []byte(cell.report.Markdown()), 0o600)
}

var httpClient = newHTTPClient()
