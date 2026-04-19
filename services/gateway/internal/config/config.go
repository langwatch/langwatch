package config

import (
	"fmt"
	"net"
	"os"
	"strconv"
	"time"
)

// isLoopback mirrors httpx.IsLoopbackAddr without importing httpx
// (would create a cycle through main → httpx → config). Kept narrow —
// config-validation uses it only for the admin-addr safety check.
func isLoopback(addr string) bool {
	host, _, err := net.SplitHostPort(addr)
	if err != nil || host == "" {
		return false
	}
	if host == "localhost" {
		return true
	}
	ip := net.ParseIP(host)
	if ip == nil {
		return false
	}
	return ip.IsLoopback()
}

type Config struct {
	ListenAddr string
	// AdminAddr binds a separate listener for profiling (/debug/pprof/*)
	// and any future operator-only endpoints. Deliberately distinct
	// from the public listener so the NLB never exposes pprof to
	// customer traffic. Empty string disables the admin listener.
	AdminAddr string
	// AdminAuthToken requires `Authorization: Bearer <token>` on every
	// admin-listener request. Required when AdminAddr binds a non-
	// loopback interface; optional (but supported) for loopback so
	// operators can add a second defence layer even behind port-forward.
	AdminAuthToken string
	LogLevel       string

	ControlPlane ControlPlane
	Cache        Cache
	Budget       Budget
	Guardrails   Guardrails
	OTel         OTel
	Bifrost      Bifrost
	Startup      Startup
	Security     Security
	Shutdown     Shutdown
}

// Shutdown groups graceful-drain timing knobs. Total k8s
// terminationGracePeriodSeconds must exceed PreDrainWait + Timeout
// plus a few seconds of slack, or the pod is force-killed mid-drain.
type Shutdown struct {
	// PreDrainWait is the delay between MarkDraining (which flips
	// /readyz to 503) and server.Shutdown. Gives the load balancer /
	// service-endpoint controller time to remove the pod from the
	// routing set so the last request lands on a different pod. 5s
	// matches typical nginx-ingress + kube-proxy observed propagation.
	PreDrainWait time.Duration
	// Timeout bounds server.Shutdown. Handlers still running when the
	// timeout expires are force-closed; streams break mid-response.
	Timeout time.Duration
}

// Security groups pod-protection knobs that sit on the edge of the
// request pipeline — they don't belong to any single upstream concern,
// but protect the gateway itself from hostile or misconfigured callers.
type Security struct {
	// MaxRequestBodyBytes caps the size of the request body read from
	// callers. Defaults to 10 MiB which fits ~3MB prompts + base64
	// images with plenty of headroom, and is well below the memory
	// pressure that would OOM a pod with the default 512Mi limit.
	// Set to 0 to disable the cap entirely (not recommended).
	MaxRequestBodyBytes int64

	// ReadTimeout bounds the time from accepting the TCP connection to
	// finishing reading the request body. A trickling sender holding
	// a goroutine open is the classic slowloris vector — 60s is a
	// generous cap for legitimate 10 MiB bodies even on slow uplinks.
	//
	// ReadHeaderTimeout is hardcoded to 5s — headers are tiny, 5s
	// catches the TLS-handshake-then-stall variant without starving
	// mobile clients.
	ReadTimeout       time.Duration
	ReadHeaderTimeout time.Duration

	// IdleTimeout bounds keep-alive idle connections. 120s is longer
	// than typical nginx-ingress keepalive_timeout (75s) + upstream
	// (60s), so nginx closes first and the gateway isn't holding dead
	// sockets after the LB has moved on.
	IdleTimeout time.Duration

	// WriteTimeout is deliberately NOT configured on the public
	// server: it bounds the whole response lifetime, which breaks
	// legitimate long-running SSE streams. Per-chunk streaming-write
	// deadlines are set inside the dispatcher when needed. Callers
	// who want a cap should configure it at the ingress layer.
}

// Startup groups one-shot checks that gate the /startupz probe. The
// netcheck hosts let operators fail-fast on NetworkPolicy misconfigs —
// a deploy that can pass /healthz but can't DNS-resolve / TCP-dial the
// provider upstreams never takes traffic.
type Startup struct {
	NetcheckHostsRaw string        // raw comma-separated "host:port,host:port"
	NetcheckTimeout  time.Duration // per-host DNS+dial timeout
}

