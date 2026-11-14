package cmd

import (
	"context"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"slices"
	"strconv"
	"strings"
	"time"

	"github.com/langwatch/langwatch/services/sims/telemetrysim"
	"github.com/langwatch/langwatch/tools/thuishaven/adapters/nodeinspector"
	"github.com/langwatch/langwatch/tools/thuishaven/app"
	"github.com/langwatch/langwatch/tools/thuishaven/cmd/viewer/sources"
	"github.com/langwatch/langwatch/tools/thuishaven/domain/nodeprofile"
)

// `haven obs cpu|heap|compare`: profile a running stack's Node lane over the
// inspector and print what an agent acts on (ADR-064, amendment 2026-10-23).

const (
	defaultProfileWindow = 30 * time.Second
	defaultProfileRows   = 15
	cpuSamplingInterval  = 500 * time.Microsecond
)

func nodeProfileFlags(extra ...flagSpec) []flagSpec {
	return append([]flagSpec{
		{long: "--duration", takesValue: true, value: "<dur>", summary: "how long to record, e.g. 30s (default 30s)"},
		{long: "--load", takesValue: true, value: "<telemetry:rate>", summary: "drive load during the window: telemetry:50 sends llm-trace batches at 50/s"},
		{long: "--out", takesValue: true, value: "<file>", summary: "where to write the profile (default .claude/tmp/haven-profiles/<stack>/)"},
		{long: "--limit", takesValue: true, value: "<n>", summary: "at most n rows per table (default 15)"},
		{long: "--json", summary: "machine-readable"},
	}, extra...)
}

func obsCPUSpec() commandSpec {
	return commandSpec{
		name:    "cpu",
		summary: "CPU-profile a Node lane (api, ui, workers): self time by function, file and package; saves a .cpuprofile",
		args:    "[lane]",
		maxArgs: 1,
		flags:   nodeProfileFlags(),
		run:     runObsCPU,
	}
}

func obsHeapSpec() commandSpec {
	return commandSpec{
		name:    "heap",
		summary: "heap-profile a Node lane: sampled MB by function and package, or --snapshot for retained size and strings",
		args:    "[lane]",
		maxArgs: 1,
		flags: nodeProfileFlags(
			flagSpec{long: "--snapshot", summary: "a full heap snapshot instead of sampling (pauses the process while it is written)"},
			flagSpec{long: "--live", summary: "sampling: only what is still alive at the end, not everything allocated"},
		),
		run: runObsHeap,
	}
}

func obsCompareSpec() commandSpec {
	return commandSpec{
		name:    "compare",
		summary: "diff two CPU profiles: a lane's last two (default api), or two .cpuprofile paths",
		args:    "[lane | <before> <after>]",
		maxArgs: 2,
		flags: []flagSpec{
			{long: "--limit", takesValue: true, value: "<n>", summary: "at most n rows per table (default 15)"},
			{long: "--json", summary: "machine-readable"},
		},
		run: runObsCompare,
	}
}

// profileOptions are the flags every profile shares, read and checked.
type profileOptions struct {
	window   time.Duration
	limit    int
	loadRate float64
	out      string
}

func readProfileOptions(inv invocation) (profileOptions, error) {
	o := profileOptions{window: defaultProfileWindow, out: inv.value("--out")}
	if inv.has("--duration") {
		d, err := parseDurationFlag(inv, "--duration")
		if err != nil {
			return o, usageErr("%v", err)
		}
		o.window = d
	}
	var err error
	if o.limit, err = readLimit(inv); err != nil {
		return o, err
	}
	o.loadRate, err = readLoad(inv.value("--load"))
	return o, err
}

// readLoad is --load's rate: telemetry:<batches per second>, 0 when absent.
func readLoad(spec string) (float64, error) {
	if spec == "" {
		return 0, nil
	}
	rate, ok := strings.CutPrefix(spec, "telemetry:")
	r, err := strconv.ParseFloat(rate, 64)
	if !ok || err != nil || r <= 0 {
		return 0, usageErr("--load wants telemetry:<batches per second>, e.g. telemetry:50; got %q", spec)
	}
	return r, nil
}

