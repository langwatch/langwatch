package aigateway

import (
	"context"
	"fmt"
	"os"
	"strings"
	"time"

	"github.com/langwatch/langwatch/pkg/clog"
	"github.com/langwatch/langwatch/pkg/config"
)

// Config is the top-level service configuration.
type Config struct {
	Environment                   string                    `env:"ENVIRONMENT"`
	BlockLocalHTTPCalls           bool                      `env:"BLOCK_LOCAL_HTTP_CALLS"`
	RequireHTTPSCustomerEndpoints bool                      `env:"REQUIRE_HTTPS_CUSTOM_ENDPOINTS"`
	AllowedProxyHosts             string                    `env:"ALLOWED_PROXY_HOSTS"`
	Server                        config.Server             `env:"SERVER"`
	Log                           clog.Config               `env:"LOG"`
	ControlPlane                  ControlPlaneConfig        `env:"LW_GATEWAY"`
	AuthCache                     AuthCacheConfig           `env:"LW_GATEWAY_AUTH_CACHE"`
	Circuit                       CircuitConfig             `env:"LW_GATEWAY_CIRCUIT"`
	CustomerTraceBridge           CustomerTraceBridgeConfig `env:"CUSTOMER_TRACE_BRIDGE"`
	LangyMirror                   LangyMirrorConfig         `env:"LANGY_MIRROR"`
	SpendEmitter                  SpendEmitterConfig        `env:"LW_GATEWAY_SPEND"`
	OTel                          config.OTel               `env:"OTEL"`
	// NonStreamingHeartbeatIntervalSeconds sets how often (in seconds) a
	// non-streaming response writes a keep-alive byte while dispatch is
	// still in flight. 0 falls back to config.DefaultNonStreamingHeartbeatInterval;
	// negative disables heartbeating entirely. Plain seconds, not a Go
	// duration string ("45s") — config.Hydrate parses time.Duration fields
	// as raw nanosecond integers, not via time.ParseDuration, so "45s"
	// would fail to parse. Plain seconds sidesteps that trap entirely.
	//
	// Lives on Config directly rather than the shared config.Server (unlike
	// MaxRequestBodyBytes, which every config.Server-embedding service
	// wires up) because this concept is specific to the gateway's
	// non-streaming HTTP surface — services/langyagent and services/nlpgo
	// both embed config.Server too but have no use for this field.
	NonStreamingHeartbeatIntervalSeconds int64 `env:"NON_STREAMING_HEARTBEAT_INTERVAL_SECONDS"`
}

// SpendEmitterConfig governs the async spend-command emission (the billing
// pipeline's gateway leg). Enabled by default, because these commands are the
// only source of gateway budget debits: a gateway that does not emit records
// no spend, and every budget it enforces against goes stale at zero. When
// enabled, records spool under SpoolDir (bounded, oldest dropped first with a
// counter when full) and ship to the control plane's spend-command ingest,
// signed with the shared internal secret. The request hot path never performs
// a networked write and is never delayed or refused for recordability.
type SpendEmitterConfig struct {
	// Enabled defaults to true (see defaultConfig). LW_GATEWAY_SPEND_ENABLED
	// is the kill switch: false or 0 stops emission, for the case where the
	// control plane is older than the gateway and has no spend-command ingest
	// route yet. Leaving it on through that window is degraded but safe, so
	// the switch is a deliberate operator action rather than an opt-in.
	Enabled bool `env:"ENABLED"`
	// SpoolDir holds the on-disk spool. Empty defaults to
	// <os.TempDir()>/langwatch-gateway-spend-spool.
	SpoolDir string `env:"SPOOL_DIR"`
	// SpoolMaxBytes bounds the spool on disk. 0 defaults to 64 MiB.
	SpoolMaxBytes int64 `env:"SPOOL_MAX_BYTES"`
	// FlushIntervalSeconds bounds how long a record can sit unsealed (and
	// therefore unshippable). 0 defaults to 1 second. Plain seconds, same
	// parsing trap as NonStreamingHeartbeatIntervalSeconds above.
	FlushIntervalSeconds int64 `env:"FLUSH_INTERVAL_SECONDS"`
	// IngestBaseURL overrides where batches ship. Empty defaults to
	// ControlPlane.BaseURL.
	IngestBaseURL string `env:"INGEST_BASE_URL"`
}

