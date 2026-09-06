package app

import (
	"context"
	"errors"
	"testing"

	"go.uber.org/zap"

	"github.com/langwatch/langwatch/tools/thuishaven/domain"
)

// tierContainer is a container runtime whose presence on the machine, and
// whose ability to start, are each set by the test.
type tierContainer struct {
	available bool
	ensureErr error
}

func (c *tierContainer) Ensure(context.Context) (string, error) {
	if c.ensureErr != nil {
		return "", c.ensureErr
	}
	return "unix:///tier.sock", nil
}
func (c *tierContainer) Profile() string                { return "tier" }
func (c *tierContainer) Available(context.Context) bool { return c.available }

func tierOrch(container ContainerRuntime) *Orchestrator {
	return &Orchestrator{container: container, log: zap.NewNop()}
}

// @scenario "No container runtime on a development machine runs langy on the host"
// @scenario "A development machine with a container runtime keeps the sandbox"
// @scenario "A non-development stack with no container runtime keeps the sandbox"
// @scenario "An explicit isolation choice is never overridden by the machine"
func TestResolveLangyTierAgainstTheMachine(t *testing.T) {
	ctx := context.Background()
	devOpts := func() PlanOptions {
		return PlanOptions{
			Selection:        domain.Selection{Langy: true},
			LangyTierRequest: domain.LangyTierRequest{IsDevelopment: true},
		}
	}

	t.Run("given a development stack", func(t *testing.T) {
		t.Run("when no container runtime is reachable, it resolves to the host tier", func(t *testing.T) {
			opts := devOpts()
			tierOrch(&tierContainer{available: false}).resolveLangyTier(ctx, &opts)
			if opts.LangyTier != domain.LangyTierHostUnsafe {
				t.Fatalf("got %v, want host-unsafe", opts.LangyTier)
			}
		})

		// No container runtime is CONFIGURED at all — the same answer as one that
		// is configured and missing, since neither can run a container tier.
		t.Run("when haven has no container runtime wired, it resolves to the host tier", func(t *testing.T) {
			opts := devOpts()
			tierOrch(nil).resolveLangyTier(ctx, &opts)
			if opts.LangyTier != domain.LangyTierHostUnsafe {
				t.Fatalf("got %v, want host-unsafe", opts.LangyTier)
			}
		})

		t.Run("when a container runtime is reachable, it keeps the sandboxed tier", func(t *testing.T) {
			opts := devOpts()
			tierOrch(&tierContainer{available: true}).resolveLangyTier(ctx, &opts)
			if opts.LangyTier != domain.LangyTierSandboxed {
				t.Fatalf("got %v, want sandboxed", opts.LangyTier)
			}
		})

		t.Run("when the developer asked for a tier, the machine does not overrule it", func(t *testing.T) {
			opts := devOpts()
			opts.LangyTierRequest.UnsafeContainer = true
			tierOrch(&tierContainer{available: false}).resolveLangyTier(ctx, &opts)
			if opts.LangyTier != domain.LangyTierContainerUnsafe {
				t.Fatalf("got %v, want container-unsafe", opts.LangyTier)
			}
		})

		t.Run("when the developer refused host access, no runtime keeps the sandboxed tier", func(t *testing.T) {
			opts := devOpts()
			opts.LangyTierRequest.HostAccessRefused = true
			tierOrch(&tierContainer{available: false}).resolveLangyTier(ctx, &opts)
			if opts.LangyTier != domain.LangyTierSandboxed {
				t.Fatalf("got %v, want sandboxed", opts.LangyTier)
			}
		})
	})

	t.Run("given a stack that is not a development stack", func(t *testing.T) {
		t.Run("when no container runtime is reachable, it keeps the sandboxed tier", func(t *testing.T) {
			opts := PlanOptions{Selection: domain.Selection{Langy: true}}
			tierOrch(&tierContainer{available: false}).resolveLangyTier(ctx, &opts)
			if opts.LangyTier != domain.LangyTierSandboxed {
				t.Fatalf("got %v, want sandboxed", opts.LangyTier)
			}
		})

		// And the sandboxed tier it kept still fails closed at launch: langy is
		// deselected rather than dropped to the host runner behind anyone's back.
		t.Run("when the container cannot be prepared, langy is deselected", func(t *testing.T) {
			opts := PlanOptions{Selection: domain.Selection{Langy: true}}
			o := tierOrch(&tierContainer{ensureErr: errors.New("colima is not installed")})
			o.resolveLangyTier(ctx, &opts)
			if dh := o.langyContainerHost(ctx, domain.Stack{LangyTier: opts.LangyTier}, &opts); dh != "" {
				t.Fatalf("a failed container must yield no docker host, got %q", dh)
			}
			if opts.Selection.Langy {
				t.Error("langy must be deselected when its container cannot be prepared")
			}
		})
	})
}
