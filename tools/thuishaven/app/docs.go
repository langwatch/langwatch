package app

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"

	"github.com/langwatch/langwatch/tools/thuishaven/domain"
)

// docsOnlyFile records a running `haven up --only docs` in the worktree's log
// directory, so `haven browser` can open the docs with no stack overlay.
const docsOnlyFile = "docs-only.json"

type docsOnlyRun struct {
	PID int    `json:"pid"`
	URL string `json:"url"`
}

// RunDocsSolo runs only the docs site: no app, no API, no worker, no databases,
// no simulators. Like RunIdPSolo it allocates a port, routes this worktree's
// docs.<slug>.langwatch.localhost at it when the proxy is available (loopback
// otherwise) and runs the dev server in the foreground until ctx ends.
func (o *Orchestrator) RunDocsSolo(ctx context.Context, p UpParams) error {
	slug, err := o.resolveSlug(p)
	if err != nil {
		return err
	}
	if st, ok := o.stackBySlug(slug); ok && o.sys.ProcessAlive(st.LauncherPID) {
		return errors.New("this worktree's stack is running; `haven up +docs` adds the docs to it, or `haven down` first")
	}
	ports, err := o.sys.FreePorts(1)
	if err != nil {
		return fmt.Errorf("allocating a port for the docs site: %w", err)
	}
	port := ports[0]
	docsURL, unroute := o.routeDocs(slug, port)
	defer unroute()
	defer o.recordDocsOnly(p.WorktreeDir, slug, docsURL)()
	fmt.Printf("  docs  %s\n", docsURL)
	return o.sup.RunOnce(ctx, domain.DocsService, p.WorktreeDir, docsShell(port), []string{domain.LaneEnv(domain.DocsService)})
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
func (o *Orchestrator) recordDocsOnly(worktreeDir, slug, docsURL string) func() {
	logDir, _ := domain.StackLogPaths(worktreeDir, slug)
	marker := filepath.Join(logDir, docsOnlyFile)
	data, err := json.Marshal(docsOnlyRun{PID: o.sys.Getpid(), URL: docsURL})
	if err != nil || os.MkdirAll(logDir, 0o750) != nil || os.WriteFile(marker, data, 0o600) != nil {
		return func() {}
	}
	return func() { _ = os.Remove(marker) }
}

// DocsOnlyURL is the docs URL of this worktree's live `haven up --only docs`,
// or "" when none runs.
func (o *Orchestrator) DocsOnlyURL(p UpParams) string {
	slug, err := o.resolveSlug(p)
	if err != nil {
		return ""
	}
	logDir, _ := domain.StackLogPaths(p.WorktreeDir, slug)
	data, err := os.ReadFile(filepath.Join(logDir, docsOnlyFile))
	var run docsOnlyRun
	if err != nil || json.Unmarshal(data, &run) != nil || run.PID == 0 || !o.sys.ProcessAlive(run.PID) {
		return ""
	}
	return run.URL
}