// ControlPlaneConfig holds control plane connection settings.
type ControlPlaneConfig struct {
	BaseURL        string `env:"BASE_URL"            validate:"required"`
	InternalSecret string `env:"INTERNAL_SECRET"     validate:"required"`
	JWTSecret      string `env:"JWT_SECRET"          validate:"required"`
	JWTSecretPrev  string `env:"JWT_SECRET_PREVIOUS"`
}

// AuthCacheConfig governs the resolver's stale-while-error behavior. The
// gateway is on the hot path of every LLM request, so a brief control-plane
// outage must not translate into mass authentication rejection. When a
// cached entry crosses its JWT exp AND the refresh fails for transport
// reasons (network/timeout/5xx/parse error), the entry's soft expiry is
// extended by SoftBump and the cached bundle continues to serve, up to a
// hard cap of (JWT exp + HardGrace). Any auth-class rejection from the
// control plane (401/403/404) evicts immediately — no grace window for
// known-bad credentials. Setting HardGrace=0 disables stale-while-error
// entirely (legacy behavior).
type AuthCacheConfig struct {
	SoftBumpSeconds  int64 `env:"SOFT_BUMP_SECONDS"`
	HardGraceSeconds int64 `env:"HARD_GRACE_SECONDS"`
	// ConfigTTLSeconds bounds how stale a cached virtual key's config
	// (credentials, base URLs, routing chain) can get before a background
	// re-fetch, covering config mutations that don't emit change-feed
	// events. Default 60s; negative disables.
	ConfigTTLSeconds int64 `env:"CONFIG_TTL_SECONDS"`
}

// CircuitConfig tunes the per-credential circuit breaker that preempts
// dispatch to a provider which has been failing, so a known-down
// credential costs one probe per cooldown instead of a dead round-trip on
// every request. Plain seconds rather than Go duration strings, because
// config.Hydrate parses time.Duration fields as raw nanosecond integers.
type CircuitConfig struct {
	// WindowS is the failure-counting window. 0 uses the breaker default.
	WindowS int64 `env:"WINDOW_S"`
	// Threshold is how many failures inside the window open the circuit.
	Threshold int `env:"THRESHOLD"`
	// CooldownS is how long the circuit stays open before a single probe
	// is let through.
	CooldownS int64 `env:"COOLDOWN_S"`
}

// CustomerTraceBridgeConfig holds customer trace bridge settings.
type CustomerTraceBridgeConfig struct {
	// BaseURL is where the customer trace bridge exports spans.
	// Defaults to ControlPlane.BaseURL if not set.
	BaseURL string `env:"BASE_URL"`
}

// LangyMirrorConfig points the gateway's ADR-061 mirror leg at LangWatch's own
// mirror project. Product configuration shared verbatim with the Go manager
// (LANGY_MIRROR_TRACE_ENDPOINT / LANGY_MIRROR_TRACE_KEY), plus the mirror
// project's id so the bridge can route the mirror copy there. Never OTEL_* —
// that namespace is the gateway's own telemetry only. All three unset (the
// self-hosted default) leaves the gateway's mirror leg dormant; the customer
// path is unaffected either way.
type LangyMirrorConfig struct {
	TraceEndpoint string `env:"TRACE_ENDPOINT"`
	TraceKey      string `env:"TRACE_KEY"`
	ProjectID     string `env:"PROJECT_ID"`
}

func defaultConfig() Config {
	return Config{
		Environment: "local",
		Server: config.Server{
			Addr:            ":5563",
			GracefulSeconds: 10,
			// Matches pkg/lifecycle's own defaultDrainDelay so boot behavior
			// is unchanged for anyone not overriding it — this field exists
			// so the gateway chart can actually configure it (previously
			// impossible: nothing wired shutdown.preDrainWait to an env var,
			// and serve.go never called lifecycle.WithDrainDelay at all).
			DrainDelaySeconds:   3,
			MaxRequestBodyBytes: config.DefaultMaxRequestBodyBytes,
		},
		NonStreamingHeartbeatIntervalSeconds: int64(config.DefaultNonStreamingHeartbeatInterval / time.Second),
		Circuit: CircuitConfig{
			WindowS:   30,
			Threshold: 10,
			CooldownS: 60,
		},
		ControlPlane: ControlPlaneConfig{
			BaseURL: "http://localhost:5560",
		},
		// config.Hydrate leaves a field alone when its env var is unset or
		// empty, so this default survives everything except an explicit
		// LW_GATEWAY_SPEND_ENABLED=false (or 0).
		SpendEmitter: SpendEmitterConfig{
			Enabled: true,
		},
		OTel: config.OTel{
			// Left unset so an operator-supplied ratio is distinguishable from
			// the default; resolved in LoadConfig.
			SampleRatio: config.UnsetSampleRatio,
		},
	}
}