func readLimit(inv invocation) (int, error) {
	raw := inv.value("--limit")
	if raw == "" {
		return defaultProfileRows, nil
	}
	n, err := strconv.Atoi(raw)
	if err != nil || n <= 0 {
		return 0, usageErr("--limit wants a positive whole number, got %q", raw)
	}
	return n, nil
}

// resolveNodeLane finds the lane's process, mapping a down stack or lane to
// exit 65 and an unknown lane to exit 64, each saying what to run next.
func resolveNodeLane(d deps, inv invocation) (app.NodeLane, error) {
	slug, err := tabSlug(d, inv)
	if err != nil {
		return app.NodeLane{}, err
	}
	lane := ""
	if len(inv.args) > 0 {
		lane = inv.args[0]
	}
	nl, err := d.orch.NodeLane(slug, lane)
	switch {
	case errors.Is(err, app.ErrUnknownLane):
		return nl, usageErr("%v", err)
	case errors.Is(err, app.ErrStackNotRunning):
		return nl, notRunningErr("stack %s not running: haven up --agent -d", slug)
	case errors.Is(err, app.ErrLaneNotRunning):
		return nl, notRunningErr("%v: haven status --agent shows the lanes; haven up --agent -d starts them", err)
	}
	return nl, err
}

// profileTarget is the lane a report is about.
type profileTarget struct {
	Stack string   `json:"stack"`
	Lane  string   `json:"lane"`
	PID   int      `json:"pid"`
	Also  []string `json:"alsoServes,omitempty"`
}

// profileSpec is what kind of profile a command takes: its flags and file kind.
type profileSpec struct {
	inv invocation
	ext string
}

// profileRun is one profile of one lane in progress: where it is saved, the
// load it drives, and the inspector session recording it.
type profileRun struct {
	nl      app.NodeLane
	opts    profileOptions
	path    string
	load    *telemetryLoad
	session *nodeinspector.Session
}

// startProfile resolves the lane, picks the file, prepares any load and
// attaches to the process's inspector.
func startProfile(ctx context.Context, d deps, spec profileSpec) (*profileRun, error) {
	opts, err := readProfileOptions(spec.inv)
	if err != nil {
		return nil, err
	}
	nl, err := resolveNodeLane(d, spec.inv)
	if err != nil {
		return nil, err
	}
	run := &profileRun{nl: nl, opts: opts, path: opts.out}
	if run.path == "" {
		run.path = filepath.Join(d.orch.ProfileDir(nl.Slug, d.worktree), fmt.Sprintf("%s-%s.%s", nl.Lane, time.Now().Format("20060102-150405"), spec.ext))
	}
	if run.path, err = filepath.Abs(run.path); err != nil {
		return nil, err
	}
	if err := os.MkdirAll(filepath.Dir(run.path), 0o750); err != nil {
		return nil, err
	}
	if opts.loadRate > 0 {
		if run.load, err = newTelemetryLoad(d, nl.Slug, opts); err != nil {
			return nil, err
		}
	}
	run.session, err = nodeinspector.Attach(ctx, nl.PID)
	return run, err
}

func (r *profileRun) target() profileTarget {
	return profileTarget{Stack: r.nl.Slug, Lane: r.nl.Lane, PID: r.nl.PID, Also: r.nl.SharedWith}
}

// startLoad sends the prepared load, if any; it runs once recording has begun.
func (r *profileRun) startLoad() {
	if r.load != nil {
		r.load.start()
	}
}

func (r *profileRun) loadResult() *loadRun {
	if r.load == nil {
		return nil
	}
	return r.load.finish()
}

// finish reads the process's memory and closes the session, closing the
// inspector too when this run opened it.
func (r *profileRun) finish(ctx context.Context) (*memoryMB, inspectorNote) {
	ctx = context.WithoutCancel(ctx)
	mem := readMemory(ctx, r.session)
	leftOpen := r.session.Close(ctx)
	return mem, inspectorNote{Port: r.session.Port, Opened: r.session.Opened, LeftOpen: leftOpen}
}

