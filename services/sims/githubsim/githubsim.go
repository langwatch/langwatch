// Package githubsim is a local stand-in for the GitHub calls the github module makes: the App
// install page and setup redirect, installation lookup and tokens, installation repositories,
// pull requests, check runs, the OAuth authorize/token/user trio, and signed webhook delivery to
// the stack. State is in memory and scriptable through /_sim/api (installations, repos, pull
// requests, faults, deliveries); a small page at / shows it.
//
// ponytail: App JWTs and tokens are checked for shape and expiry, never cryptographically. Dev shim; never expose it.
package githubsim

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"net"
	"net/http"
	"os"
	"strconv"
	"sync"
	"time"
)

// Config is githubsim's environment-derived configuration.
type Config struct {
	// Addr is the listen address (GITHUBSIM_ADDR, default :5596).
	Addr string
	// Stack is the haven stack slug the page names (GITHUBSIM_STACK, may be empty).
	Stack string
	// PublicURL is how a browser reaches this sim (GITHUBSIM_PUBLIC_URL), used in html_url fields.
	PublicURL string
	// AppID is the GitHub App id the product signs its JWTs with (GITHUBSIM_APP_ID, empty accepts any).
	AppID string
	// AppSlug is the App's slug in the install URL (GITHUBSIM_APP_SLUG).
	AppSlug string
	// WebhookURL is the stack's webhook door (GITHUBSIM_WEBHOOK_URL); empty turns delivery off.
	WebhookURL string
	// WebhookSecret signs every delivery (GITHUBSIM_WEBHOOK_SECRET).
	WebhookSecret string
	// SetupURL is the stack's post-install redirect target (GITHUBSIM_SETUP_URL).
	SetupURL string
	// Seed starts with one installation, two repositories and one pull request (GITHUBSIM_SEED=1).
	Seed bool
	// MaxRecords bounds the call and delivery history (GITHUBSIM_MAX_RECORDS).
	MaxRecords int
	// GitRoot holds the bare repositories git clones and pushes reach (GITHUBSIM_GIT_ROOT, default a temp dir).
	GitRoot string
}

// LoadConfig reads githubsim's configuration from the environment.
func LoadConfig() Config {
	cfg := Config{
		Addr: os.Getenv("GITHUBSIM_ADDR"), Stack: os.Getenv("GITHUBSIM_STACK"),
		PublicURL: os.Getenv("GITHUBSIM_PUBLIC_URL"), AppID: os.Getenv("GITHUBSIM_APP_ID"),
		AppSlug: os.Getenv("GITHUBSIM_APP_SLUG"), WebhookURL: os.Getenv("GITHUBSIM_WEBHOOK_URL"),
		WebhookSecret: os.Getenv("GITHUBSIM_WEBHOOK_SECRET"), SetupURL: os.Getenv("GITHUBSIM_SETUP_URL"),
		Seed: os.Getenv("GITHUBSIM_SEED") == "1", GitRoot: os.Getenv("GITHUBSIM_GIT_ROOT"),
	}
	if n, err := strconv.Atoi(os.Getenv("GITHUBSIM_MAX_RECORDS")); err == nil && n > 0 {
		cfg.MaxRecords = n
	}
	if cfg.Addr == "" {
		cfg.Addr = ":5596"
	}
	return cfg
}

// Server answers the GitHub, control and page calls.
type Server struct {
	cfg    Config
	mux    http.Handler
	client *http.Client
	now    func() time.Time

	mu       sync.Mutex
	nextID   int64
	installs map[int64]*installation
	repos    map[string]*repository // by lower-cased full name
	pulls    []*pull
	checks   []*checkRun
	tokens   map[string]*token
	codes    map[string]string // OAuth code -> login
	users    map[string]*user
	faults   []*fault
	calls    []callRecord
	sent     []delivery

	gitOnce sync.Once
	gitMu   sync.Mutex
	gitDir  string
	gitErr  error
}

// NewServer builds the server, seeded when cfg.Seed is set.
func NewServer(cfg Config) *Server {
	return newServer(cfg, func() time.Time { return time.Now().UTC() })
}

func newServer(cfg Config, now func() time.Time) *Server {
	if cfg.MaxRecords <= 0 {
		cfg.MaxRecords = 500
	}
	s := &Server{
		cfg: cfg, client: &http.Client{Timeout: 10 * time.Second}, now: now, nextID: 9000,
		installs: map[int64]*installation{}, repos: map[string]*repository{},
		tokens: map[string]*token{}, codes: map[string]string{}, users: map[string]*user{"octocat": {Login: "octocat", ID: 1, Name: "The Octocat", Email: "octocat@example.com"}},
	}
	if cfg.Seed {
		s.seed()
	}
	s.mux = s.routes()
	return s
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
	srv := &http.Server{Handler: s.mux, ReadHeaderTimeout: 10 * time.Second}
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

func (s *Server) id() int64 {
	s.nextID++
	return s.nextID
}

func (s *Server) stamp() string { return s.now().Format(time.RFC3339) }

func randomHex(n int) string {
	b := make([]byte, n)
	_, _ = rand.Read(b)
	return hex.EncodeToString(b)
}

func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.Header().Set("Cache-Control", "no-store")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(v)
}

// writeMessage answers in GitHub's error shape: {"message", "documentation_url"}.
func writeMessage(w http.ResponseWriter, status int, message string) {
	writeJSON(w, status, map[string]string{"message": message, "documentation_url": "https://docs.github.com/rest"})
}
