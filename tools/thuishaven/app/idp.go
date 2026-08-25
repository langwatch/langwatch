package app

import (
	"context"
	"fmt"

	"github.com/langwatch/langwatch/tools/thuishaven/domain"
)

// RunIdPSolo runs only the IdP simulator: no app, no API, no workers, no
// databases — the affordance for testing an identity flow (or another stack)
// against a simulated IdP without bringing a LangWatch stack up at all. It
// allocates a port, routes the machine-wide idp.langwatch.localhost at it when
// the proxy is available (plain localhost otherwise), and runs the service in
// the foreground until ctx ends. tenants > 0 overrides the simulator's tenant
// range; 0 leaves its default.
func (o *Orchestrator) RunIdPSolo(ctx context.Context, tenants int) error {
	ports, err := o.sys.FreePorts(1)
	if err != nil {
		return fmt.Errorf("allocating a port for the IdP simulator: %w", err)
	}
	port := ports[0]

	baseURL := fmt.Sprintf("http://localhost:%d", port)
	if !o.cfg.PortlessDisabled {
		if err := o.proxy.EnsureReady(); err != nil {
			o.log.Warn("portless is unavailable — serving the IdP simulator on localhost only", zapErr(err))
		} else if err := o.proxy.Register(domain.IdPService, "", port); err != nil {
			o.log.Warn("could not route the idp hostname — serving on localhost only", zapErr(err))
		} else {
			defer o.proxy.Remove(domain.IdPService, "")
			if u := o.sharedURL(domain.IdPService); u != "" {
				baseURL = u
			}
		}
	}

	env := []string{
		fmt.Sprintf("SERVER_ADDR=:%d", port),
		"IDPSIM_BASE_URL=" + baseURL,
		"LOG_FORMAT=pretty",
	}
	if tenants > 0 {
		env = append(env, fmt.Sprintf("IDPSIM_TENANTS=%d", tenants))
	}
	fmt.Printf("  idp  %s\n", baseURL)
	return o.sup.RunOnce(ctx, "idp", o.cfg.RepoRoot, goServiceShell(o.cfg.RepoRoot, "idpsim", false), env)
}
