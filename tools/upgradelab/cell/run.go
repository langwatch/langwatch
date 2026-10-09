package cell

import (
	"context"
	_ "embed"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"maps"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"slices"
	"strconv"
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
	SwitchOn, ServiceBin             string
	Drills                           []string // DrillAPIEarly, DrillWorkerRestart, DrillRetry
	Ledger                           []string // #8553 rows this cell claims and reports to
	FromSnapshot                     string   // a produce entry directory or cache key: restore instead of seeding
	MaxLoad                          float64  // refuse to start above this 1-minute load average
	TestedBy                         string   // who runs the cell, for the ledger's Tested by (lane:<id> (model) or @handle)
	Keep, Shots                      bool
	Stdout                           io.Writer // where the live origin lines go; nil prints nothing
}

// run is one cell in flight: its stores, processes, traffic and what it measured.
type run struct {
	options            Options
	profile            Profile
	stores             Stores
	env                map[string]string
	apiPort            int
	origin             time.Time
	procs              []*Proc
	procsMu            sync.Mutex // the resource sampler reads procs while the cell starts and stops them
	walker             *Walker
	sampleStop         context.CancelFunc
	report             *Report
	seeder             *seed.Seeder
	client             Client
	before             snapshot.Fingerprint
	traffic            *Traffic
	privateTraffic     *Traffic // a private organization's project (hybrid), on privateLabel's stores
	privateLabel       string
	drills             drillState
	poller             *Poller
	queue              []QueueSample
	queueMu            sync.Mutex
	marks              map[string]int64
	shotsWG            sync.WaitGroup
	atReady            []LedgerRow
	ledgerBefore       map[string]string // each -ledger row as it was before the claim
	balancer           *Balancer
	fromPort, headPort int
	private            map[string]string // label -> organization on that private ClickHouse target
	tenancy            seed.Tenancy
	apiCrashes         []int64       // ms from start of each head api exit before ready
	granted            chan struct{} // closed once the seed account is a platform operator on head
	recipe             snapshot.Recipe
	anchor             time.Time

	stopTraffic, stopPoller, stopSampler context.CancelFunc
	trafficDone                          chan struct{}
}

// Name is the cell's store suffix and report id, e.g. cloud_s_typical_1.
func (options Options) Name() string {
	return strings.ToLower(strings.ReplaceAll(fmt.Sprintf("%s_%s_%s_%d", options.Deployment, options.Tier, options.Shape, options.Seed), "-", "_"))
}

// Run executes the cell and writes report.json and report.md into RunDir; the error is operational only.
func Run(ctx context.Context, options Options) (*Report, error) {
	if load := oneMinuteLoad(); options.MaxLoad > 0 && load > options.MaxLoad {
		return nil, fmt.Errorf("machine load %.0f is above -max-load %.0f: a loaded host voids a cell's timings, so it does not start", load, options.MaxLoad)
	}
	cell, err := prepare(options)
	if err != nil {
		return nil, err
	}
	defer cell.teardown()
	cell.claimLedger(ctx)
	cell.noteLoad("start")
	origin := []step{{"stores", cell.freshStores}, {"from-schema", cell.fromSchema}, {"from-up", cell.fromUp}, {"seed", cell.seed}}
	if options.FromSnapshot != "" {
		origin = []step{{"stores", cell.freshStores}, {"restore", cell.restore}, {"from-up", cell.fromUp}, {"sign-in", cell.resumeSeed}}
	}
	cell.runSteps(ctx, slices.Concat([]step{{"build", cell.buildBoth}}, origin, []step{
		{"traffic-before", cell.trafficBefore}, {"cut", cell.cut}, {"switch", cell.switchToHead}, {"ready", cell.awaitReady},
		{"settle", cell.settle}, {"drill-retry", cell.retryFailedStep}, {"checks", func(ctx context.Context) error {
			cell.stopObservers()
			return cell.checks(ctx)
		}},
	}))
	cell.finishTraffic()
	cell.partialTraffic()
	cell.noteLoad("end")
	cell.reportLedger(ctx)
	return cell.report, cell.write()
}

