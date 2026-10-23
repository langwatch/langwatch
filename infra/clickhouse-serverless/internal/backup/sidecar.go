package backup

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"sync"
	"time"

	"go.uber.org/zap"

	"github.com/langwatch/langwatch/infra/clickhouse-serverless/internal/chclient"
)

// Sidecar schedules backups in-process on the elected runner.
type Sidecar struct {
	Engine    *Engine
	Mode      SidecarMode
	Preferred int // BACKUP_RUNNER_ORDINAL
	Schedules map[Mode]*Schedule
	Metrics   *Metrics
	Log       *zap.Logger
	Now       func() time.Time
	// Tick is how often the sidecar re-elects and checks its schedules.
	Tick time.Duration
	// RefreshEvery is how often last-success times are re-read from backup_log.
	RefreshEvery time.Duration

	mu          sync.Mutex
	slots       map[Mode]Slot
	running     map[Mode]bool
	lastRefresh time.Time
	wasRunner   *bool
	flushed     bool
}

// Run ticks until ctx ends, then waits for its workers to stop waiting.
// Backups in flight carry on on the server; the next start adopts them.
func (s *Sidecar) Run(ctx context.Context) {
	s.slots, s.running = map[Mode]Slot{}, map[Mode]bool{}
	var wg sync.WaitGroup
	defer wg.Wait()
	for {
		s.TickOnce(ctx, &wg)
		select {
		case <-ctx.Done():
			return
		case <-time.After(s.Tick):
		}
	}
}

// TickOnce runs one pass: elect, refresh, then start what is owed.
func (s *Sidecar) TickOnce(ctx context.Context, wg *sync.WaitGroup) {
	if s.slots == nil {
		s.slots, s.running = map[Mode]Slot{}, map[Mode]bool{}
	}
	now := s.Now()
	store := s.Engine.Store

	// Every sidecar flushes once so its server has a backup_log for the
	// runner's cluster-wide lookup, which fails on a replica without one.
	if !s.flushed {
		if err := store.FlushLogs(ctx); err != nil {
			s.Log.Warn("SYSTEM FLUSH LOGS failed, retrying next tick", zap.Error(err))
		} else {
			s.flushed = true
		}
	}

	r, viewErr := store.Replicas(ctx)
	runner := IsRunner(r, s.Preferred, viewErr)
	s.Metrics.SetRunner(runner)
	if s.wasRunner == nil || *s.wasRunner != runner {
		s.Log.Info("backup runner election", zap.Bool("runner", runner), zap.Int("self", r.Self), zap.Ints("reachable", r.Reachable), zap.Int("replicas", r.Total), zap.Error(viewErr))
		s.wasRunner = &runner
	}

	if s.lastRefresh.IsZero() || now.Sub(s.lastRefresh) >= s.RefreshEvery {
		if s.refresh(ctx, Modes...) {
			s.lastRefresh = now
		}
	}
	for _, mode := range Modes {
		if next, ok := s.Schedules[mode].Next(now); ok {
			s.Metrics.SetNext(mode, next)
		}
	}
	if !runner {
		return
	}

	var inFlight []Backup
	if s.Mode == SidecarRun {
		var err error
		if inFlight, err = store.InFlight(ctx); err != nil {
			s.Log.Warn("could not check for backups to adopt", zap.Error(err))
		}
	}
	for _, mode := range Modes {
		s.mu.Lock()
		busy := s.running[mode]
		slot := s.slots[mode]
		s.mu.Unlock()
		if busy {
			continue
		}
		if b, ok := s.adoptable(mode, inFlight, now); ok {
			s.start(ctx, wg, mode, time.Time{}, func(ctx context.Context) Result {
				return s.Engine.Await(ctx, mode, b)
			})
			continue
		}
		fire, due := Due(s.Schedules[mode], now, s.Metrics.LastSuccess(mode), slot)
		if !due {
			continue
		}
		// Re-read before acting: a CronJob or another runner may have
		// finished this slot since the last refresh.
		if !s.refresh(ctx, mode) {
			continue
		}
		if _, due = Due(s.Schedules[mode], now, s.Metrics.LastSuccess(mode), slot); !due {
			continue
		}
		s.start(ctx, wg, mode, fire, func(ctx context.Context) Result {
			return s.Engine.Run(ctx, mode, RunOptions{Adopt: true, DryRun: s.Mode == SidecarObserve})
		})
	}
}

// adoptable finds a live same-mode backup to wait for, after a restart.
func (s *Sidecar) adoptable(mode Mode, inFlight []Backup, now time.Time) (Backup, bool) {
	for _, b := range inFlight {
		if b.Mode == mode && b.Start.After(now.Add(-time.Duration(s.Engine.Policy.StaleHours)*time.Hour)) {
			return b, true
		}
	}
	return Backup{}, false
}

// refresh raises the last-success times from backup_log.
func (s *Sidecar) refresh(ctx context.Context, modes ...Mode) bool {
	for _, mode := range modes {
		_, last, err := s.Engine.Store.Summary(ctx, mode)
		if err != nil {
			s.Log.Warn("could not read backup history", zap.String("mode", string(mode)), zap.Error(err))
			return false
		}
		if !last.IsZero() {
			s.Metrics.ObserveSuccess(mode, last)
		}
	}
	return true
}

