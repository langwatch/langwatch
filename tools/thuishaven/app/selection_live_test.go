package app

import (
	"context"
	"os"
	"slices"
	"sync"
	"syscall"
	"testing"

	"go.uber.org/zap"

	"github.com/langwatch/langwatch/tools/thuishaven/domain"
)

const liveSlug = "feat-x"

// liveStackFixture is a running stack under sel whose keeper replans, with its
// plan written as the keeper would hold it.
func liveStackFixture(t *testing.T, sel domain.Selection) (*Orchestrator, *fakeSystem, *routingProxy, UpParams) {
	t.Helper()
	sel.Refresh = domain.RefreshHMR
	wt := t.TempDir()
	st := domain.Stack{
		Slug: liveSlug, WorktreeDir: wt, LauncherPID: 42, KeeperReplans: true, Refresh: sel.Refresh,
		APIPort: 5100, WorkerMetricsPort: 5101,
	}
	for i, r := range domain.PerWorktreeServices {
		svc := domain.Service{Name: r.Name, Port: 6000 + i}
		if !runsLocally(r.Name, PlanOptions{Selection: sel}) {
			svc.Port = 0
		}
		st.Services = append(st.Services, svc)
	}
	sys, proxy := &fakeSystem{alive: map[int]bool{42: true}, nextPort: 7000}, &routingProxy{}
	o := &Orchestrator{
		cfg: Config{Home: t.TempDir(), Naming: domain.DefaultNaming("")}, sys: sys, proxy: proxy,
		store: &fakeStore{stacks: []domain.Stack{st}}, sem: &fakeSemaphore{}, log: zap.NewNop(),
	}
	p := UpParams{ExplicitSlug: liveSlug, WorktreeDir: wt}
	plan := KeeperPlan{Children: o.planChildren(st, PlanOptions{Selection: sel}, wt)}
	if err := writeKeeperPlan(keeperPlanPath(wt, liveSlug), plan); err != nil {
		t.Fatal(err)
	}
	return o, sys, proxy, p
}

func switched(t *testing.T, sel domain.Selection, delta string) PlanOptions {
	t.Helper()
	next, err := domain.ApplySelectionDeltas(sel, []string{delta})
	if err != nil {
		t.Fatal(err)
	}
	return PlanOptions{Selection: next}
}

func laneNames(children []Child) []string {
	names := make([]string, 0, len(children))
	for i := range children {
		names = append(names, children[i].Name)
	}
	return names
}

// @scenario "A keeper applies only the difference between its plan and its lanes"
func TestDiffLanesStartsStopsAndRestartsOnlyWhatChanged(t *testing.T) {
	running := []Child{{Name: "api", Shell: "a"}, {Name: "go", Shell: "g"}, {Name: "langy", Shell: "l"}}
	planned := []Child{{Name: "api", Shell: "a"}, {Name: "go", Shell: "g2"}, {Name: "mail-room", Shell: "m"}}
	got := diffLanes(running, planned)
	if !slices.Equal(got.Start, []string{"mail-room"}) || !slices.Equal(got.Stop, []string{"langy"}) || !slices.Equal(got.Restart, []string{"go"}) {
		t.Errorf("diffLanes = %+v, want start mail-room, stop langy, restart go and api left alone", got)
	}
	if !diffLanes(running, running).IsEmpty() {
		t.Error("an unchanged plan changed lanes")
	}
}

// @scenario "The ui, api and worker switch off and on as one"
func TestTheAppSwitchStopsAndStartsTheNodeLanesAlone(t *testing.T) {
	sel := domain.DefaultSelection()
	o, sys, _, p := liveStackFixture(t, sel)
	before, _ := o.ReadKeeperPlan(liveSlug)
	if err := o.SwitchService(t.Context(), p, switched(t, sel, "-app")); err != nil {
		t.Fatalf("SwitchService -app: %v", err)
	}
	after, _ := o.ReadKeeperPlan(liveSlug)
	change := diffLanes(before.Children, after.Children)
	for _, lane := range []string{"ui", "api"} {
		if !slices.Contains(change.Stop, lane) {
			t.Errorf("-app stopped %v, want the %s lane among them", change.Stop, lane)
		}
	}
	if len(change.Start) != 0 || len(change.Restart) != 0 {
		t.Errorf("-app started %v and restarted %v; nothing else may move", change.Start, change.Restart)
	}
	if !slices.Equal(sys.replanned, []int{42}) {
		t.Errorf("replanned %v, want the keeper (42) told once", sys.replanned)
	}
}