func splitAllowedHosts(value string) []string {
	if strings.TrimSpace(value) == "" {
		return nil
	}
	return strings.Split(value, ",")
}

// LoadConfig hydrates configuration from environment variables and validates it.
func LoadConfig(ctx context.Context) (Config, error) {
	cfg := defaultConfig()
	if err := config.Hydrate(&cfg); err != nil {
		return Config{}, err
	}
	cfg.OTel.SampleRatioSet = os.Getenv("OTEL_SAMPLE_RATIO") != ""
	applyLegacyEnvAliases(&cfg)
	if err := validateHostedEgressSecurity(cfg); err != nil {
		return Config{}, err
	}
	if cfg.CustomerTraceBridge.BaseURL == "" {
		cfg.CustomerTraceBridge.BaseURL = cfg.ControlPlane.BaseURL
	}
	if err := cfg.OTel.Resolve(); err != nil {
		return Config{}, err
	}
	if err := config.Validate(ctx, cfg); err != nil {
		return Config{}, err
	}
	return cfg, nil
}

// validateHostedEgressSecurity makes the SSRF controls a startup invariant for
// deployed gateway instances. Local/self-hosted development keeps the legacy
// permissive default, but a hosted process must never silently boot with the
// compatibility defaults after a missing or misspelled environment variable.
func validateHostedEgressSecurity(cfg Config) error {
	if cfg.Environment == "" || cfg.Environment == "local" {
		return nil
	}
	if !cfg.BlockLocalHTTPCalls {
		return fmt.Errorf("hosted gateway requires BLOCK_LOCAL_HTTP_CALLS=true")
	}
	if !cfg.RequireHTTPSCustomerEndpoints {
		return fmt.Errorf("hosted gateway requires REQUIRE_HTTPS_CUSTOM_ENDPOINTS=true")
	}
	return nil
}

// applyLegacyEnvAliases reads the chart/saas-style env var names that the
// gateway chart's configmap and the langwatch-saas terraform deployment have
// historically set, and maps them onto the canonical struct fields. The
// canonical names (resolved via the Hydrate prefix scheme — e.g. SERVER_ADDR,
// LW_GATEWAY_BASE_URL, LOG_LEVEL, OTEL_OTLP_ENDPOINT) take precedence; the
// legacy fallbacks only fire when the canonical env var is absent.
//
// Without this layer, both the chart and saas terraform shipped GATEWAY_*
// prefixed env vars that the Go code never read, leaving the gateway running
// on dev defaults (ControlPlane.BaseURL = http://localhost:5560) in any pod
// — passing /healthz but failing every real VK call with auth_upstream_unavailable.
//
// Deprecated: remove once all chart users + saas terraform have migrated to
// canonical names. Track via the existence of GATEWAY_LISTEN_ADDR / friends
// in any deployed configmap or terraform; safe to drop when grep returns
// zero hits across deployment manifests.
func applyLegacyEnvAliases(cfg *Config) {
	type alias struct {
		canonical, legacy string
		apply             func(string)
	}
	aliases := []alias{
		{"SERVER_ADDR", "GATEWAY_LISTEN_ADDR", func(v string) { cfg.Server.Addr = v }},
		{"LW_GATEWAY_BASE_URL", "GATEWAY_CONTROL_PLANE_URL", func(v string) { cfg.ControlPlane.BaseURL = v }},
		{"LOG_LEVEL", "GATEWAY_LOG_LEVEL", func(v string) { cfg.Log.Level = v }},
		{"OTEL_OTLP_ENDPOINT", "GATEWAY_OTEL_DEFAULT_ENDPOINT", func(v string) { cfg.OTel.OTLPEndpoint = v }},
	}
	for _, a := range aliases {
		// Match Hydrate's "empty == not set" semantics (pkg/config/config.go).
		// Treat canonical=unset OR canonical=empty as "open to legacy fallback";
		// only a non-empty canonical value short-circuits the alias.
		if os.Getenv(a.canonical) != "" {
			continue
		}
		if v := os.Getenv(a.legacy); v != "" {
			a.apply(v)
		}
	}
}