// loadRun is the telemetry load a profile drove, as the sim last reported it.
type loadRun struct {
	Preset string  `json:"preset"`
	Rate   float64 `json:"rate"`
	Sent   int64   `json:"sent"`
	Acked  int64   `json:"acked"`
	Failed int64   `json:"failed"`
	State  string  `json:"state"`
	Error  string  `json:"error,omitempty"`
}

// telemetryLoad is an llm-trace load against the stack for the profile's
// window; start sends it, finish reads where it got to.
type telemetryLoad struct {
	api sources.SimAPI
	req telemetrysim.RunRequest
	id  string
	run loadRun
}

func newTelemetryLoad(d deps, slug string, opts profileOptions) (*telemetryLoad, error) {
	inv := invocation{flags: map[string]string{
		"--stack": slug, "--preset": "llm-trace",
		"--rate": strconv.FormatFloat(opts.loadRate, 'f', -1, 64), "--duration": opts.window.String(),
	}}
	api, err := telemetryAPI(d, inv)
	if err != nil {
		return nil, notRunningErr("%v", err)
	}
	req, err := telemetryRequest("load", inv, telemetryOverlay(d, inv))
	if err != nil {
		return nil, err
	}
	return &telemetryLoad{api: api, req: req, run: loadRun{Preset: req.Preset, Rate: opts.loadRate}}, nil
}

func (l *telemetryLoad) start() {
	var st telemetrysim.RunStatus
	if err := l.api.Post("/_sim/api/runs", l.req, &st); err != nil {
		l.run.Error = err.Error()
		return
	}
	l.id = st.ID
}

func (l *telemetryLoad) finish() *loadRun {
	if l.id == "" {
		return &l.run
	}
	var st telemetrysim.RunStatus
	if err := l.api.Get("/_sim/api/runs/"+l.id, nil, &st); err == nil {
		l.run.Sent, l.run.Acked, l.run.Failed, l.run.State = st.Sent, st.Acked, st.Failed, st.State
		if st.LastError != "" {
			l.run.Error = st.LastError
		}
	}
	return &l.run
}

// inspectorNote says how the profile reached the process.
type inspectorNote struct {
	Port     int  `json:"port"`
	Opened   bool `json:"opened"`
	LeftOpen bool `json:"leftOpen"`
}

func (n inspectorNote) String() string {
	switch {
	case n.Opened && !n.LeftOpen:
		return fmt.Sprintf("opened with SIGUSR1 on :%d, closed after", n.Port)
	case n.Opened:
		return fmt.Sprintf("opened with SIGUSR1 on :%d and still open (closing it failed)", n.Port)
	}
	return fmt.Sprintf("already open on :%d, left open", n.Port)
}

// memoryMB is process.memoryUsage() in MiB.
type memoryMB struct {
	RSS       float64 `json:"rssMb"`
	HeapUsed  float64 `json:"heapUsedMb"`
	HeapTotal float64 `json:"heapTotalMb"`
	External  float64 `json:"externalMb"`
}

func readMemory(ctx context.Context, s *nodeinspector.Session) *memoryMB {
	m, err := s.Memory(ctx)
	if err != nil {
		return nil
	}
	const mib = 1 << 20
	return &memoryMB{RSS: float64(m.RSS) / mib, HeapUsed: float64(m.HeapUsed) / mib, HeapTotal: float64(m.HeapTotal) / mib, External: float64(m.External) / mib}
}

// emit prints a report as JSON under --json, else as text.
func emit(inv invocation, report any, text func(io.Writer)) error {
	if inv.has("--json") {
		return encodeJSON(os.Stdout, report)
	}
	text(os.Stdout)
	return nil
}

// cpuReport is `haven obs cpu`'s result, printed as text or JSON.
type cpuReport struct {
	profileTarget
	Profile   string                  `json:"profile"`
	Inspector inspectorNote           `json:"inspector"`
	Memory    *memoryMB               `json:"memory,omitempty"`
	Load      *loadRun                `json:"load,omitempty"`
	Summary   nodeprofile.CPUAnalysis `json:"summary"`
}

