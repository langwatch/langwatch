package app

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"sync"
	"time"

	"github.com/langwatch/langwatch/tools/thuishaven/domain"
)

// docsOnlyFile records a running `haven up --only docs` in the worktree's log
// directory, so `haven browser`, `haven logs`, `haven status` and `haven down`
// find the docs with no stack registered.
const docsOnlyFile = "docs-only.json"

// DocsOnlyRun is a live `haven up --only docs`: its launcher, its URL and the
// directory its docs.log capture is in.
type DocsOnlyRun struct {
	PID    int    `json:"pid"`
	URL    string `json:"url"`
	LogDir string `json:"logDir"`
}

// RunDocsSolo runs only the docs site: no app, no API, no worker, no databases,
// no simulators. Like RunIdPSolo it allocates a port and routes this worktree's
// docs.<slug>.langwatch.localhost at it (loopback without the proxy); the lane
// is supervised and captured to docs.log, as in a stack, until ctx ends.
func (o *Orchestrator) RunDocsSolo(ctx context.Context, p UpParams) error {
	slug, err := o.resolveSlug(p)
	if err != nil {
		return err
	}
	release, _, err := o.sem.Acquire(ctx, "up-"+slug, 1)
	if err != nil {
		return err
	}
	endRegistration := sync.OnceFunc(release)
	defer endRegistration()
	if err := o.DocsSoloRefusal(p); err != nil {
		return err
	}
	ports, err := o.sys.FreePorts(1)
	if err != nil {
		return fmt.Errorf("allocating a port for the docs site: %w", err)
	}
	port := ports[0]
	logDir, _ := domain.StackLogPaths(p.WorktreeDir, slug)
	docsURL, unroute := o.routeDocs(slug, port)
	removeRecord := o.recordDocsOnly(DocsOnlyRun{PID: o.sys.Getpid(), URL: docsURL, LogDir: logDir})
	// Keep the startup claim until route cleanup, so a new stack cannot lose its route.
	defer removeRecord()
	defer unroute()
	endRegistration()
	fmt.Printf("  docs  %s\n", docsURL)
	o.sup.Supervise(ctx, []Child{{
		Name: domain.DocsService, Dir: p.WorktreeDir, Color: palette[4],
		LogPath: filepath.Join(logDir, domain.DocsService+".log"),
		Shell:   docsShell(port), Env: []string{domain.LaneEnv(domain.DocsService)},
	}})
	return nil
}

// DocsSoloRefusal is why `haven up --only docs` cannot start here, or nil: a
// running stack (which takes +docs instead) or docs already running alone.
func (o *Orchestrator) DocsSoloRefusal(p UpParams) error {
	slug, err := o.resolveSlug(p)
	if err != nil {
		return err
	}
	if st, ok := o.stackBySlug(slug); ok && o.sys.ProcessAlive(st.LauncherPID) {
		return errors.New("this worktree's stack is running; `haven up +docs` adds the docs to it, or `haven down` first")
	}
	if run, ok := o.DocsOnly(p); ok {
		return fmt.Errorf("the docs already run alone here (pid %d) at %s; `haven down` stops them", run.PID, run.URL)
	}
	return nil
}

// routeDocs routes docs.<slug> at port when the proxy is available and returns
// the URL to print, plus the removal; loopback otherwise.
func (o *Orchestrator) routeDocs(slug string, port int) (string, func()) {
	loopback := fmt.Sprintf("http://127.0.0.1:%d", port)
	if o.cfg.PortlessDisabled {
		return loopback, func() {}
	}
	if err := o.proxy.EnsureReady(); err != nil {
		o.log.Warn("portless is unavailable — serving the docs on loopback only", zapErr(err))
		return loopback, func() {}
	}
	if err := o.proxy.Register(domain.DocsService, slug, port); err != nil {
		o.log.Warn("could not route the docs hostname — serving on loopback only", zapErr(err))
		return loopback, func() {}
	}
	scheme, proxyPort := o.proxy.Endpoint()
	return o.cfg.Naming.URL(domain.DocsService, slug, scheme, proxyPort), func() { o.proxy.Remove(domain.DocsService, slug) }
}

// recordDocsOnly writes the docs-only record and returns its removal.
func (o *Orchestrator) recordDocsOnly(run DocsOnlyRun) func() {
	marker := filepath.Join(run.LogDir, docsOnlyFile)
	data, err := json.Marshal(run)
	if err != nil || os.MkdirAll(run.LogDir, 0o750) != nil || os.WriteFile(marker, data, 0o600) != nil {
		return func() {}
	}
	return func() { _ = os.Remove(marker) }
}

// DocsOnly is this worktree's live `haven up --only docs`, if one runs.
func (o *Orchestrator) DocsOnly(p UpParams) (DocsOnlyRun, bool) {
	slug, err := o.resolveSlug(p)
	if err != nil {
		return DocsOnlyRun{}, false
	}
	logDir, _ := domain.StackLogPaths(p.WorktreeDir, slug)
	data, err := os.ReadFile(filepath.Join(logDir, docsOnlyFile))
	var run DocsOnlyRun
	if err != nil || json.Unmarshal(data, &run) != nil || run.PID == 0 || !o.sys.ProcessAlive(run.PID) {
		return DocsOnlyRun{}, false
	}
	return run, true
}

// StopDocsOnly stops this worktree's `haven up --only docs`, waiting a bounded
// while for it to remove its route; it reports whether one was running.
func (o *Orchestrator) StopDocsOnly(ctx context.Context, p UpParams) bool {
	run, ok := o.DocsOnly(p)
	if !ok {
		return false
	}
	o.sys.Terminate(run.PID)
	for deadline := time.Now().Add(15 * time.Second); time.Now().Before(deadline) && o.sys.ProcessAlive(run.PID); {
		select {
		case <-ctx.Done():
			return true
		case <-time.After(100 * time.Millisecond):
		}
	}
	return true
}