type ControlPlane struct {
	BaseURL         string
	InternalSecret  string // HMAC signs internal gateway→control-plane calls (LW_GATEWAY_INTERNAL_SECRET)
	JWTSecret       string // verifies JWT issued by control plane (LW_GATEWAY_JWT_SECRET)
	// JWTSecretPrevious accepts JWTs signed with the pre-rotation
	// secret — only set during a rotation window so existing bundles
	// (TTL up to 15m) keep verifying. Rotate out once every bundle
	// issued before the flip has expired. Empty = strict single-key
	// mode (default; production steady state).
	JWTSecretPrevious string
	RequestTimeout    time.Duration
	LongPollTimeout   time.Duration
}

type Cache struct {
	LRUSize              int
	RedisURL             string
	RefreshInterval      time.Duration
	BootstrapAllKeys     bool
	JWTRefreshThreshold  time.Duration
}

type Budget struct {
	OutboxFlushInterval time.Duration
	OutboxMaxRetries    int

	// Live /budget/check tier. Tier 1 (cached precheck) always runs;
	// tier 2 (live reconciliation) only fires when at least one scope
	// is >= LiveThreshold of its hard limit. Tight timeout fails-open
	// to the cached snapshot so the hot path never blocks on a slow
	// control plane.
	LiveThresholdPct float64       // default 0.9 (90%)
	LiveTimeout      time.Duration // default 200ms
}

type Guardrails struct {
	PreTimeout  time.Duration
	PostTimeout time.Duration
	StreamChunkWindow time.Duration
}

type OTel struct {
	DefaultExportEndpoint string
	BatchTimeout          time.Duration
	MaxQueueSize          int
}

type Bifrost struct {
	PoolSize         int
	StreamBufferSize int
}

func Load() (*Config, error) {
	cfg := &Config{
		ListenAddr:     env("GATEWAY_LISTEN_ADDR", ":5563"),
		AdminAddr:      env("GATEWAY_ADMIN_ADDR", "127.0.0.1:6060"),
		AdminAuthToken: env("GATEWAY_ADMIN_AUTH_TOKEN", ""),
		LogLevel:       env("GATEWAY_LOG_LEVEL", "info"),
		ControlPlane: ControlPlane{
			BaseURL:           env("GATEWAY_CONTROL_PLANE_URL", "http://localhost:5560"),
			InternalSecret:    env("LW_GATEWAY_INTERNAL_SECRET", ""),
			JWTSecret:         env("LW_GATEWAY_JWT_SECRET", ""),
			JWTSecretPrevious: env("LW_GATEWAY_JWT_SECRET_PREVIOUS", ""),
			RequestTimeout:    envDuration("GATEWAY_CONTROL_PLANE_TIMEOUT", 2*time.Second),
			LongPollTimeout:   envDuration("GATEWAY_LONG_POLL_TIMEOUT", 25*time.Second),
		},
		Cache: Cache{
			LRUSize:             envInt("GATEWAY_CACHE_LRU_SIZE", 50_000),
			RedisURL:            env("GATEWAY_REDIS_URL", ""),
			RefreshInterval:     envDuration("GATEWAY_CACHE_REFRESH_INTERVAL", 60*time.Second),
			BootstrapAllKeys:    envBool("GATEWAY_CACHE_BOOTSTRAP_ALL_KEYS", false),
			JWTRefreshThreshold: envDuration("GATEWAY_JWT_REFRESH_THRESHOLD", 5*time.Minute),
		},
		Budget: Budget{
			OutboxFlushInterval: envDuration("GATEWAY_BUDGET_OUTBOX_FLUSH", 2*time.Second),
			OutboxMaxRetries:    envInt("GATEWAY_BUDGET_OUTBOX_RETRIES", 10),
			LiveThresholdPct:    envFloat("LW_GATEWAY_BUDGET_LIVE_THRESHOLD", 0.9),
			LiveTimeout:         envDuration("LW_GATEWAY_BUDGET_LIVE_TIMEOUT", 200*time.Millisecond),
		},
		Guardrails: Guardrails{
			PreTimeout:        envDuration("GATEWAY_GUARDRAIL_PRE_TIMEOUT", 800*time.Millisecond),
			PostTimeout:       envDuration("GATEWAY_GUARDRAIL_POST_TIMEOUT", 2*time.Second),
			StreamChunkWindow: envDuration("GATEWAY_GUARDRAIL_STREAM_WINDOW", 200*time.Millisecond),
		},
		OTel: OTel{
			DefaultExportEndpoint: env("GATEWAY_OTEL_DEFAULT_ENDPOINT", ""),
			BatchTimeout:          envDuration("GATEWAY_OTEL_BATCH_TIMEOUT", 5*time.Second),
			MaxQueueSize:          envInt("GATEWAY_OTEL_MAX_QUEUE", 8192),
		},
		Bifrost: Bifrost{
			PoolSize:         envInt("GATEWAY_BIFROST_POOL_SIZE", 200),
			StreamBufferSize: envInt("GATEWAY_BIFROST_STREAM_BUFFER", 100),
		},
		Startup: Startup{
			NetcheckHostsRaw: env("GATEWAY_STARTUP_NETCHECK_HOSTS", ""),
			NetcheckTimeout:  envDuration("GATEWAY_STARTUP_NETCHECK_TIMEOUT", 2*time.Second),
		},
		Security: Security{
			MaxRequestBodyBytes: envInt64("GATEWAY_MAX_REQUEST_BODY_BYTES", 10*1024*1024),
			ReadTimeout:         envDuration("GATEWAY_SERVER_READ_TIMEOUT", 60*time.Second),
			ReadHeaderTimeout:   envDuration("GATEWAY_SERVER_READ_HEADER_TIMEOUT", 5*time.Second),
			IdleTimeout:         envDuration("GATEWAY_SERVER_IDLE_TIMEOUT", 120*time.Second),
		},
		Shutdown: Shutdown{
			PreDrainWait: envDuration("GATEWAY_SHUTDOWN_PRE_DRAIN_WAIT", 5*time.Second),
			Timeout:      envDuration("GATEWAY_SHUTDOWN_TIMEOUT", 15*time.Second),
		},
	}
	if err := cfg.validate(); err != nil {
		return nil, err
	}
	return cfg, nil
}