func runObsCPU(ctx context.Context, d deps, inv invocation) error {
	run, err := startProfile(ctx, d, profileSpec{inv: inv, ext: "cpuprofile"})
	if err != nil {
		return err
	}
	fmt.Fprintf(os.Stderr, "haven: profiling %s (pid %d) for %s\n", run.nl.Lane, run.nl.PID, run.opts.window)
	report := cpuReport{profileTarget: run.target(), Profile: run.path}
	raw, err := run.session.CPUProfile(ctx, nodeinspector.CPUOptions{Duration: run.opts.window, Interval: cpuSamplingInterval, During: run.startLoad})
	report.Memory, report.Inspector = run.finish(ctx)
	if err != nil {
		return err
	}
	report.Load = run.loadResult()
	if err := os.WriteFile(run.path, raw, 0o600); err != nil {
		return err
	}
	profile, err := nodeprofile.ParseCPUProfile(raw)
	if err != nil {
		return err
	}
	report.Summary = nodeprofile.AnalyseCPU(profile, run.nl.WorktreeDir).Top(run.opts.limit)
	return emit(inv, report, func(w io.Writer) { printCPUReport(w, report) })
}

// heapReport is `haven obs heap`'s result.
type heapReport struct {
	profileTarget
	Profile   string                        `json:"profile"`
	Inspector inspectorNote                 `json:"inspector"`
	Memory    *memoryMB                     `json:"memory,omitempty"`
	Load      *loadRun                      `json:"load,omitempty"`
	Mode      string                        `json:"mode"`
	WindowMs  float64                       `json:"windowMs,omitempty"`
	PauseMs   float64                       `json:"pauseMs,omitempty"`
	Sampling  *nodeprofile.HeapAnalysis     `json:"sampling,omitempty"`
	Snapshot  *nodeprofile.SnapshotAnalysis `json:"snapshot,omitempty"`
}

// heapProfileSpec is a sampling profile, or with --snapshot a snapshot, which
// is one instant and so takes no window, load or --live.
func heapProfileSpec(inv invocation) (profileSpec, error) {
	if !inv.has("--snapshot") {
		return profileSpec{inv: inv, ext: "heapprofile"}, nil
	}
	if inv.has("--duration") || inv.has("--load") || inv.has("--live") {
		return profileSpec{}, usageErr("--snapshot is one instant: it takes no --duration, --load or --live")
	}
	return profileSpec{inv: inv, ext: "heapsnapshot"}, nil
}

func runObsHeap(ctx context.Context, d deps, inv invocation) error {
	spec, err := heapProfileSpec(inv)
	if err != nil {
		return err
	}
	snapshot := spec.ext == "heapsnapshot"
	run, err := startProfile(ctx, d, spec)
	if err != nil {
		return err
	}
	report := heapReport{profileTarget: run.target(), Profile: run.path}
	if snapshot {
		err = run.takeSnapshot(ctx, &report)
	} else {
		err = run.sampleHeap(ctx, inv.has("--live"), &report)
	}
	report.Memory, report.Inspector = run.finish(ctx)
	if err != nil {
		return err
	}
	if snapshot {
		if report.Snapshot, err = analyseSnapshotFile(run.path, run.opts.limit); err != nil {
			return err
		}
	}
	return emit(inv, report, func(w io.Writer) { printHeapReport(w, report) })
}

func (r *profileRun) sampleHeap(ctx context.Context, live bool, report *heapReport) error {
	fmt.Fprintf(os.Stderr, "haven: sampling the heap of %s (pid %d) for %s\n", r.nl.Lane, r.nl.PID, r.opts.window)
	r.startLoad()
	raw, err := r.session.HeapSampling(ctx, r.opts.window, !live)
	if err != nil {
		return err
	}
	report.Load = r.loadResult()
	if err := os.WriteFile(r.path, raw, 0o600); err != nil {
		return err
	}
	p, err := nodeprofile.ParseHeapProfile(raw)
	if err != nil {
		return err
	}
	report.Mode, report.WindowMs = "allocated", float64(r.opts.window.Milliseconds())
	if live {
		report.Mode = "live"
	}
	a := nodeprofile.AnalyseHeap(p, r.nl.WorktreeDir).Top(r.opts.limit)
	report.Sampling = &a
	return nil
}