// start runs fn for mode in the background; fire is the slot it serves.
func (s *Sidecar) start(ctx context.Context, wg *sync.WaitGroup, mode Mode, fire time.Time, fn func(context.Context) Result) {
	now := s.Now()
	s.mu.Lock()
	s.running[mode] = true
	if !fire.IsZero() {
		s.slots[mode] = s.slots[mode].Record(fire, now, false)
	}
	s.mu.Unlock()
	s.Metrics.Begin(mode, now)
	wg.Add(1)
	go func() {
		defer wg.Done()
		var res Result
		// A backup bug must never take the sidecar, and so the pod, down.
		defer func() {
			if p := recover(); p != nil {
				res = Result{Mode: mode, Outcome: Failed, Err: fmt.Errorf("panic: %v", p)}
			}
			s.finish(mode, fire, res)
		}()
		res = fn(ctx)
	}()
}

func (s *Sidecar) finish(mode Mode, fire time.Time, res Result) {
	res.Mode = mode
	now := s.Now()
	s.Metrics.Finish(res, now)
	s.mu.Lock()
	s.running[mode] = false
	if slot := s.slots[mode]; !fire.IsZero() && slot.Fire.Equal(fire) {
		slot.LastFailed = res.Outcome == Failed
		s.slots[mode] = slot
	}
	s.mu.Unlock()
	fields := []zap.Field{zap.String("mode", string(mode)), zap.String("outcome", string(res.Outcome)), zap.String("backup", res.Backup.Path), zap.Duration("duration", res.Duration())}
	switch res.Outcome {
	case Failed:
		s.Log.Error("backup failed", append(fields, zap.Error(res.Err))...)
	case Succeeded:
		s.Log.Info("backup completed", append(fields, zap.Uint64("size_bytes", res.Backup.Bytes))...)
	}
}

// Await waits for a backup already in flight, as a run of mode.
func (e *Engine) Await(ctx context.Context, mode Mode, b Backup) Result {
	e.Log.Info("adopting a backup already in flight", zap.String("mode", string(mode)), zap.String("backup", b.Path), zap.String("host", b.Host))
	res := Result{Mode: mode, Started: e.Now(), Decision: Decision{Action: Adopt, Mode: mode, Adopt: &b}}
	return e.wait(ctx, res, b.ID)
}

// RunSidecar wires the backup sidecar from cfg and runs it until ctx ends.
// A bad configuration is logged and reported on /metrics, never fatal:
// the sidecar shares the pod with ClickHouse.
func RunSidecar(ctx context.Context, cfg Config, cfgErr error, log *zap.Logger) {
	log = log.With(zap.String("component", "backup"))
	metrics := NewMetrics(cfg.Sidecar, time.Now())
	go serveMetrics(ctx, cfg.MetricsListen, metrics, log)

	schedules := map[Mode]*Schedule{}
	creds, err := cfg.Credentials(false)
	cfgErr = errors.Join(cfgErr, err)
	if cfgErr == nil {
		for mode, expr := range map[Mode]string{Full: cfg.FullSchedule, Incremental: cfg.IncrementalSchedule} {
			s, err := ParseSchedule(expr)
			cfgErr = errors.Join(cfgErr, err)
			schedules[mode] = s
		}
	}
	if cfgErr != nil {
		metrics.SetConfigError(cfgErr)
		log.Error("backup sidecar configuration invalid; no backups will run", zap.Error(cfgErr))
		<-ctx.Done()
		return
	}

	client := &chclient.Client{BaseURL: cfg.BaseURL(), Creds: creds}
	engine := &Engine{
		Store:        &SQLStore{Client: client, Database: cfg.Database, Tables: Tables{Cluster: cfg.Cluster}},
		Policy:       cfg.Policy(),
		MaxBandwidth: cfg.MaxBandwidth,
		Log:          log,
		Now:          time.Now,
	}
	log.Info("backup sidecar started", zap.String("state", string(cfg.Sidecar)), zap.String("database", cfg.Database),
		zap.String("full_schedule", cfg.FullSchedule), zap.String("incremental_schedule", cfg.IncrementalSchedule),
		zap.String("cluster", cfg.Cluster), zap.Int("runner_ordinal", cfg.RunnerOrdinal), zap.String("metrics", cfg.MetricsListen))
	(&Sidecar{
		Engine:       engine,
		Mode:         cfg.Sidecar,
		Preferred:    cfg.RunnerOrdinal,
		Schedules:    schedules,
		Metrics:      metrics,
		Log:          log,
		Now:          time.Now,
		Tick:         15 * time.Second,
		RefreshEvery: 5 * time.Minute,
	}).Run(ctx)
}

// serveMetrics keeps retrying a listen that fails rather than exiting.
func serveMetrics(ctx context.Context, listen string, m *Metrics, log *zap.Logger) {
	server := &http.Server{Addr: listen, Handler: m.Handler(), ReadHeaderTimeout: 5 * time.Second, WriteTimeout: 10 * time.Second}
	go func() {
		<-ctx.Done()
		shutdown, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		_ = server.Shutdown(shutdown)
	}()
	for ctx.Err() == nil {
		if err := server.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
			log.Error("backup metrics listener failed, retrying", zap.String("listen", listen), zap.Error(err))
		}
		select {
		case <-ctx.Done():
		case <-time.After(30 * time.Second):
		}
	}
}
