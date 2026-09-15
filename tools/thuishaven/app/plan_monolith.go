package app

import (
	"fmt"

	"github.com/langwatch/langwatch/tools/thuishaven/domain"
)

// The monolith plan: what haven supervises when the checkout is origin/main's
// layout. One Node process serves the browser application and its API there
// (platform/app, @langwatch/web), so the stack has ONE Node lane, named app.
// The hostnames, the ports and the injected environment are unchanged - only
// the process set behind them differs, because only the checkout differs.

// monolithPlan is what the monolith children are planned from: the stack, the
// options, and the lookups planChildren already owns.
type monolithPlan struct {
	Stack   domain.Stack
	Opts    PlanOptions
	RepoDir string
	Base    []string
	NodeEnv func(lane string) []string
	LogPath func(lane string) string
	Port    func(service string) int
}

// monolithScript runs one of the monolith package's own scripts from the
// workspace root, so the lane never depends on a path staying where it is.
func monolithScript(name string) string {
	return "pnpm -s --filter " + domain.MonolithPackage + " run " + name
}

// appChild is the single Node lane: `dev:app`, which starts the browser
// application and the API in one process. PORT is the app port haven
// allocated, because that checkout derives its other local ports from it; the
// API port is already in the injected environment (LANGWATCH_API_PORT).
//
// The skip flags are that checkout's own opt-outs: without them its start
// script starts a second gateway and NLP engine, on ports haven never routed.
//
// No readiness probe - the lane would be waiting for itself.
func (p monolithPlan) appChild() Child {
	lane := domain.MonolithAppLane
	return Child{
		Name: lane, Dir: p.RepoDir, Color: palette[1], LogPath: p.LogPath(lane),
		Shell: monolithScript("dev:app"),
		Env: append(p.NodeEnv(lane),
			fmt.Sprintf("PORT=%d", p.Port("app")),
			"LANGWATCH_SKIP_AIGATEWAY=1",
			"LANGWATCH_SKIP_NLP=1"),
	}
}

// goChildren are the Go data-plane services as that checkout can run them: one
// process each. Its mono-binary has no combined subcommand and its makefile
// takes no service list, so the single `go` lane cannot exist there.
//
// `make service`, never `make service-watch`: that watch target refuses to
// start without a dotenv file inside the monolith package, which a freshly
// checked-out base ref does not have.
//
// Each waits for the health path first: the control plane they call on their
// way up is the app lane, so starting together is connection-refused noise.
func (p monolithPlan) goChildren() []Child {
	var out []Child
	for _, svc := range []struct {
		lane, binary string
		selected     bool
	}{
		{"gateway", "aigateway", p.Opts.Selection.Gateway},
		{"nlp", "nlpgo", p.Opts.Selection.NLP},
	} {
		if !svc.selected {
			continue
		}
		out = append(out, Child{
			Name: svc.lane, Dir: p.Opts.RepoRoot, Color: palette[2], LogPath: p.LogPath(svc.lane),
			Shell: goServiceShell(p.Opts.RepoRoot, svc.binary, false),
			Env: append(append([]string{}, p.Base...),
				fmt.Sprintf("SERVER_ADDR=:%d", p.Port(svc.lane)), domain.LaneEnv(svc.lane)),
			ReadyProbeURL: p.Stack.HealthProbeURL(),
		})
	}
	return out
}
