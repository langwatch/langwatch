package app

import (
	"fmt"

	"github.com/langwatch/langwatch/tools/thuishaven/domain"
)

// SessionServiceStatus is one supervised service as the attached session
// dashboard shows it: CLI-spelled name, where it is reached, whether its port
// answers, and whether `r` can bounce it (fallbacks and shared servers can't).
type SessionServiceStatus struct {
	Name        string `json:"name"`
	Role        string `json:"role"`
	URL         string `json:"url"`
	Port        int    `json:"port"`
	Up          bool   `json:"up"`
	Fallback    bool   `json:"fallback,omitempty"`
	Restartable bool   `json:"restartable"`
}

// SessionServer is one piece of shared machinery the stack leans on — the
// proxy, the daemon, and the managed database servers. These are machine-wide,
// not stack children, so the dashboard reports them but never offers a bounce.
type SessionServer struct {
	Name   string `json:"name"`
	Up     bool   `json:"up"`
	Detail string `json:"detail,omitempty"`
}

// SessionReport is the whole live picture behind the session dashboard's first
// tab: the stack's own services plus the shared servers, assembled from cheap
// probes (port checks, process liveness, group RSS) so the view can refresh
// every second without touching docker.
type SessionReport struct {
	Slug      string                 `json:"slug"`
	Branch    string                 `json:"branch"`
	Found     bool                   `json:"found"`
	Live      bool                   `json:"live"`
	RSS       uint64                 `json:"rssBytes"`
	Services  []SessionServiceStatus `json:"services"`
	Servers   []SessionServer        `json:"servers"`
	Dashboard string                 `json:"dashboard"`
	TLD       string                 `json:"tld"`
}

// SessionSnapshot builds the dashboard's live picture for one slug. It only
// runs cheap probes — no health pings that shell into docker — so the attached
// view can call it on every refresh tick without a cost.
func (o *Orchestrator) SessionSnapshot(slug string) SessionReport {
	scheme, port := o.proxy.Endpoint()
	r := SessionReport{
		Slug:      slug,
		Dashboard: o.cfg.Naming.URL(domain.HubService, "", scheme, port),
		TLD:       o.cfg.Naming.TLD,
	}

	st, ok := o.stackBySlug(slug)
	if !ok {
		return r
	}
	r.Found = true
	r.Branch = st.Branch
	r.Live = o.sys.ProcessAlive(st.LauncherPID)
	if r.Live {
		r.RSS = o.sys.GroupRSS(st.LauncherPID)
	}

	// Only the routed children this stack actually runs are bounceable — the
	// same set `haven restart` accepts, keyed by CLI name.
	restartable := map[string]bool{}
	for _, t := range restartTargets(st, "") {
		restartable[t.Name] = true
	}
	for _, svc := range st.Services {
		cli := domain.CLIServiceName(svc.Name)
		r.Services = append(r.Services, SessionServiceStatus{
			Name:        cli,
			Role:        svc.Role,
			URL:         svc.URL,
			Port:        svc.Port,
			Up:          svc.Port != 0 && o.sys.PortInUse(svc.Port),
			Fallback:    svc.IsFallback,
			Restartable: restartable[cli] && !svc.IsFallback,
		})
	}

	info, daemonUp := o.store.Daemon()
	r.Servers = append(r.Servers,
		SessionServer{Name: "proxy", Up: o.proxy.Running(), Detail: fmt.Sprintf("%s :%d", scheme, port)},
		SessionServer{Name: "daemon", Up: daemonUp && o.sys.ProcessAlive(info.PID), Detail: fmt.Sprintf("pid %d", info.PID)},
	)
	if st.ClickHouseHTTPPort != 0 {
		r.Servers = append(r.Servers, SessionServer{
			Name: "clickhouse", Up: o.sys.PortInUse(st.ClickHouseHTTPPort),
			Detail: fmt.Sprintf(":%d %s", st.ClickHouseHTTPPort, st.ClickHouseDatabase),
		})
	}
	if st.PostgresPort != 0 {
		r.Servers = append(r.Servers, SessionServer{
			Name: "postgres", Up: o.sys.PortInUse(st.PostgresPort),
			Detail: fmt.Sprintf(":%d %s", st.PostgresPort, st.PostgresDatabase),
		})
	}
	if st.RedisPort != 0 {
		r.Servers = append(r.Servers, SessionServer{
			Name: "redis", Up: o.sys.PortInUse(st.RedisPort),
			Detail: fmt.Sprintf(":%d db%d", st.RedisPort, st.RedisDB),
		})
	}
	if st.ObservabilityGrafanaPort != 0 {
		r.Servers = append(r.Servers, SessionServer{
			Name: "observability", Up: o.sys.PortInUse(st.ObservabilityGrafanaPort), Detail: "grafana",
		})
	}
	return r
}
