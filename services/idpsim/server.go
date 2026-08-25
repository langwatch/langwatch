package idpsim

import (
	"context"
	"errors"
	"fmt"
	"net"
	"net/http"
	"strconv"
	"time"
)

// Server is the simulator: the tenant range, the verification store, and the
// HTTP surface over both.
type Server struct {
	cfg          Config
	tenants      []*Tenant
	verification *verificationStore
	dnsAddr      string
	now          func() time.Time
}

// NewServer provisions the tenant range and its verification records.
func NewServer(cfg Config) (*Server, error) {
	tenants, err := newTenants(cfg.Tenants, cfg.BaseURL)
	if err != nil {
		return nil, err
	}
	return &Server{
		cfg:          cfg,
		tenants:      tenants,
		verification: newVerificationStore(tenants),
		now:          time.Now,
	}, nil
}

// Tenant returns a tenant by 1-based id.
func (s *Server) Tenant(id int) (*Tenant, bool) {
	if id < 1 || id > len(s.tenants) {
		return nil, false
	}
	return s.tenants[id-1], true
}

// tenantFor resolves the {tenant} path segment of the current request.
func (s *Server) tenantFor(r *http.Request) (*Tenant, bool) {
	id, err := strconv.Atoi(r.PathValue("tenant"))
	if err != nil {
		return nil, false
	}
	return s.Tenant(id)
}

// Handler is the full HTTP surface.
func (s *Server) Handler() http.Handler {
	mux := http.NewServeMux()

	// The tenant's own page: how to wire an application up, what is
	// registered, and what it has been doing.
	mux.HandleFunc("GET /t/{tenant}", s.handleTenantPage)
	mux.HandleFunc("GET /t/{tenant}/{$}", s.handleTenantPage)
	mux.HandleFunc("POST /t/{tenant}/apps", s.handleRegisterApplication)
	mux.HandleFunc("POST /t/{tenant}/apps/{client}/delete", s.handleRemoveApplication)

	// OIDC, per tenant.
	mux.HandleFunc("GET /t/{tenant}/.well-known/openid-configuration", s.handleDiscovery)
	mux.HandleFunc("GET /t/{tenant}/oauth/jwks", s.handleJWKS)
	mux.HandleFunc("GET /t/{tenant}/oauth/authorize", s.handleAuthorize)
	mux.HandleFunc("POST /t/{tenant}/oauth/token", s.handleToken)
	mux.HandleFunc("GET /t/{tenant}/oauth/userinfo", s.handleUserinfo)

	// SAML, per tenant. SSO accepts both the redirect (GET) and POST bindings.
	mux.HandleFunc("GET /t/{tenant}/saml/metadata", s.handleSAMLMetadata)
	mux.HandleFunc("GET /t/{tenant}/saml/sso", s.handleSAMLSSO)
	mux.HandleFunc("POST /t/{tenant}/saml/sso", s.handleSAMLSSO)

	// SCIM 2.0, per tenant.
	mux.HandleFunc("GET /t/{tenant}/scim/v2/ServiceProviderConfig", s.handleSCIMServiceProviderConfig)
	mux.HandleFunc("/t/{tenant}/scim/v2/Users", s.handleSCIMUsers)
	mux.HandleFunc("/t/{tenant}/scim/v2/Users/{id}", s.handleSCIMUser)
	mux.HandleFunc("/t/{tenant}/scim/v2/Groups", s.handleSCIMGroups)
	mux.HandleFunc("/t/{tenant}/scim/v2/Groups/{id}", s.handleSCIMGroup)

	// HTTP (non-DNS) domain verification: any well-known path answers for the
	// requested Host (or ?domain=).
	mux.HandleFunc("GET /.well-known/{file...}", s.handleWellKnownVerification)

	// Control surface.
	mux.HandleFunc("GET /control/state", s.handleControlState)
	mux.HandleFunc("POST /control/t/{tenant}/reset", s.handleControlReset)
	mux.HandleFunc("POST /control/t/{tenant}/users", s.handleControlAddUser)
	mux.HandleFunc("GET /control/t/{tenant}/activity", s.handleControlActivity)
	mux.HandleFunc("POST /control/t/{tenant}/apps", s.handleControlRegisterApp)
	mux.HandleFunc("POST /control/t/{tenant}/config", s.handleControlConfig)
	mux.HandleFunc("POST /control/t/{tenant}/scim-push", s.handleControlSCIMPush)
	mux.HandleFunc("PUT /control/dns/txt", s.handleControlDNS)
	mux.HandleFunc("DELETE /control/dns/txt", s.handleControlDNS)
	mux.HandleFunc("PUT /control/verification", s.handleControlVerification)
	mux.HandleFunc("DELETE /control/verification", s.handleControlVerification)

	mux.HandleFunc("GET /health", func(w http.ResponseWriter, _ *http.Request) {
		writeJSON(w, http.StatusOK, map[string]any{"status": "ok", "tenants": len(s.tenants)})
	})
	mux.HandleFunc("/", s.handleIndex)
	return mux
}

// Serve runs the HTTP listener (and the verification DNS server when
// configured) until ctx ends, then shuts down gracefully.
func (s *Server) Serve(ctx context.Context) error {
	dns, err := startDNS(ctx, s.cfg.DNSAddr, s.verification, s.recordDNSLookup)
	if err != nil {
		return err
	}
	if dns != nil {
		s.dnsAddr = dns.Addr()
	}

	var lc net.ListenConfig
	listener, err := lc.Listen(ctx, "tcp", s.cfg.Addr)
	if err != nil {
		return fmt.Errorf("binding %s: %w", s.cfg.Addr, err)
	}
	srv := &http.Server{Handler: s.Handler(), ReadHeaderTimeout: 10 * time.Second}
	errCh := make(chan error, 1)
	go func() { errCh <- srv.Serve(listener) }()

	select {
	case <-ctx.Done():
		shutdownCtx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		_ = srv.Shutdown(shutdownCtx)
		return nil
	case err := <-errCh:
		if errors.Is(err, http.ErrServerClosed) {
			return nil
		}
		return err
	}
}
