package app

import (
	"context"
	"io"
	"testing"

	"github.com/langwatch/langwatch/tools/thuishaven/domain"
)

// @scenario "Reloading and restarting the daemon leave the shared proxy running"
func TestReloadEnsuresTheProxyAfterwards(t *testing.T) {
	proxy := &downProxy{running: false}
	o := downOrchestrator([]domain.Stack{{Slug: "a", Refresh: domain.RefreshWatch}}, proxy)
	o.uiBuild = func(context.Context, string, io.Writer) error { return nil }

	if err := o.Reload(context.Background(), UpParams{WorktreeDir: "/wt/a"}, "ui"); err != nil {
		t.Fatalf("Reload: %v", err)
	}
	if proxy.ensured != 1 || proxy.shutdowns != 0 {
		t.Errorf("reload must leave a running proxy, starts=%d stops=%d", proxy.ensured, proxy.shutdowns)
	}
}

func TestReloadLeavesARunningProxyAlone(t *testing.T) {
	proxy := &downProxy{running: true}
	o := downOrchestrator([]domain.Stack{{Slug: "a", Refresh: domain.RefreshWatch}}, proxy)
	o.uiBuild = func(context.Context, string, io.Writer) error { return nil }

	if err := o.Reload(context.Background(), UpParams{WorktreeDir: "/wt/a"}, "ui"); err != nil {
		t.Fatalf("Reload: %v", err)
	}
	if proxy.ensured != 0 {
		t.Errorf("a running proxy must not be started again, starts=%d", proxy.ensured)
	}
}

// @scenario "Reloading and restarting the daemon leave the shared proxy running"
func TestRestartDaemonEnsuresTheProxyAfterwards(t *testing.T) {
	sys := &fakeSystem{
		alive:      map[int]bool{77: true, 78: true},
		portsInUse: map[int]bool{7000: true, 7001: true},
	}
	store := &fakeStore{stacks: []domain.Stack{{Slug: "a"}}}
	proxy := &downProxy{running: false}
	o := hubOrchestrator(store, sys, &proxy.fakeProxy, &fakeDBServer{}, &fakeDBServer{}, &fakeHygiene{})
	o.proxy = proxy
	o.cfg.DaemonArgv = []string{"/bin/haven", "daemon"}
	o.store = restartStore{fakeStore: store, sys: sys, old: DaemonInfo{PID: 77, Port: 7000}, next: DaemonInfo{PID: 78, Port: 7001}}

	if _, err := o.RestartDaemon("/repo"); err != nil {
		t.Fatalf("RestartDaemon: %v", err)
	}
	if proxy.ensured != 1 || proxy.shutdowns != 0 {
		t.Errorf("a daemon restart must leave the proxy up, starts=%d stops=%d", proxy.ensured, proxy.shutdowns)
	}
}
