// Package paymentsim is a local stand-in for Stripe, faking exactly the API
// surface and webhooks the billing module uses: products and prices (tiered
// included), customers, checkout and portal sessions, subscriptions, invoices,
// billing meters and credit grants. Webhooks are signed the way Stripe signs
// them, so the product's own verification runs unchanged. A control API under
// /_sim/api seeds the catalogue, advances the clock, fails payments, replays
// events in any order and reads back metered usage. Ids are counters.
//
// ponytail: state is in memory behind one lock; it is a dev shim, never expose it.
package paymentsim

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io/fs"
	"net"
	"net/http"
	"os"
	"strconv"
	"strings"
	"sync"
	"time"
)

// Config is paymentsim's environment-derived configuration.
type Config struct {
	// Addr is the listen address (PAYMENTSIM_ADDR, default :5599).
	Addr string
	// Stack is the haven stack slug (PAYMENTSIM_STACK, may be empty).
	Stack string
	// PublicURL is the origin checkout and portal links name (PAYMENTSIM_PUBLIC_URL,
	// default http://localhost<Addr>).
	PublicURL string
	// WebhookURL receives every event (PAYMENTSIM_WEBHOOK_URL); empty records events only.
	WebhookURL string
	// WebhookSecret signs deliveries (PAYMENTSIM_WEBHOOK_SECRET, default whsec_paymentsim).
	WebhookSecret string
	// CatalogPath is a stripe-catalog.json seeded at start (PAYMENTSIM_CATALOG).
	CatalogPath string
	// IDBase offsets every counter id so a restart never reuses one the app already stored
	// (PAYMENTSIM_ID_BASE, default the start time in seconds). Zero keeps ids deterministic.
	IDBase int
}

// LoadConfig reads paymentsim's configuration from the environment.
func LoadConfig() Config {
	return withDefaults(Config{
		Addr: os.Getenv("PAYMENTSIM_ADDR"), Stack: os.Getenv("PAYMENTSIM_STACK"),
		PublicURL: os.Getenv("PAYMENTSIM_PUBLIC_URL"), WebhookURL: os.Getenv("PAYMENTSIM_WEBHOOK_URL"),
		WebhookSecret: os.Getenv("PAYMENTSIM_WEBHOOK_SECRET"), CatalogPath: os.Getenv("PAYMENTSIM_CATALOG"),
		IDBase: idBaseFromEnv(),
	})
}

// idBaseFromEnv is PAYMENTSIM_ID_BASE, or the start time in seconds: later starts always count higher.
func idBaseFromEnv() int {
	if v, err := strconv.Atoi(os.Getenv("PAYMENTSIM_ID_BASE")); err == nil && v >= 0 {
		return v
	}
	return int(time.Now().Unix())
}

func withDefaults(cfg Config) Config {
	if cfg.Addr == "" {
		cfg.Addr = ":5599"
	}
	if cfg.PublicURL == "" {
		cfg.PublicURL = "http://localhost" + cfg.Addr
	}
	if cfg.WebhookSecret == "" {
		cfg.WebhookSecret = "whsec_paymentsim"
	}
	cfg.PublicURL = strings.TrimSuffix(cfg.PublicURL, "/")
	return cfg
}

// Server answers Stripe's API, the control API and the checkout and portal pages.
type Server struct {
	cfg     Config
	mu      sync.Mutex
	st      *state
	hook    *hooks
	real    func() time.Time
	mux     *http.ServeMux
	console http.Handler
}

// NewServer builds the server, seeding the catalogue file when one is named.
func NewServer(cfg Config) (*Server, error) {
	return newServer(cfg, embeddedConsole())
}

func newServer(cfg Config, bundle fs.FS) (*Server, error) {
	cfg = withDefaults(cfg)
	s := &Server{cfg: cfg, st: newState(), real: time.Now, console: newConsole(bundle)}
	s.st.idBase = cfg.IDBase
	s.hook = newHooks(cfg.WebhookURL, cfg.WebhookSecret, func() time.Time { return s.real() })
	if cfg.CatalogPath != "" {
		raw, err := os.ReadFile(cfg.CatalogPath)
		if err != nil {
			return nil, fmt.Errorf("reading the catalogue: %w", err)
		}
		if err := s.st.seedCatalog(raw, "test", s.now()); err != nil {
			return nil, err
		}
	}
	s.mux = s.routes()
	return s, nil
}

// now is the simulated clock: the wall clock plus every advance.
func (s *Server) now() time.Time { return s.real().Add(s.st.offset) }

func (s *Server) routes() *http.ServeMux {
	mux := http.NewServeMux()
	mux.HandleFunc("GET /healthz", func(w http.ResponseWriter, _ *http.Request) {
		writeJSON(w, http.StatusOK, map[string]string{"status": "ok"})
	})
	s.apiRoutes(mux)
	s.controlRoutes(mux)
	// The console owns only the root and its assets; every other path stays Stripe's or a 404.
	mux.HandleFunc("GET /_sim/api/", func(w http.ResponseWriter, r *http.Request) {
		controlError(w, http.StatusNotFound, "paymentsim does not fake %s %s", r.Method, r.URL.Path)
	})
	mux.HandleFunc("GET /{$}", s.handleConsole)
	mux.HandleFunc("GET /assets/", s.handleConsole)
	return mux
}

// Handler is the whole HTTP surface, for tests that drive it without a listener.
func (s *Server) Handler() http.Handler { return s.mux }

// Serve listens on cfg.Addr until ctx is done.
func (s *Server) Serve(ctx context.Context) error {
	var lc net.ListenConfig
	ln, err := lc.Listen(ctx, "tcp", s.cfg.Addr)
	if err != nil {
		return fmt.Errorf("binding %s: %w", s.cfg.Addr, err)
	}
	go s.hook.run(ctx)
	srv := &http.Server{Handler: s.Handler(), ReadHeaderTimeout: 10 * time.Second}
	go func() {
		<-ctx.Done()
		shutdownCtx, cancel := context.WithTimeout(context.WithoutCancel(ctx), 5*time.Second)
		defer cancel()
		_ = srv.Shutdown(shutdownCtx)
	}()
	if err := srv.Serve(ln); !errors.Is(err, http.ErrServerClosed) {
		return err
	}
	return nil
}

func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Cache-Control", "no-store")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(v)
}

// apiError is Stripe's error envelope: {"error": {type, code, message, param}}.
type apiError struct {
	status  int
	errType string
	code    string
	message string
	param   string
}

func (e *apiError) Error() string { return e.message }

func (e *apiError) body() map[string]any {
	inner := map[string]any{"type": e.errType, "message": e.message}
	if e.code != "" {
		inner["code"] = e.code
		inner["doc_url"] = "https://stripe.com/docs/error-codes/" + strings.ReplaceAll(e.code, "_", "-")
	}
	if e.param != "" {
		inner["param"] = e.param
	}
	return map[string]any{"error": inner}
}

func invalid(param, format string, args ...any) *apiError {
	return &apiError{status: http.StatusBadRequest, errType: "invalid_request_error", code: "parameter_invalid", message: fmt.Sprintf(format, args...), param: param}
}

func missingParam(param string) *apiError {
	return &apiError{status: http.StatusBadRequest, errType: "invalid_request_error", code: "parameter_missing", message: "Missing required param: " + param + ".", param: param}
}

// noSuch is Stripe's 404 for an unknown id: "No such customer: 'cus_x'".
func noSuch(kind, id string) *apiError {
	return &apiError{status: http.StatusNotFound, errType: "invalid_request_error", code: "resource_missing", message: fmt.Sprintf("No such %s: '%s'", kind, id), param: "id"}
}
