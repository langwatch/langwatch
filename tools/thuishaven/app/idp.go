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
	// Two: the HTTP listener, and the verification nameserver. The second is
	// allocated rather than left to the simulator's fixed default so a solo
	// run and a stack's own simulator cannot land on the same port — the
	// loser falls back to an ephemeral one and quietly answers for the
	// winner's domains.
	ports, err := o.sys.FreePorts(2)
	if err != nil {
		return fmt.Errorf("allocating a port for the IdP simulator: %w", err)
	}
	port, dnsPort := ports[0], ports[1]

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
		fmt.Sprintf("IDPSIM_DNS_ADDR=127.0.0.1:%d", dnsPort),
		"LOG_FORMAT=pretty",
	}
	if tenants > 0 {
		env = append(env, fmt.Sprintf("IDPSIM_TENANTS=%d", tenants))
	}
	fmt.Printf("  idp  %s\n", baseURL)
	// Printed because a solo run has no overlay to write it into: whoever is
	// pointing a resolver here has to be told where "here" is.
	fmt.Printf("  idp  domain proofs answer on 127.0.0.1:%d (SSO_DOMAIN_PROOF_DNS_SERVERS)\n", dnsPort)
	return o.sup.RunOnce(ctx, "idp", o.cfg.RepoRoot, goServiceShell(o.cfg.RepoRoot, "idpsim", false), env)
}
