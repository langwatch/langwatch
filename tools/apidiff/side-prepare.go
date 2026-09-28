package apidiff

import (
	"context"
	"fmt"
	"strings"
	"time"

	"golang.org/x/sync/errgroup"

	"github.com/langwatch/langwatch/tools/havenrun"
)

// runSide is one side of the run and the tree it runs from.
type runSide struct {
	name string
	dir  string
}

// sides are the two trees this run prepares, inventories and boots.
func (state *bootState) sides() []runSide {
	return []runSide{{name: "branch", dir: state.branchTree()}, {name: "main", dir: state.mainDir}}
}

// layout is the checkout shape havenrun's prepare steps branch on.
func (profile bootProfile) layout() havenrun.Layout {
	if profile.name == profileMonolith {
		return havenrun.LayoutMonolith
	}
	return havenrun.LayoutModular
}

// prepareTrees installs and generates both trees at once, once per run: the
// parity inventories and the boot then read the same prepared trees, and
// boot runs no install of its own. -skip-install takes both trees as they are.
func (state *bootState) prepareTrees(ctx context.Context) error {
	if state.cfg.SkipInstall {
		state.logf("prepare: -skip-install, both trees are used as they are")
		state.prepared = true
		return nil
	}
	group, groupCtx := errgroup.WithContext(ctx)
	for _, side := range state.sides() {
		group.Go(func() error { return state.prepareTree(groupCtx, side) })
	}
	if err := group.Wait(); err != nil {
		return err
	}
	state.prepared = true
	return nil
}

// prepareTree runs havenrun's prepare steps for the tree's own layout. The
// modular list ends with ensure-built, which builds every dist the route
// inventory and the API import; the monolith's generated-files script builds
// its own SDK and MCP server.
func (state *bootState) prepareTree(ctx context.Context, side runSide) error {
	profile, err := detectProfile(side.dir)
	if err != nil {
		return err
	}
	for _, step := range havenrun.PrepareCommands(profile.layout()) {
		argv := step.Name + " " + strings.Join(step.Args, " ")
		state.logf("prepare %s: %s (in %s)", side.name, argv, side.dir)
		started := time.Now()
		spec := commandSpec{name: step.Name, args: step.Args, dir: side.dir}
		if err := state.run(ctx, spec, state.sideLog(side.name)); err != nil {
			return fmt.Errorf("prepare %s (%s): %w", side.name, argv, err)
		}
		state.logf("prepare %s: %s done in %s", side.name, argv, time.Since(started).Round(time.Second))
	}
	state.timing("%s prepared", side.name)
	return nil
}

// startInfraEarly resolves and preflights the infrastructure, then brings it
// up in the background while both trees install; boot waits on infraReady.
func (state *bootState) startInfraEarly(ctx context.Context) error {
	if err := state.resolveInfra(); err != nil {
		return err
	}
	if err := state.preflight(ctx); err != nil {
		return err
	}
	done := make(chan struct{})
	state.infraDone = done
	go func() {
		defer close(done)
		state.infraErr = state.bringUpInfra(ctx)
	}()
	return nil
}

// bringUpInfra starts the managed stack, waits for Postgres to take writes
// and recreates both sides' databases.
func (state *bootState) bringUpInfra(ctx context.Context) error {
	if err := state.startInfra(ctx); err != nil {
		return err
	}
	if err := state.waitPostgres(ctx); err != nil {
		return err
	}
	return state.prepareDatabases(ctx)
}

// infraReady waits for what startInfraEarly began, or brings the
// infrastructure up now on a boot nothing started it for.
func (state *bootState) infraReady(ctx context.Context) error {
	if state.infraDone == nil {
		if err := state.resolveInfra(); err != nil {
			return err
		}
		if err := state.preflight(ctx); err != nil {
			return err
		}
		return state.bringUpInfra(ctx)
	}
	select {
	case <-state.infraDone:
		return state.infraErr
	case <-ctx.Done():
		return ctx.Err()
	}
}
