package app

import (
	"context"
	"slices"
	"strings"
	"testing"
	"time"

	"go.uber.org/zap"
	"go.uber.org/zap/zapcore"
	"go.uber.org/zap/zaptest/observer"

	"github.com/langwatch/langwatch/tools/thuishaven/domain"
)

type fakeInfraJanitor struct {
	fakeJanitor
	containers []domain.InfraContainer
	stopped    []string
}

func (f *fakeInfraJanitor) InfraContainers(context.Context) ([]domain.InfraContainer, error) {
	return f.containers, nil
}

func (f *fakeInfraJanitor) StopContainer(_ context.Context, id string) error {
	f.stopped = append(f.stopped, id)
	return nil
}

var dedupeNow = time.Date(2026, 10, 11, 12, 0, 0, 0, time.UTC)

const brewRedis = "/opt/homebrew/opt/redis/bin/redis-server 127.0.0.1:6379"

// dedupeOrch manages a brew Redis on 6379 (pid 100) and logs to an observer.
func dedupeOrch(sys *fakeSystem, store *fakeStore, janitor ContainerJanitor) (*Orchestrator, *observer.ObservedLogs) {
	core, logs := observer.New(zapcore.DebugLevel)
	if sys.pidsByPort == nil {
		sys.pidsByPort = map[int][]int{6379: {100}}
	}
	if janitor == nil {
		janitor = &fakeJanitor{}
	}
	return &Orchestrator{
		cfg: Config{
			Duplicates: domain.DefaultDuplicateLimits(), Orphans: domain.DefaultOrphanLimits(),
			BrowserOwnerRoots: []string{"/w"}, Home: "/h", ShouldManageRedis: true,
		},
		sys: sys, store: store, rds: &fakeRedis{}, janitor: janitor, log: zap.New(core),
	}, logs
}

func TestDuplicateSweepLeavesARedisWhoseOwnerRuns(t *testing.T) {
	sys := &fakeSystem{now: dedupeNow, procSamples: []ProcessSample{
		{PID: 100, PPID: 1, Elapsed: 48 * time.Hour, Command: brewRedis},
		{PID: 200, PPID: 1, Elapsed: time.Hour, Command: "/w/.bin/upgradelab/upgradelab cell n4"},
		{PID: 201, PPID: 200, Elapsed: time.Hour, Command: "redis-server *:53114"},
	}, cwds: map[int]string{201: "/w"}}
	o, logs := dedupeOrch(sys, &fakeStore{}, nil)

	o.sweepDuplicates(context.Background())
	sys.now = dedupeNow.Add(2 * time.Minute)
	for i := range sys.procSamples {
		sys.procSamples[i].Elapsed += 2 * time.Minute
	}
	o.sweepDuplicates(context.Background())

	if len(sys.terminated) != 0 || len(sys.killed) != 0 {
		t.Fatalf("terminated %v killed %v, want nothing", sys.terminated, sys.killed)
	}
	if n := logs.FilterMessage("duplicate infra left running").Len(); n != 1 {
		t.Fatalf("left-running logged %d times, want once", n)
	}
	groups := o.InfraDuplicates(context.Background())
	want := "2 redis running: brew pid 100 :6379 (kept), pid 201 :53114 (owned by upgradelab cell (pid 200), left)"
	if len(groups) != 1 || groups[0].Describe() != want {
		t.Fatalf("status = %+v, want %q", groups, want)
	}
}

func TestDuplicateSweepStopsAStrayOnceThenKillsItSilently(t *testing.T) {
	sys := &fakeSystem{now: dedupeNow, procSamples: []ProcessSample{
		{PID: 100, PPID: 1, Elapsed: 48 * time.Hour, Command: brewRedis},
		{PID: 201, PPID: 1, Elapsed: time.Hour, Command: "redis-server *:53114"},
	}, cwds: map[int]string{201: "/w/.bin/upgradelab/cells/n4"}}
	store := &fakeStore{}
	o, logs := dedupeOrch(sys, store, nil)

	o.sweepDuplicates(context.Background())
	if !slices.Equal(sys.terminated, []int{201}) {
		t.Fatalf("terminated = %v, want the stray 201 only", sys.terminated)
	}
	if len(store.reapEvents) != 1 || store.reapEvents[0].Kind != domain.DuplicateClass ||
		!strings.Contains(store.reapEvents[0].Reason, "brew pid 100 :6379") || !strings.Contains(store.reapEvents[0].Target, "53114") {
		t.Fatalf("reap events = %+v, want one duplicate naming both", store.reapEvents)
	}

	sys.now = dedupeNow.Add(time.Minute)
	sys.procSamples[1].Elapsed += time.Minute
	o.sweepDuplicates(context.Background())
	if !slices.Equal(sys.killed, []int{201}) {
		t.Fatalf("killed = %v, want 201 after the grace", sys.killed)
	}
	sys.now = dedupeNow.Add(2 * time.Minute)
	sys.procSamples[1].Elapsed += time.Minute
	o.sweepDuplicates(context.Background())
	if len(store.reapEvents) != 1 || logs.FilterMessage("stopped duplicate infra").Len() != 1 || len(sys.terminated) != 1 {
		t.Fatalf("reaps %d, stop logs %d, terms %v: want one of each", len(store.reapEvents), logs.FilterMessage("stopped duplicate infra").Len(), sys.terminated)
	}
}

