package idpsim

import (
	"context"
	"errors"
	"fmt"
	"io/fs"
	"net"
	"net/http"
	"os"
	"strconv"
	"sync"
	"time"

	"github.com/langwatch/langwatch/pkg/webconsole"
)

// Server is the simulator: the tenant range, the verification store, and the
// HTTP surface over both.
type Server struct {
	cfg          Config
	tenants      []*Tenant
	verification *verificationStore
	persistence  *stateStore
	// dnsAddr is settled by Serve and read by the pages and the control API,
	// which run on other goroutines — so it carries its own lock rather than
	// leaning on the happens-before that Serve's ordering currently provides.
	// The fallback path means the address is not known until the listener is
	// actually bound, so this is not a value that can simply be set at
	// construction and left alone.
	dnsAddrMu sync.RWMutex
	dnsAddr   string
	now       func() time.Time
	// bundle is apps/idpsim-web's build and console the handler serving it.
	bundle  fs.FS
	console http.Handler
}

// NewServer provisions the tenant range and its verification records, and
// serves the console bundle this binary was built with.
func NewServer(cfg Config) (*Server, error) {
	return newServer(cfg, embeddedConsole())
}

func newServer(cfg Config, bundle fs.FS) (*Server, error) {
	state, err := openState(cfg.DataDir)
	if err != nil {
		return nil, err
	}
	tenants, verification, err := state.restore(cfg)
	if err != nil {
		return nil, err
	}
	s := &Server{
		cfg:          cfg,
		tenants:      tenants,
		verification: verification,
		persistence:  state,
		now:          time.Now,
		bundle:       bundle,
		console:      webconsole.New(bundle, consoleBuildCommand),
	}
	if err := s.saveState(); err != nil {
		return nil, err
	}
	return s, nil
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

// Handler is the full HTTP surface: the three protocols a tenant speaks, the
// control API for scripts, the JSON API the console reads, and the console.
func (s *Server) Handler() http.Handler {
	mux := http.NewServeMux()
	s.routeProtocols(mux)
	s.routeControl(mux)
	s.routeAPI(mux)

	// HTTP (non-DNS) domain verification: any well-known path answers for the
	// requested Host (or ?domain=).
	mux.HandleFunc("GET /.well-known/{file...}", s.handleWellKnownVerification)
	mux.HandleFunc("GET /health", func(w http.ResponseWriter, _ *http.Request) {
		writeJSON(w, http.StatusOK, map[string]any{"status": "ok", "tenants": len(s.tenants)})
	})
	s.routeConsole(mux)
	return s.persistChanges(mux)
}

// routeProtocols is what a tenant speaks to an application: OIDC, SAML and
// SCIM, each of them per tenant.
func (s *Server) routeProtocols(mux *http.ServeMux) {
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
}

// routeControl is the scriptable twin of the pages, for tests and setup
// scripts.
func (s *Server) routeControl(mux *http.ServeMux) {
	mux.HandleFunc("GET /control/state", s.handleControlState)
	mux.HandleFunc("POST /control/t/{tenant}/reset", s.handleControlReset)
	mux.HandleFunc("POST /control/t/{tenant}/users", s.handleControlAddUser)
	mux.HandleFunc("GET /control/t/{tenant}/activity", s.handleControlActivity)
	mux.HandleFunc("POST /control/t/{tenant}/apps", s.handleControlRegisterApp)
	mux.HandleFunc("POST /control/t/{tenant}/config", s.handleControlConfig)
	mux.HandleFunc("PUT /control/t/{tenant}/scim-target", s.handleControlSCIMTarget)
	mux.HandleFunc("DELETE /control/t/{tenant}/scim-target", s.handleControlSCIMTarget)
	mux.HandleFunc("POST /control/t/{tenant}/scim-push", s.handleControlSCIMPush)
	// The large-directory verbs: how many people there are, what happened to
	// them, and the reconciliation that carries the difference across.
	mux.HandleFunc("POST /control/t/{tenant}/population", s.handleControlPopulate)
	mux.HandleFunc("POST /control/t/{tenant}/churn", s.handleControlChurn)
	mux.HandleFunc("POST /control/t/{tenant}/scim-sync", s.handleControlSCIMSync)
	mux.HandleFunc("POST /control/t/{tenant}/scim-pull", s.handleControlSCIMPull)
	mux.HandleFunc("PUT /control/dns/txt", s.handleControlDNS)
	mux.HandleFunc("DELETE /control/dns/txt", s.handleControlDNS)
	mux.HandleFunc("PUT /control/verification", s.handleControlVerification)
	mux.HandleFunc("DELETE /control/verification", s.handleControlVerification)
}

// startVerificationDNS binds the verification DNS listener.
//
// It is the one part of the simulator that wants a fixed, well-known port — a
// resolver has to be pointed at it — which is also the one part another
// process can already be holding. Losing DNS costs the DNS half of domain
// verification; refusing to start costs OIDC, SAML, SCIM and the HTTP half as
// well. So a busy port falls back to an ephemeral one and says where it went,
// and a listener that cannot be had at all is a warning, not a refusal.
func (s *Server) startVerificationDNS(ctx context.Context) {
	dns, err := startDNS(ctx, dnsConfig{
		Addr: s.cfg.DNSAddr, Store: s.verification, Observe: s.recordDNSLookup,
	})
	if err == nil {
		if dns != nil {
			s.setDNSAddr(dns.Addr())
		}
		return
	}
	fmt.Fprintf(os.Stderr, "idpsim: could not bind the verification DNS listener on %s (%v)\n", s.cfg.DNSAddr, err)
	fallback, retryErr := startDNS(ctx, dnsConfig{
		Addr: "127.0.0.1:0", Store: s.verification, Observe: s.recordDNSLookup,
	})
	if retryErr != nil || fallback == nil {
		fmt.Fprintln(os.Stderr, "idpsim: continuing without DNS — domain verification over HTTP still works")
		return
	}
	s.setDNSAddr(fallback.Addr())
	fmt.Fprintf(os.Stderr, "idpsim: serving verification DNS on %s instead\n", fallback.Addr())
}

func (s *Server) setDNSAddr(addr string) {
	s.dnsAddrMu.Lock()
	defer s.dnsAddrMu.Unlock()
	s.dnsAddr = addr
}

// DNSAddr is where the verification DNS listener actually ended up, or "" when
// the simulator is running without one.
func (s *Server) DNSAddr() string {
	s.dnsAddrMu.RLock()
	defer s.dnsAddrMu.RUnlock()
	return s.dnsAddr
}

// Serve runs the HTTP listener (and the verification DNS server when
// configured) until ctx ends, then shuts down gracefully.
func (s *Server) Serve(ctx context.Context) error {
	s.startVerificationDNS(ctx)

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
