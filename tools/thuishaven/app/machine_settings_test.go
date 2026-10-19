package app

import (
	"context"
	"slices"
	"testing"
	"time"

	"go.uber.org/zap"

	"github.com/langwatch/langwatch/tools/thuishaven/domain"
)

type fakeObs struct {
	running bool
	ensures int
	stops   int
}

func (f *fakeObs) Ensure(context.Context) (domain.ObservabilityEndpoints, error) {
	f.ensures++
	f.running = true
	return f.Endpoints(), nil
}
func (f *fakeObs) Stop(context.Context) error {
	f.stops++
	f.running = false
	return nil
}
func (f *fakeObs) IsRunning(context.Context) bool        { return f.running }
func (f *fakeObs) Health(context.Context) (bool, string) { return f.running, "" }
func (f *fakeObs) Endpoints() domain.ObservabilityEndpoints {
	return domain.ObservabilityEndpoints{OTLPHTTPPort: 4318, GrafanaPort: 3000}
}

func settingsOrch(obs *fakeObs, settings domain.MachineSettings) (*Orchestrator, *fakeStore, *fakeProxy) {
	store := &fakeStore{machineSettings: settings}
	proxy := &fakeProxy{}
	return &Orchestrator{
		cfg:   Config{ShouldStartObservability: true},
		store: store, obs: obs, proxy: proxy, log: zap.NewNop(), sys: &fakeSystem{now: time.Now()},
	}, store, proxy
}

// @scenario "Switching observability off stops the stack"
func TestSwitchingObservabilityOffStopsTheStack(t *testing.T) {
	obs := &fakeObs{running: true}
	o, store, proxy := settingsOrch(obs, domain.MachineSettings{})
	if _, err := o.SetMachineSetting(context.Background(), domain.SettingObservability, "off"); err != nil {
		t.Fatalf("SetMachineSetting: %v", err)
	}
	if !store.machineSettings.ObservabilityOff {
		t.Error("the setting was not saved")
	}
	if obs.stops != 1 || obs.running {
		t.Errorf("stops = %d, running = %v", obs.stops, obs.running)
	}
	if !slices.Contains(proxy.removed, domain.ObservabilityService+".") {
		t.Errorf("hostname not unrouted: %v", proxy.removed)
	}
}

// @scenario "The daemon keeps a switched-off stack down"
func TestDaemonTickStopsASwitchedOffStack(t *testing.T) {
	obs := &fakeObs{running: true}
	o, store, _ := settingsOrch(obs, domain.MachineSettings{ObservabilityOff: true})
	o.refreshObservability(context.Background())
	if obs.stops != 1 {
		t.Errorf("stops = %d, want 1", obs.stops)
	}
	if len(store.reapEvents) != 1 || store.reapEvents[0].Kind != "observability" {
		t.Errorf("reap events = %+v", store.reapEvents)
	}
}

// @scenario "A stack coming up with observability off gets no collector"
func TestStackUpWithObservabilityOffGetsNoCollector(t *testing.T) {
	obs := &fakeObs{}
	o, _, _ := settingsOrch(obs, domain.MachineSettings{ObservabilityOff: true})
	var st domain.Stack
	o.linkObservability(context.Background(), &st)
	if obs.ensures != 0 || st.ObservabilityOTLPPort != 0 {
		t.Errorf("ensures = %d, otlp port = %d; want none", obs.ensures, st.ObservabilityOTLPPort)
	}
}

// @scenario "Switching observability on brings the stack back"
func TestSwitchingObservabilityOnBringsTheStackBack(t *testing.T) {
	obs := &fakeObs{}
	o, store, _ := settingsOrch(obs, domain.MachineSettings{ObservabilityOff: true})
	if _, err := o.SetMachineSetting(context.Background(), domain.SettingObservability, "on"); err != nil {
		t.Fatalf("SetMachineSetting: %v", err)
	}
	if store.machineSettings.ObservabilityOff || obs.ensures != 1 {
		t.Errorf("settings = %+v, ensures = %d", store.machineSettings, obs.ensures)
	}
}

func TestUnknownMachineSettingIsRefusedAndNothingSaved(t *testing.T) {
	o, store, _ := settingsOrch(&fakeObs{}, domain.MachineSettings{})
	if _, err := o.SetMachineSetting(context.Background(), "nope", "on"); err == nil {
		t.Error("an unknown setting was accepted")
	}
	if store.machineSettings != (domain.MachineSettings{}) {
		t.Errorf("settings changed: %+v", store.machineSettings)
	}
}

type emptyStoppable struct {
	probedContainer
	containers int
	stops      int
}

func (c *emptyStoppable) RunningContainers(context.Context) (int, error) { return c.containers, nil }
func (c *emptyStoppable) StopWhenEmpty(context.Context) (bool, error) {
	c.stops++
	return true, nil
}

func autoStopOrch(c *emptyStoppable) (*Orchestrator, *fakeSystem) {
	sys := &fakeSystem{now: time.Now()}
	o := colimaOrch(c, nil)
	o.log, o.sys = zap.NewNop(), sys
	o.store.(*fakeStore).machineSettings = domain.MachineSettings{RuntimeAutoStop: true, RuntimeIdleGraceMinutes: 10}
	return o, sys
}

// @scenario "An idle VM is stopped after the grace period"
func TestIdleVMIsStoppedAfterTheGrace(t *testing.T) {
	c := &emptyStoppable{probedContainer: probedContainer{t: t, isRunning: true}}
	o, sys := autoStopOrch(c)
	o.stopColimaIfIdle(context.Background()) // starts the idle clock
	sys.now = sys.now.Add(11 * time.Minute)
	o.stopColimaIfIdle(context.Background())
	if c.stops != 1 {
		t.Errorf("stops = %d, want 1", c.stops)
	}
}

// @scenario "The VM is not stopped before the grace period ends"
func TestVMIsNotStoppedBeforeTheGrace(t *testing.T) {
	c := &emptyStoppable{probedContainer: probedContainer{t: t, isRunning: true}}
	o, sys := autoStopOrch(c)
	o.stopColimaIfIdle(context.Background())
	sys.now = sys.now.Add(9 * time.Minute)
	o.stopColimaIfIdle(context.Background())
	if c.stops != 0 {
		t.Errorf("stops = %d, want 0", c.stops)
	}
}

// @scenario "A running container keeps the VM up"
func TestRunningContainerKeepsTheVMUp(t *testing.T) {
	c := &emptyStoppable{probedContainer: probedContainer{t: t, isRunning: true}}
	o, sys := autoStopOrch(c)
	o.stopColimaIfIdle(context.Background())
	c.containers = 1
	sys.now = sys.now.Add(11 * time.Minute)
	o.stopColimaIfIdle(context.Background())
	c.containers = 0
	sys.now = sys.now.Add(time.Minute)
	o.stopColimaIfIdle(context.Background()) // the clock restarts here
	if c.stops != 0 || !o.runtimeIdleSince.Equal(sys.now) {
		t.Errorf("stops = %d, idle since %s, want 0 and now", c.stops, o.runtimeIdleSince)
	}
}