func (r *profileRun) takeSnapshot(ctx context.Context, report *heapReport) error {
	fmt.Fprintf(os.Stderr, "haven: writing a heap snapshot of %s (pid %d); the process pauses meanwhile\n", r.nl.Lane, r.nl.PID)
	f, err := os.Create(r.path)
	if err != nil {
		return err
	}
	began := time.Now()
	err = r.session.HeapSnapshot(ctx, f)
	report.Mode, report.PauseMs = "snapshot", float64(time.Since(began).Milliseconds())
	if cerr := f.Close(); err == nil {
		err = cerr
	}
	return err
}

func analyseSnapshotFile(path string, limit int) (*nodeprofile.SnapshotAnalysis, error) {
	fmt.Fprintln(os.Stderr, "haven: reading the snapshot")
	snap, err := readSnapshot(path)
	if err != nil {
		return nil, err
	}
	a, err := nodeprofile.AnalyseSnapshot(snap, limit)
	return &a, err
}

// readSnapshot parses a snapshot file; the file's bytes are dropped on return,
// before the dominator pass needs the memory.
func readSnapshot(path string) (*nodeprofile.HeapSnapshot, error) {
	raw, err := os.ReadFile(path)
	if err != nil {
		return nil, err
	}
	return nodeprofile.ParseHeapSnapshot(raw)
}

// compareReport is `haven obs compare`'s result.
type compareReport struct {
	Before string                 `json:"before"`
	After  string                 `json:"after"`
	Diff   nodeprofile.Comparison `json:"diff"`
}

func runObsCompare(_ context.Context, d deps, inv invocation) error {
	limit, err := readLimit(inv)
	if err != nil {
		return err
	}
	before, after, err := compareTargets(d, inv)
	if err != nil {
		return err
	}
	a, err := analyseCPUFile(before)
	if err != nil {
		return err
	}
	b, err := analyseCPUFile(after)
	if err != nil {
		return err
	}
	report := compareReport{Before: before, After: after, Diff: nodeprofile.Compare(a, b).Top(limit)}
	return emit(inv, report, func(w io.Writer) { printCompareReport(w, report) })
}

// compareTargets is two named files, or the last two saved profiles of a
// lane (api when none is named) in this stack's profile directory.
func compareTargets(d deps, inv invocation) (before, after string, err error) {
	if len(inv.args) == 2 {
		return inv.args[0], inv.args[1], nil
	}
	lane := app.APILane
	if len(inv.args) == 1 {
		if strings.HasSuffix(inv.args[0], ".cpuprofile") {
			return "", "", usageErr("haven obs compare takes a lane, or two .cpuprofile paths (before, after)")
		}
		lane = inv.args[0]
	}
	slug, err := tabSlug(d, inv)
	if err != nil {
		return "", "", err
	}
	dir := d.orch.ProfileDir(slug, d.worktree)
	saved, _ := filepath.Glob(filepath.Join(dir, lane+"-*.cpuprofile"))
	slices.Sort(saved)
	if len(saved) < 2 {
		return "", "", usageErr("haven obs compare needs two saved %s profiles in %s and found %d: run haven obs cpu %s, change the code, run it again", lane, dir, len(saved), lane)
	}
	return saved[len(saved)-2], saved[len(saved)-1], nil
}

// analyseCPUFile reads a saved profile; its paths read relative to the
// checkout its own scripts came from, whichever stack recorded it.
func analyseCPUFile(path string) (nodeprofile.CPUAnalysis, error) {
	raw, err := os.ReadFile(path)
	if err != nil {
		return nodeprofile.CPUAnalysis{}, usageErr("%v", err)
	}
	p, err := nodeprofile.ParseCPUProfile(raw)
	if err != nil {
		return nodeprofile.CPUAnalysis{}, usageErr("%s: %v", path, err)
	}
	return nodeprofile.AnalyseCPU(p, nodeprofile.GuessRoot(p.URLs())), nil
}