type step struct {
	name string
	do   func(context.Context) error
}

// runSteps runs each step in order, timing it, and stops at the first error into the report.
func (cell *run) runSteps(ctx context.Context, steps []step) {
	for _, step := range steps {
		started := time.Now()
		err := step.do(ctx)
		cell.report.Timings = append(cell.report.Timings, Timing{Step: step.name, Ms: time.Since(started).Milliseconds()})
		if err != nil {
			cell.report.Error = fmt.Sprintf("step %s: %v", step.name, err)
			return
		}
	}
}

// buildBoth builds each release as it ships, once per commit (ruling 2026-10-10: built code only).
func (cell *run) buildBoth(ctx context.Context) error {
	if err := FromBuild(cell.options.FromDir).Ensure(ctx, cell.logPath("from-build")); err != nil {
		return err
	}
	return HeadBuild(cell.options.HeadDir).Ensure(ctx, cell.logPath("head-build"))
}

// announce prints the public origin and the seed account (never its password) so a person can watch live.
func (cell *run) announce(when string) {
	if cell.options.Stdout == nil {
		return
	}
	email, _ := generate.SeedAccount(cell.options.Seed)
	fmt.Fprintf(cell.options.Stdout, "upgradelab: %s: open %s and sign in as %s for Ops > Upgrades\n", when, cell.url(), email)
}

// partialTraffic keeps what a stopped cell measured: calls and phases, writes unchecked.
func (cell *run) partialTraffic() {
	if cell.report.Traffic != nil || cell.traffic == nil {
		return
	}
	cell.report.Marks = cell.marks
	if cell.poller != nil {
		cell.report.Phases = cell.poller.Timeline()
	}
	cell.report.Traffic, cell.report.Timeline = Summarize(cell.allCalls(), ServedTimeline(cell.report.Phases, cell.marks["switched"]), nil)
	cell.report.Notes = append(cell.report.Notes, "stopped early: writes were not checked, so Lost counts every 2xx write")
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
	cell := &run{options: options, profile: profile, origin: time.Now(), marks: map[string]int64{}, granted: make(chan struct{})}
	cell.report = &Report{Cell: options.Name(), Deployment: options.Deployment, Tier: options.Tier, Shape: options.Shape,
		Release: options.Release, Head: options.HeadDir, HeadCommit: HeadCommit(options.HeadDir), Started: cell.origin.UTC().Format(time.RFC3339)}
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
	if cell.profile.Objects {
		if err := cell.startObjectStores(slices.Collect(maps.Keys(shape.PrivateObjectTargets()))); err != nil {
			return err
		}
	}
	redis, err := Start(ProcSpec{Name: "redis", Dir: cell.options.RunDir, Log: cell.logPath("redis"),
		Args: []string{"redis-server", "--port", cell.stores.RedisPort, "--save", "", "--appendonly", "no"}, Env: Env(map[string]string{"PATH": os.Getenv("PATH")})})
	if err != nil {
		return err
	}
	cell.addProc(redis)
	if err := cell.ports(); err != nil {
		return err
	}
	if cell.balancer, err = StartBalancer(cell.apiPort); err != nil {
		return err
	}
	email, _ := generate.SeedAccount(cell.options.Seed)
	cell.env, err = BuildEnv(EnvInput{Profile: cell.profile, Stores: cell.stores, APIPort: cell.apiPort, Admin: email})
	return err
}

// ports picks the balancer's public port and one per release; main's production server binds PORT.
func (cell *run) ports() error {
	for _, port := range []*int{&cell.apiPort, &cell.fromPort, &cell.headPort} {
		value, err := apiPort()
		if err != nil {
			return err
		}
		*port = value
	}
	return nil
}

