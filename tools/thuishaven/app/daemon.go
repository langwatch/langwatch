package app

import (
	"context"
	"fmt"
	"path/filepath"
	"time"

	"go.uber.org/zap"
)

// ensureDaemon guarantees a single machine-wide daemon is running, spawning one
// (detached) if not. Running `up` from any branch reuses the same daemon, so the
// dashboard, telemetry fan-out, and registry are shared — the multi-branch
// management the daemon exists for.
func (o *Orchestrator) ensureDaemon(worktreeDir string) {
	if o.daemonAlive() {
		return
	}
	logPath := filepath.Join(o.cfg.Home, "haven.log")
	if err := o.sys.SpawnDetached(o.cfg.DaemonArgv, worktreeDir, logPath); err != nil {
		o.log.Warn("could not spawn haven daemon", zap.Error(err))
		return
	}
	for i := 0; i < 50; i++ {
		if o.daemonAlive() {
			return
		}
		time.Sleep(100 * time.Millisecond)
	}
	o.log.Warn("haven daemon did not report ready in time (dashboard may be unavailable)")
}

func (o *Orchestrator) daemonAlive() bool {
	info, ok := o.store.Daemon()
	return ok && o.sys.ProcessAlive(info.PID)
}

// RunDaemon is the singleton server + monitor. It registers the shared surfaces
// (dashboard, telemetry, observability), serves them, and reaps stacks whose
// launcher has exited or gone stale.
func (o *Orchestrator) RunDaemon(ctx context.Context, dash Dashboard) error {
	if o.daemonAlive() {
		fmt.Println("haven daemon already running")
		return nil
	}
	ports, err := o.sys.FreePorts(1)
	if err != nil {
		return err
	}
	port := ports[0]
	info := DaemonInfo{PID: o.sys.Getpid(), Port: port, URL: fmt.Sprintf("http://127.0.0.1:%d", port)}
	// Save readiness FIRST so `up` finds us immediately, then wire up routes.
	if err := o.store.SaveDaemon(info); err != nil {
		return err
	}
	defer o.store.ClearDaemon()

	p := o.cfg.Naming.Project
	_ = o.proxy.Register(p, "", port)           // langwatch.localhost (dashboard)
	_ = o.proxy.Register("telemetry", "", port) // telemetry.langwatch.localhost (fan-out)
	o.refreshObservability()
	defer func() {
		o.proxy.Remove(p, "")
		o.proxy.Remove("telemetry", "")
	}()

	scheme, pport := o.proxy.Endpoint()
	o.log.Info("haven daemon up",
		zap.Int("port", port),
		zap.String("dashboard", o.cfg.Naming.URL(p, "", scheme, pport)))
	go o.monitorLoop(ctx)
	return dash.Serve(ctx, port)
}

// monitorLoop prunes stacks whose launcher has died (crashed pnpm dev, closed
// terminal) or whose heartbeat has gone stale past the idle TTL — pulling the
// whole stack down, routes and all.
func (o *Orchestrator) monitorLoop(ctx context.Context) {
	t := time.NewTicker(10 * time.Second)
	defer t.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-t.C:
			now := o.sys.Now()
			for _, s := range o.store.Stacks() {
				dead := s.LauncherPID != 0 && !o.sys.ProcessAlive(s.LauncherPID)
				stale := s.Stale(now, o.cfg.IdleTTL)
				if !dead && !stale {
					continue
				}
				if stale && !dead {
					o.sys.Terminate(s.LauncherPID) // let the launcher stop its own children
				}
				for _, svc := range s.Services {
					o.proxy.Remove(svc.Name, s.Slug)
				}
				o.store.RemoveStack(s.Slug)
				o.log.Info("reaped stack", zap.String("slug", s.Slug), zap.Bool("dead", dead), zap.Bool("stale", stale))
			}
			o.refreshObservability()
		}
	}
}

// refreshObservability points observability.langwatch.localhost at the local
// Grafana LGTM stack whenever it is listening.
func (o *Orchestrator) refreshObservability() {
	p := o.cfg.ObservabilityPort
	if p == 0 {
		p = 3000
	}
	if o.sys.PortInUse(p) {
		_ = o.proxy.Register("observability", "", p)
	}
}
