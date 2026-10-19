package app

import (
	"context"
	"strings"
	"testing"

	"github.com/langwatch/langwatch/tools/thuishaven/domain"
)

// probedContainer counts IsRunning calls; Ensure fails the test, because
// status must never start the VM.
type probedContainer struct {
	t         *testing.T
	isRunning bool
	probes    int
}

func (c *probedContainer) Ensure(context.Context) (string, error) {
	c.t.Fatal("status started the colima VM")
	return "", nil
}
func (c *probedContainer) Profile() string                { return "default" }
func (c *probedContainer) Available(context.Context) bool { return true }
func (c *probedContainer) IsRunning(context.Context) bool {
	c.probes++
	return c.isRunning
}

func colimaOrch(container ContainerRuntime, stacks []domain.Stack) *Orchestrator {
	return &Orchestrator{
		cfg: Config{
			ShouldManageClickHouse: true, ClickHouseRuntime: domain.ClickHouseRuntimeNative,
			ShouldStartObservability: true, ObservabilityTier: domain.ObservabilityTierNative,
		},
		store: &fakeStore{stacks: stacks}, container: container,
	}
}

// @scenario "Status reports an unneeded VM without probing it"
func TestStatusReportsUnneededColimaWithoutProbing(t *testing.T) {
	c := &probedContainer{t: t}
	h := colimaOrch(c, []domain.Stack{{Slug: "a"}}).colimaHealth(context.Background())
	if !h.OK || !strings.HasPrefix(h.Detail, "not needed") {
		t.Errorf("health = %+v, want ok and not needed", h)
	}
	if c.probes != 0 {
		t.Errorf("IsRunning probed %d times, want 0", c.probes)
	}
}

// @scenario "Status probes the VM only when a feature needs it"
func TestStatusProbesColimaWhenSandboxedLangyNeedsIt(t *testing.T) {
	c := &probedContainer{t: t}
	h := colimaOrch(c, []domain.Stack{{Slug: "b", LangyImage: "langy:abc"}}).colimaHealth(context.Background())
	if h.OK || !strings.Contains(h.Detail, "stopped") || !strings.Contains(h.Detail, "sandboxed langy (b)") {
		t.Errorf("health = %+v, want a stopped profile needed by sandboxed langy", h)
	}
	if c.probes != 1 {
		t.Errorf("IsRunning probed %d times, want 1", c.probes)
	}
}