// @scenario "A service switches off in a running stack without restarting it"
func TestSwitchingAServiceOffStopsOnlyItsOwnLane(t *testing.T) {
	sel, _ := domain.ApplySelectionDeltas(domain.DefaultSelection(), []string{"+design-system"})
	o, _, proxy, p := liveStackFixture(t, sel)
	before, _ := o.ReadKeeperPlan(liveSlug)
	if err := o.SwitchService(t.Context(), p, switched(t, sel, "-design-system")); err != nil {
		t.Fatalf("SwitchService: %v", err)
	}
	after, _ := o.ReadKeeperPlan(liveSlug)
	change := diffLanes(before.Children, after.Children)
	if !slices.Equal(change.Stop, []string{domain.DesignSystemService}) || len(change.Start) != 0 || len(change.Restart) != 0 {
		t.Errorf("switching design-system off did %+v, want it stopped and every other lane (%v) left running", change, laneNames(after.Children))
	}
	if !slices.Contains(proxy.removed, domain.DesignSystemService+"|"+liveSlug) {
		t.Errorf("removed routes %v, want design-system's hostname gone", proxy.removed)
	}
}

// @scenario "A service switches on in a running stack without restarting it"
func TestSwitchingAServiceOnStartsItsLaneWithItsOwnPort(t *testing.T) {
	sel := domain.DefaultSelection()
	o, sys, proxy, p := liveStackFixture(t, sel)
	before, _ := o.ReadKeeperPlan(liveSlug)
	if err := o.SwitchService(t.Context(), p, switched(t, sel, "+mail-room")); err != nil {
		t.Fatalf("SwitchService: %v", err)
	}
	after, _ := o.ReadKeeperPlan(liveSlug)
	change := diffLanes(before.Children, after.Children)
	if !slices.Equal(change.Start, []string{domain.MailRoomService}) || len(change.Stop) != 0 {
		t.Errorf("switching mail-room on did %+v, want it started and nothing stopped", change)
	}
	if !slices.Contains(proxy.registered, domain.MailRoomService+"|"+liveSlug) || len(sys.replanned) != 1 {
		t.Errorf("registered %v replanned %v, want mail-room routed and the keeper told", proxy.registered, sys.replanned)
	}
}

// @scenario "A keeper from before live switches is never sent the signal"
func TestAKeeperThatCannotReplanIsNeverSignalled(t *testing.T) {
	sel := domain.DefaultSelection()
	o, sys, _, p := liveStackFixture(t, sel)
	store := o.store.(*fakeStore)
	store.stacks[0].KeeperReplans = false
	if err := o.SwitchService(t.Context(), p, switched(t, sel, "-mail")); err == nil {
		t.Fatal("an older keeper was switched in place; SIGHUP would have killed it")
	}
	if len(sys.replanned) != 0 {
		t.Errorf("replanned %v, want no signal sent", sys.replanned)
	}
}

// laneSupervisor runs each lane until its context ends, recording both.
type laneSupervisor struct {
	fakeSupervisor
	mu      sync.Mutex
	started []string
	stopped []string
	running chan string
}

func (s *laneSupervisor) Supervise(ctx context.Context, children []Child) {
	for i := range children {
		c := &children[i]
		s.mu.Lock()
		s.started = append(s.started, c.Name+":"+c.Shell)
		s.mu.Unlock()
		s.running <- c.Name
		<-ctx.Done()
		s.mu.Lock()
		s.stopped = append(s.stopped, c.Name+":"+c.Shell)
		s.mu.Unlock()
	}
}

// @scenario "A keeper applies only the difference between its plan and its lanes"
func TestTheKeeperReplansLaneByLaneOnTheSignal(t *testing.T) {
	sel := domain.DefaultSelection()
	o, _, _, _ := liveStackFixture(t, sel)
	sup := &laneSupervisor{running: make(chan string, 8)}
	o.sup = sup
	path := keeperPlanPath(o.store.Stacks()[0].WorktreeDir, liveSlug)
	if err := writeKeeperPlan(path, KeeperPlan{Children: []Child{{Name: "api", Shell: "a"}, {Name: "go", Shell: "g"}, {Name: "langy", Shell: "l"}}}); err != nil {
		t.Fatal(err)
	}
	plan, _ := o.ReadKeeperPlan(liveSlug)
	ctx, cancel := context.WithCancel(t.Context())
	replans := make(chan os.Signal, 1)
	done := make(chan struct{})
	go func() {
		defer close(done)
		o.superviseLive(ctx, keeperRun{slug: liveSlug, children: plan.Children, replans: replans})
	}()
	for range 3 {
		<-sup.running
	}
	if err := writeKeeperPlan(path, KeeperPlan{Children: []Child{{Name: "api", Shell: "a"}, {Name: "go", Shell: "g2"}, {Name: "mail-room", Shell: "m"}}}); err != nil {
		t.Fatal(err)
	}
	replans <- syscall.SIGHUP
	for range 2 {
		<-sup.running
	}
	cancel()
	<-done
	slices.Sort(sup.started)
	if want := []string{"api:a", "go:g", "go:g2", "langy:l", "mail-room:m"}; !slices.Equal(sup.started, want) {
		t.Errorf("started %v, want %v: api once, go twice, langy and mail-room once", sup.started, want)
	}
	if len(sup.stopped) != 5 {
		t.Errorf("stopped %v, want every lane stopped once the keeper ends", sup.stopped)
	}
}
