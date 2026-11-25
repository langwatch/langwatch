package app

import (
	"context"
	"strings"
	"testing"

	"go.uber.org/zap"

	"github.com/langwatch/langwatch/tools/thuishaven/domain"
)

func vmOffStore(stacks []domain.Stack) *fakeStore {
	return &fakeStore{stacks: stacks, machineSettings: domain.MachineSettings{VMOff: true}}
}

// @scenario "With the VM off, sandboxed Langy is refused, never run unsandboxed"
func TestVMOffRefusesSandboxedLangyWithoutTheHostTier(t *testing.T) {
	ctx := context.Background()
	for _, vmOff := range []bool{false, true} {
		o := tierOrch(&tierContainer{available: true})
		o.store = &fakeStore{machineSettings: domain.MachineSettings{VMOff: vmOff}}
		opts := PlanOptions{
			Selection:        domain.Selection{Langy: true},
			LangyTierRequest: domain.LangyTierRequest{IsDevelopment: true},
		}
		o.resolveLangyTier(ctx, &opts)
		if opts.LangyTier != domain.LangyTierSandboxed {
			t.Fatalf("vm off %v: tier %v, want sandboxed (never the host tier)", vmOff, opts.LangyTier)
		}
		if opts.Selection.Langy == vmOff {
			t.Errorf("vm off %v: langy selected = %v", vmOff, opts.Selection.Langy)
		}
	}
}

func TestVMOffKeepsTheMacHostTier(t *testing.T) {
	o := tierOrch(&tierContainer{available: true})
	o.store = vmOffStore(nil)
	opts := PlanOptions{
		Selection:        domain.Selection{Langy: true},
		LangyTierRequest: domain.LangyTierRequest{IsDevelopment: true, IsMacOS: true},
	}
	o.resolveLangyTier(context.Background(), &opts)
	if opts.LangyTier != domain.LangyTierHostUnsafe || !opts.Selection.Langy {
		t.Errorf("tier %v, langy %v: the host tier needs no VM", opts.LangyTier, opts.Selection.Langy)
	}
}

// @scenario "With the VM off, haven pr --throwaway is refused"
func TestVMOffRefusesAThrowawaySandbox(t *testing.T) {
	o := &Orchestrator{store: vmOffStore(nil), container: &probedContainer{t: t}, log: zap.NewNop()}
	_, err := o.ensurePlayRuntime(context.Background())
	if err == nil || !strings.HasPrefix(err.Error(), "haven pr --throwaway needs the Colima VM") {
		t.Errorf("err = %v", err)
	}
}

// @scenario "With the VM off, a VM haven started is stopped once nothing runs on it"
func TestVMOffStopsHavensVMEvenWhenAStackRecordsAContainer(t *testing.T) {
	stacks := []domain.Stack{{Slug: "b", LangyImage: "langy:abc"}}
	for _, vmOff := range []bool{false, true} {
		c := &idleContainer{}
		o := idleOrch(c, stacks)
		o.store = &fakeStore{stacks: stacks, machineSettings: domain.MachineSettings{VMOff: vmOff}}
		o.stopColimaIfIdle(context.Background())
		want := 0
		if vmOff {
			want = 1 // StopIfIdle: haven's own VM only, and only while empty
		}
		if c.stopCalls != want {
			t.Errorf("vm off %v: StopIfIdle calls = %d, want %d", vmOff, c.stopCalls, want)
		}
	}
}

// @scenario "Status shows the VM switched off"
func TestStatusShowsTheVMSwitchedOffWithoutProbing(t *testing.T) {
	c := &probedContainer{t: t}
	o := colimaOrch(c, []domain.Stack{{Slug: "b", LangyImage: "langy:abc"}})
	o.store = vmOffStore([]domain.Stack{{Slug: "b", LangyImage: "langy:abc"}})
	h := o.colimaHealth(context.Background())
	if !h.OK || !strings.HasPrefix(h.Detail, "off (machine setting vm)") || c.probes != 0 {
		t.Errorf("health = %+v, probes %d", h, c.probes)
	}
}