func (c *Config) validate() error {
	if c.ControlPlane.BaseURL == "" {
		return fmt.Errorf("GATEWAY_CONTROL_PLANE_URL is required")
	}
	insecure := env("GATEWAY_ALLOW_INSECURE", "") == "1"
	if c.ControlPlane.InternalSecret == "" && !insecure {
		return fmt.Errorf("LW_GATEWAY_INTERNAL_SECRET is required (set GATEWAY_ALLOW_INSECURE=1 to skip in dev)")
	}
	if c.ControlPlane.JWTSecret == "" && !insecure {
		return fmt.Errorf("LW_GATEWAY_JWT_SECRET is required (set GATEWAY_ALLOW_INSECURE=1 to skip in dev)")
	}
	if c.Cache.LRUSize <= 0 {
		return fmt.Errorf("GATEWAY_CACHE_LRU_SIZE must be > 0")
	}
	// Admin listener safety: if the operator has moved the admin
	// listener off loopback, a bearer token is mandatory. Exposing
	// pprof unauthenticated on anything other than 127.0.0.1/::1 is
	// a CVE in waiting.
	if c.AdminAddr != "" && !isLoopback(c.AdminAddr) && c.AdminAuthToken == "" && !insecure {
		return fmt.Errorf("GATEWAY_ADMIN_AUTH_TOKEN is required when GATEWAY_ADMIN_ADDR binds a non-loopback interface (got %q); set GATEWAY_ALLOW_INSECURE=1 only in dev", c.AdminAddr)
	}
	return nil
}

func env(key, def string) string {
	if v, ok := os.LookupEnv(key); ok {
		return v
	}
	return def
}

func envInt(key string, def int) int {
	if v, ok := os.LookupEnv(key); ok {
		if n, err := strconv.Atoi(v); err == nil {
			return n
		}
	}
	return def
}

func envInt64(key string, def int64) int64 {
	if v, ok := os.LookupEnv(key); ok {
		if n, err := strconv.ParseInt(v, 10, 64); err == nil {
			return n
		}
	}
	return def
}

func envBool(key string, def bool) bool {
	if v, ok := os.LookupEnv(key); ok {
		if b, err := strconv.ParseBool(v); err == nil {
			return b
		}
	}
	return def
}

func envFloat(key string, def float64) float64 {
	if v, ok := os.LookupEnv(key); ok {
		if f, err := strconv.ParseFloat(v, 64); err == nil {
			return f
		}
	}
	return def
}

func envDuration(key string, def time.Duration) time.Duration {
	if v, ok := os.LookupEnv(key); ok {
		if d, err := time.ParseDuration(v); err == nil {
			return d
		}
	}
	return def
}