func TestDuplicateSweepLeavesWhatItMayNotStop(t *testing.T) {
	stray := ProcessSample{PID: 201, PPID: 1, Elapsed: time.Hour, Command: "redis-server *:53114"}
	cases := map[string]func(*fakeSystem, *Orchestrator){
		"outside every checkout": func(s *fakeSystem, _ *Orchestrator) { s.cwds = map[int]string{201: "/tmp"} },
		"still starting":         func(s *fakeSystem, _ *Orchestrator) { s.procSamples[1].Elapsed = time.Minute },
		"report mode":            func(_ *fakeSystem, o *Orchestrator) { o.cfg.Duplicates.Mode = domain.DuplicatesReport },
		"switched off":           func(_ *fakeSystem, o *Orchestrator) { o.cfg.Duplicates = domain.DuplicateLimits{} },
		"no canonical redis":     func(_ *fakeSystem, o *Orchestrator) { o.cfg.ShouldManageRedis = false },
		"pointed at by a stack": func(s *fakeSystem, o *Orchestrator) {
			s.pidsByPort[53114] = []int{201}
			o.store = &fakeStore{stacks: []domain.Stack{{Slug: "x", RedisPort: 53114}}}
		},
	}
	for name, mutate := range cases {
		t.Run(name, func(t *testing.T) {
			sys := &fakeSystem{now: dedupeNow, procSamples: []ProcessSample{
				{PID: 100, PPID: 1, Elapsed: 48 * time.Hour, Command: brewRedis}, stray,
			}, cwds: map[int]string{201: "/w"}, pidsByPort: map[int][]int{6379: {100}}}
			o, _ := dedupeOrch(sys, &fakeStore{}, nil)
			mutate(sys, o)
			o.sweepDuplicates(context.Background())
			if len(sys.terminated) != 0 {
				t.Fatalf("terminated = %v, want nothing", sys.terminated)
			}
		})
	}
}

func TestDuplicateSweepCountsAServerAndItsWatchdogOnce(t *testing.T) {
	sys := &fakeSystem{now: dedupeNow, procSamples: []ProcessSample{
		{PID: 300, PPID: 1, Elapsed: time.Hour, Command: "/h/clickhouse-native/clickhouse server --config-file=/h/config.xml"},
		{PID: 301, PPID: 300, Elapsed: time.Hour, Command: "/h/clickhouse-native/clickhouse server --config-file=/h/config.xml"},
	}}
	o, _ := dedupeOrch(sys, &fakeStore{}, nil)
	if groups := o.InfraDuplicates(context.Background()); len(groups) != 0 {
		t.Fatalf("groups = %+v, want none", groups)
	}
}

func TestDuplicateSweepStopsHavensUnreferencedContainerOnly(t *testing.T) {
	sys := &fakeSystem{now: dedupeNow, procSamples: []ProcessSample{
		{PID: 300, PPID: 1, Elapsed: time.Hour, Command: "/h/clickhouse-native/clickhouse server --config-file=/h/config.xml"},
	}, pidsByPort: map[int][]int{8123: {300}}}
	janitor := &fakeInfraJanitor{containers: []domain.InfraContainer{
		{ID: "c1", Name: domain.ClickHouseContainer, Image: "altinity/clickhouse-server:25.3", Ports: []int{8124}},
		{ID: "c2", Name: "tc-ch", Image: "clickhouse/clickhouse-server", Ports: []int{55001}, Labels: map[string]string{"org.testcontainers": "true"}},
		{ID: "c3", Name: "langwatch-clickhouse-1", Image: "clickhouse/clickhouse-server", Ports: []int{8125}, Labels: map[string]string{domain.ComposeWorkingDirLabel: "/w", "com.docker.compose.project": "langwatch"}},
	}}
	store := &fakeStore{stacks: []domain.Stack{{Slug: "w", ClickHouseHTTPPort: 8123}}}
	o, _ := dedupeOrch(sys, store, janitor)

	o.sweepDuplicates(context.Background())

	if !slices.Equal(janitor.stopped, []string{"c1"}) {
		t.Fatalf("stopped = %v, want haven's own unreferenced container c1 only", janitor.stopped)
	}
	if len(store.reapEvents) != 1 || !strings.Contains(store.reapEvents[0].Reason, ":8123") {
		t.Fatalf("reap events = %+v", store.reapEvents)
	}
}