func apiPort() (int, error) {
	for range 1000 { // macOS hands out ephemeral ports in sequence: up to 535 in a row sit above 65000
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

// url is the balancer: what every client, the seed and the screenshots speak to.
func (cell *run) url() string { return "http://127.0.0.1:" + itoa(cell.apiPort) }

func (cell *run) fromURL() string { return "http://127.0.0.1:" + itoa(cell.fromPort) }

func (cell *run) headURL() string { return "http://127.0.0.1:" + itoa(cell.headPort) }

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

// fromSchema migrates the stores as the old release does before it serves (main: FromStartup).
func (cell *run) fromSchema(ctx context.Context) error {
	var log []byte
	defer func() { _ = os.WriteFile(cell.logPath("from-schema"), log, 0o600) }()
	for _, script := range FromStartup {
		command := exec.CommandContext(ctx, "pnpm", append([]string{"-s", "run"}, script...)...) // #nosec G204 -- fixed argv.
		command.Dir, command.Env = filepath.Join(cell.options.FromDir, "platform", "app"), cell.envWith(nil)
		out, err := command.CombinedOutput()
		log = append(log, out...)
		if err != nil {
			return fmt.Errorf("old release %s: %w: %s", strings.Join(script, " "), err, tail(out))
		}
	}
	return nil
}

func (cell *run) fromUp(ctx context.Context) error {
	dir := filepath.Join(cell.options.FromDir, "platform", "app")
	base := map[string]string{"PORT": itoa(cell.fromPort)}
	worker := map[string]string{"PORT": itoa(cell.fromPort), "WORKER_METRICS_PORT": itoa(mustPort())}
	for _, spec := range []ProcSpec{
		{Name: "from-app", Args: FromAppArgs, Env: cell.envWith(base)},
		{Name: "from-worker", Args: FromWorkerArgs, Env: cell.envWith(worker)},
	} {
		spec.Dir, spec.Log = dir, cell.logPath(spec.Name)
		proc, err := Start(spec)
		if err != nil {
			return err
		}
		cell.addProc(proc)
	}
	err := waitFor(ctx, cell.options.ReadyWithin, func() bool {
		status, _, err := get(ctx, httpClient, cell.fromURL()+"/api/health")
		return err == nil && status/100 == 2
	})
	if err != nil {
		return err
	}
	if err := cell.balancer.Switch(cell.fromURL()); err != nil {
		return err
	}
	cell.announce("main is up")
	return nil
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
	cell.anchor = time.Now().UTC().Truncate(24 * time.Hour)
	plan, err := generate.Build(generate.Request{Shape: cell.profile.Shape, Release: cell.options.Release, Volume: cell.options.Tier,
		Seed: cell.options.Seed, Anchor: cell.anchor})
	if err != nil {
		return err
	}
	cell.tenancy, cell.recipe = plan.Tenancy, snapshot.Recipe{Version: seed.RecipeVersion, Hash: plan.Digest()}
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
	if err := cell.useSeed(cell.seeder.Session()); err != nil {
		return err
	}
	if err := cell.basePrompt(ctx); err != nil {
		cell.report.Notes = append(cell.report.Notes, "base prompt (prompt-update writes to it): "+err.Error())
	}
	return nil
}

// useSeed points the cell's clients at the seed project, from a fresh seed or a restored one.
func (cell *run) useSeed(session http.Header) error {
	cell.client = Client{URL: cell.url(), APIKey: cell.seeder.Context.APIKey, Project: cell.seeder.Context.ProjectID,
		Session: session, Seed: cell.options.Seed, BasePrompt: "upgradelab-base"}
	if cell.client.APIKey == "" {
		return errors.New("the seed project has no API key: product seeds never reached it")
	}
	if private, label, ok := cell.privateClient(); ok {
		cell.privateTraffic, cell.privateLabel = &Traffic{Client: private, Kinds: PrivateMix(cell.options.Rate), Origin: cell.origin, Hold: cell.options.Hold}, label
	}
	return nil
}

func (cell *run) basePrompt(ctx context.Context) error {
	request, err := cell.client.post(ctx, "/api/prompts", map[string]any{"handle": cell.client.BasePrompt, "prompt": "base", "model": "openai/gpt-5"})
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
	cell.traffic = &Traffic{Client: cell.client, Kinds: Mix(cell.options.Rate), Origin: cell.origin, Hold: cell.options.Hold, RetryUnanswered: cell.profile.StopStart}
	trafficCtx, stop := context.WithCancel(context.WithoutCancel(ctx))
	cell.stopTraffic = stop
	cell.trafficDone = make(chan struct{})
	go func() {
		var private sync.WaitGroup
		if cell.privateTraffic != nil {
			private.Go(func() { cell.privateTraffic.Run(trafficCtx) })
		}
		cell.traffic.Run(trafficCtx)
		private.Wait()
		close(cell.trafficDone)
	}()
	samplerCtx, stopSampler := context.WithCancel(context.WithoutCancel(ctx)) // outlives traffic: N4 needs samples until settled
	cell.stopSampler = stopSampler
	go cell.sampleQueue(samplerCtx)
	cell.startObservers(ctx)
	cell.mark("trafficStart")
	return sleep(ctx, cell.options.Before)
}

// allCalls is every call the cell's traffic sent, the private project's included.
func (cell *run) allCalls() []Call {
	if cell.privateTraffic == nil {
		return cell.traffic.Calls()
	}
	return append(cell.traffic.Calls(), cell.privateTraffic.Calls()...)
}

func sleep(ctx context.Context, span time.Duration) error {
	select {
	case <-ctx.Done():
		return ctx.Err()
	case <-time.After(span):
		return nil
	}
}

func (cell *run) sampleQueueOnce(ctx context.Context) {
	if depth, err := QueueDepth(ctx, cell.stores.RedisPort); err == nil {
		cell.queueMu.Lock()
		cell.queue = append(cell.queue, QueueSample{AtMs: time.Since(cell.origin).Milliseconds(), Depth: depth})
		cell.queueMu.Unlock()
	}
}

func (cell *run) sampleQueue(ctx context.Context) {
	for {
		cell.sampleQueueOnce(ctx)
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

func (cell *run) addProc(proc *Proc) {
	cell.procsMu.Lock()
	defer cell.procsMu.Unlock()
	cell.procs = append(cell.procs, proc)
}

// procList is a copy of procs, safe to range while another goroutine starts or stops one.
func (cell *run) procList() []*Proc {
	cell.procsMu.Lock()
	defer cell.procsMu.Unlock()
	return slices.Clone(cell.procs)
}

// startObservers starts the resource sampler and, with shots, the browser walker (W3).
func (cell *run) startObservers(ctx context.Context) {
	sampleCtx, stop := context.WithCancel(ctx)
	cell.sampleStop = stop
	go SampleResources(sampleCtx, SampleSpec{Path: filepath.Join(cell.options.RunDir, "resources.jsonl"), Origin: cell.origin,
		Every: 5 * time.Second, Procs: cell.procList, ClickHouseBase: cell.stores.ClickHouseBase, RedisPort: cell.stores.RedisPort})
	if cell.options.Shots {
		email, password := generate.SeedAccount(cell.options.Seed)
		cell.walker, _ = StartWalker(ctx, WalkSpec{Dir: filepath.Join(cell.options.HeadDir, "apps", "ui"), RunDir: cell.options.RunDir,
			URL: cell.url(), Email: email, Password: password, Origin: cell.origin, Every: 10 * time.Second})
	}
}

// stopObservers is safe to call twice: before the checks and again in teardown.
func (cell *run) stopObservers() {
	if cell.sampleStop != nil {
		cell.sampleStop()
	}
	if cell.walker != nil {
		cell.walker.Stop(30 * time.Second)
	}
}

func (cell *run) proc(name string) *Proc {
	for _, proc := range cell.procList() {
		if proc.Name == name {
			return proc
		}
	}
	return &Proc{Name: name}
}

// switchToHead deploys head. Rolling (cloud, hybrid): head's api starts beside the old release, its
// worker WorkerDelay later, the balancer switches once head answers SwitchOn, then the old release
// stops. Stop-start (single-instance self-hosted): the old release stops first.
func (cell *run) switchToHead(ctx context.Context) error {
	cell.announce("switching to head")
	cell.poller = &Poller{URL: cell.headURL(), Origin: cell.origin, Every: 500 * time.Millisecond, Notify: make(chan string, 8),
		PhaseFile: filepath.Join(cell.options.RunDir, "phase.txt")}
	watchCtx := cell.pollerCtx(ctx)
	go cell.poller.Run(watchCtx)
	if cell.options.Shots {
		cell.shotsWG.Add(1)
		go cell.shootPhases(watchCtx)
	}
	if cell.profile.StopStart {
		cell.stopFrom()
		if err := cell.balancer.Switch(cell.headURL()); err != nil {
			return err
		}
		cell.mark("switched")
	}
	if err := cell.startHeadAPI(); err != nil {
		return err
	}
	cell.mark("headApiStarted")
	if err := sleep(ctx, cell.options.WorkerDelay); err != nil {
		return err
	}
	cell.proc("from-worker").Stop(20 * time.Second)
	cell.mark("headWorkerStarted")
	if err := cell.startHeadWorker(); err != nil {
		return err
	}
	if cell.profile.StopStart {
		return nil
	}
	return cell.rollOver(ctx)
}

// rollOver switches the balancer once head answers SwitchOn, then stops the old release.
func (cell *run) rollOver(ctx context.Context) error {
	err := waitFor(ctx, cell.options.ReadyWithin, func() bool {
		cell.reviveAPI()
		cell.restartWorkerMidUpgrade(ctx)
		status, _, err := get(ctx, httpClient, cell.headURL()+cell.options.SwitchOn)
		return (err == nil && status/100 == 2) || cell.headDied()
	})
	if err != nil || cell.headDied() {
		return errors.Join(err, cell.deathNote())
	}
	if err := cell.balancer.Switch(cell.headURL()); err != nil {
		return err
	}
	cell.mark("switched")
	cell.stopFrom()
	return nil
}

func (cell *run) stopFrom() {
	cell.proc("from-app").Stop(20 * time.Second)
	cell.proc("from-worker").Stop(20 * time.Second)
	cell.mark("fromStopped")
}

func (cell *run) pollerCtx(ctx context.Context) context.Context {
	pollCtx, stop := context.WithCancel(context.WithoutCancel(ctx))
	cell.stopPoller = stop
	return pollCtx
}

func (cell *run) startHeadAPI() error {
	return cell.startHead("head-api", "apps/api", map[string]string{"API_PORT": itoa(cell.headPort), "OTEL_EXPORTER_PROMETHEUS_PORT": itoa(mustPort())})
}

// maxAPIRestarts bounds reviveAPI; past it the cell stops as if no orchestrator restarted the api.
const maxAPIRestarts = 60

// reviveAPI restarts a head api that exited before ready, as an orchestrator's restart policy does;
// each crash keeps its log as head-api-crash-<n> and fails N7.
func (cell *run) reviveAPI() {
	api := cell.proc("head-api")
	if exited, _ := api.Exited(); !exited || api.command == nil || len(cell.apiCrashes) >= maxAPIRestarts {
		return
	}
	crashLog := cell.logPath(fmt.Sprintf("head-api-crash-%d", len(cell.apiCrashes)+1))
	_ = os.Rename(cell.logPath("head-api"), crashLog)
	cell.apiCrashes = append(cell.apiCrashes, time.Since(cell.origin).Milliseconds())
	cell.procsMu.Lock()
	cell.procs = slices.DeleteFunc(cell.procs, func(proc *Proc) bool { return proc == api })
	cell.procsMu.Unlock()
	if err := cell.startHeadAPI(); err != nil {
		cell.report.Notes = append(cell.report.Notes, "restarting head-api: "+err.Error())
	}
}

func (cell *run) startHeadWorker() error {
	return cell.startHead("head-worker", "apps/worker", map[string]string{"WORKER_METRICS_PORT": itoa(mustPort()), "OTEL_EXPORTER_PROMETHEUS_PORT": itoa(mustPort())})
}

func (cell *run) startHead(name, app string, extra map[string]string) error {
	proc, err := Start(ProcSpec{Name: name, Dir: filepath.Join(cell.options.HeadDir, app), Log: cell.logPath(name),
		Args: HeadStartArgs, Env: cell.envWith(extra)})
	if err == nil {
		cell.addProc(proc)
	}
	return err
}

func (cell *run) awaitReady(ctx context.Context) error {
	err := waitFor(ctx, cell.options.ReadyWithin, func() bool {
		cell.reviveAPI()
		cell.restartWorkerMidUpgrade(ctx)
		return FirstAt(cell.poller.Timeline(), "ready") >= 0 || cell.headDied()
	})
	if err != nil || cell.headDied() {
		return errors.Join(err, cell.deathNote())
	}
	cell.mark("ready")
	cell.grantOperator(ctx)
	cell.assertOldWritersGone(ctx)
	ledger, err := Ledger(ctx, cell.stores)
	cell.atReady = ledger
	if err != nil {
		return err
	}
	return sleep(ctx, cell.options.AfterReady)
}

// grantOperator makes the seed account a platform operator on head: ADMIN_EMAILS grants nothing there.
func (cell *run) grantOperator(ctx context.Context) {
	defer close(cell.granted)
	email, _ := generate.SeedAccount(cell.options.Seed)
	command := exec.CommandContext(ctx, "node", "--experimental-transform-types", "src/main.ts", "grant-platform-operator", email) // #nosec G204 -- fixed argv.
	command.Dir, command.Env = filepath.Join(cell.options.HeadDir, "apps", "tasks"), cell.envWith(nil)
	out, err := command.CombinedOutput()
	_ = os.WriteFile(cell.logPath("grant-operator"), out, 0o600)
	if err != nil {
		cell.report.Notes = append(cell.report.Notes, "grant-platform-operator: "+err.Error()+": "+tail(out))
	}
}

// assertOldWritersGone is the operator's act once the old release is stopped (rehearse.sh does the
// same): from main, writers predate the serving roster, so needs-old-writers-gone steps otherwise
// wait out the 30 min pre-roster grace, far past the settle window.
func (cell *run) assertOldWritersGone(ctx context.Context) {
	command := exec.CommandContext(ctx, "node", "--experimental-transform-types", "src/main.ts", "upgrade", "old-writers-gone") // #nosec G204 -- fixed argv.
	command.Dir, command.Env = filepath.Join(cell.options.HeadDir, "apps", "tasks"), cell.envWith(nil)
	out, err := command.CombinedOutput()
	_ = os.WriteFile(cell.logPath("old-writers-gone"), out, 0o600)
	if err != nil {
		cell.report.Notes = append(cell.report.Notes, "upgrade old-writers-gone: "+err.Error()+": "+tail(out))
	}
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
			return fmt.Errorf("%s exited (%w); see %s", name, err, cell.logPath(name))
		}
	}
	return nil
}

// settle stops the traffic and waits until the ledger has nothing outstanding and the queues drained.
func (cell *run) settle(ctx context.Context) error {
	cell.finishTraffic()
	cell.mark("trafficStopped")
	err := waitFor(ctx, cell.options.SettleWithin, func() bool {
		rows, err := Ledger(ctx, cell.stores)
		depth, depthErr := QueueDepth(ctx, cell.stores.RedisPort)
		return err == nil && depthErr == nil && len(rows) > 0 && len(Outstanding(rows)) == 0 && depth == 0
	})
	cell.mark("settled")
	if cell.stopSampler != nil {
		cell.stopSampler()
		cell.sampleQueueOnce(ctx) // the drained sample the 2 s sampler may have missed
	}
	if err != nil && ctx.Err() == nil {
		cell.report.Notes = append(cell.report.Notes, "settle: "+err.Error()+"; the invariants judge the stores as they are")
		return nil
	}
	return err
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
	if cell.stopSampler != nil {
		cell.stopSampler()
	}
	cell.shotsWG.Wait()
	cell.stopObservers()
	procs := cell.procList()
	for index := len(procs) - 1; index >= 0; index-- {
		procs[index].Stop(15 * time.Second)
	}
	if cell.balancer != nil {
		cell.balancer.Close()
	}
	if !cell.options.Keep && cell.stores.Name != "" && cell.report.Error == "" {
		_ = cell.stores.Drop(context.Background())
	}
}

// shootPhases screenshots each phase the poller sees, and Ops > Upgrades once signing in can work.
func (cell *run) shootPhases(ctx context.Context) {
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
	signIn := phase == "holding:upgrading" || phase == "ready" || phase == "settled" || phase == "drill-failed"
	if phase == "down" {
		return
	}
	if signIn {
		select { // a signed-in shot before the grant shows "Access Restricted"
		case <-cell.granted:
		case <-ctx.Done():
			return
		}
	}
	email, password := generate.SeedAccount(cell.options.Seed)
	name := strings.NewReplacer(":", "-", "/", "-").Replace(phase) + ".png"
	out := filepath.Join(cell.options.RunDir, "shots", name)
	target := cell.url() // signing in needs the public origin; a bare page is head's own
	if !signIn {
		target = cell.headURL()
	}
	args, _ := json.Marshal(map[string]any{"url": target, "email": email, "password": password, "out": out, "signIn": signIn})
	script := filepath.Join(cell.options.RunDir, "ops-upgrades.mjs")
	if err := os.WriteFile(script, opsScript, 0o600); err != nil {
		return
	}
	shotCtx, cancel := context.WithTimeout(ctx, 3*time.Minute) // the script's own waits add up to about 140 s
	defer cancel()
	command := exec.CommandContext(shotCtx, "node", script, string(args)) // #nosec G204 -- harness-written script.
	command.Dir = filepath.Join(cell.options.HeadDir, "apps", "ui")
	output, err := command.Output()
	var exit *exec.ExitError
	if errors.As(err, &exit) {
		err = fmt.Errorf("%w: %s", err, tail(exit.Stderr))
	}
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

// noteLoad records the machine's load averages: a loaded machine slows workers and starves the shared ClickHouse.
func (cell *run) noteLoad(when string) {
	out, err := exec.CommandContext(context.Background(), "sysctl", "-n", "vm.loadavg").Output() // #nosec G204 -- fixed argv.
	if err == nil {
		cell.report.Notes = append(cell.report.Notes, "machine load at "+when+": "+strings.Trim(strings.TrimSpace(string(out)), "{ }"))
	}
}

func oneMinuteLoad() float64 {
	out, err := exec.CommandContext(context.Background(), "sysctl", "-n", "vm.loadavg").Output() // #nosec G204 -- fixed argv.
	if err != nil {
		return 0
	}
	fields := strings.Fields(strings.Trim(strings.TrimSpace(string(out)), "{ }"))
	if len(fields) == 0 {
		return 0
	}
	load, _ := strconv.ParseFloat(fields[0], 64)
	return load
}
