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
// no simulators. It builds the docs under /docs, serves them natively and routes
// app.<slug> and docs.<slug> at the mount (loopback without the proxy); the lane
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
	removeRecord, err := o.recordDocsOnly(DocsOnlyRun{PID: o.sys.Getpid(), URL: docsURL, LogDir: logDir})
	if err != nil {
		unroute()
		return err
	}
	// Keep the startup claim until route cleanup, so a new stack cannot lose its route.
	defer removeRecord()
	defer unroute()
	endRegistration()
	fmt.Printf("  docs  %s%s/\n", docsURL, DocsBasePath)
	o.sup.Supervise(ctx, []Child{{
		Name: domain.DocsService, Dir: p.WorktreeDir, Color: palette[4],
		LogPath: filepath.Join(logDir, domain.DocsService+".log"),
		Shell:   o.docsMountShell(p.WorktreeDir, port, nil), Env: []string{domain.LaneEnv(domain.DocsService)},
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

// routeDocs routes app.<slug> and docs.<slug> at the mount on port when the proxy
// is available and returns the app URL to print, plus the removal; loopback otherwise.
// A stack never runs beside it (DocsSoloRefusal), so the app hostname is free.
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
	if err := o.proxy.Register("app", slug, port); err != nil {
		o.log.Warn("could not route the app hostname to the docs", zapErr(err))
		return o.cfg.Naming.URL(domain.DocsService, slug, scheme, proxyPort), func() { o.proxy.Remove(domain.DocsService, slug) }
	}
	return o.cfg.Naming.URL("app", slug, scheme, proxyPort), func() {
		o.proxy.Remove("app", slug)
		o.proxy.Remove(domain.DocsService, slug)
	}
}

// recordDocsOnly writes the docs-only record and returns its removal. Without
// the record `haven down` and `haven status` cannot find the docs, so a failed
// write stops the run instead of starting docs nothing else can see.
func (o *Orchestrator) recordDocsOnly(run DocsOnlyRun) (func(), error) {
	marker := filepath.Join(run.LogDir, docsOnlyFile)
	data, err := json.Marshal(run)
	if err != nil {
		return nil, fmt.Errorf("encoding the docs-only record: %w", err)
	}
	if err := os.MkdirAll(run.LogDir, 0o750); err != nil {
		return nil, fmt.Errorf("creating the docs log directory: %w", err)
	}
	if err := os.WriteFile(marker, data, 0o600); err != nil {
		return nil, fmt.Errorf("writing the docs-only record: %w", err)
	}
	return func() { _ = os.Remove(marker) }, nil
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
