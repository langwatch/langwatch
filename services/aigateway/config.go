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
	// duration string ("45s"), per the repo-wide convention config.Hydrate
	// enforces: env-configurable time spans are int64 seconds on a
	// _SECONDS-suffixed variable, never a time.Duration field.
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
	// convention as NonStreamingHeartbeatIntervalSeconds above.
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
	// BaseURLExplicit distinguishes an operator-provided BaseURL from the
	// compatibility default (see defaultConfig). Not populated by Hydrate
	// (no env tag): LoadConfig sets it directly from the same env vars
	// BaseURL itself can come from, canonical or legacy, so a value that
	// happens to match the default still counts as explicit. Serve logs a
	// warning at boot when this is false, naming the resolved URL: every
	// spend, budget and auth call this gateway makes depends on it pointing
	// at the right control plane, and a wrong one fails silently (every
	// request still answers 200, nothing errors anywhere).
	BaseURLExplicit bool
}

// AuthCacheConfig governs the resolver's stale-while-error behavior. The
// gateway is on the hot path of every LLM request, so a brief control-plane
// outage must not translate into mass authentication rejection. When a
// cached entry crosses its JWT exp AND the refresh fails for transport
// reasons (network/timeout/5xx/parse error), the entry's soft expiry is
// extended by SoftBump and the cached bundle continues to serve, up to a
// hard cap of (JWT exp + HardGraceSeconds). Any auth-class rejection from
// the control plane (401/403/404) evicts immediately, with no grace window
// for known-bad credentials.
type AuthCacheConfig struct {
	// SoftBumpSeconds extends a stale entry's soft expiry once per
	// transport-class refresh failure. 0 selects the 5 minute default.
	SoftBumpSeconds int64 `env:"SOFT_BUMP_SECONDS"`
	// HardGraceSeconds caps how far past the JWT exp a stale entry can be
	// served. 0 selects the 6 hour default; a negative value puts the hard
	// cap before the JWT exp, which disables stale-while-error and restores
	// the hard-fail-at-exp behavior wanted by strict revocation regimes.
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
// every request. Plain seconds rather than Go duration strings, per the
// convention config.Hydrate enforces.
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
			Addr: ":5563",
			// Sits above DefaultNonStreamingHeartbeatInterval so a stock
			// deployment can finish the slow-but-legitimate non-streaming
			// requests the heartbeat mechanism exists to keep alive, instead
			// of cutting them off mid-flight on every rolling deploy. See
			// warnIfGracefulShutdownTooShort in serve.go.
			GracefulSeconds: 60,
			// Matches pkg/lifecycle's own defaultDrainDelay, so a deployment
			// that does not set SERVER_DRAIN_DELAY_SECONDS drains exactly as
			// the lifecycle package would on its own.
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
	cfg.ControlPlane.BaseURLExplicit = os.Getenv("LW_GATEWAY_BASE_URL") != "" || os.Getenv("GATEWAY_CONTROL_PLANE_URL") != ""
	applyLegacyEnvAliases(&cfg)
	if err := validateRetiredEnvVars(); err != nil {
		return Config{}, err
	}
	if err := validateHostedEgressSecurity(cfg); err != nil {
		return Config{}, err
	}
	if err := validateSecondsFields(cfg); err != nil {
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

// MaxConfigurableSeconds bounds every seconds-valued time span in the
// gateway's configuration. Each one is turned into a time.Duration by
// multiplying by time.Second, i.e. by a billion, so a value near int64's
// range silently wraps to a negative duration: a typo of a nanosecond count
// into a seconds field would land as an instant timeout or a disabled cache
// rather than as a startup failure. Ten years is orders of magnitude past
// any legitimate setting and leaves the multiplication nowhere near
// overflow.
const MaxConfigurableSeconds = 10 * 365 * 24 * 60 * 60

// validateSecondsFields rejects out-of-range time spans before anything
// converts them to a time.Duration. Negative values stay legal on the fields
// whose consumer reads a negative number as an explicit "disabled" signal.
func validateSecondsFields(cfg Config) error {
	for _, f := range []struct {
		env   string
		value int64
		// rejectNegative marks a field that is spent waiting rather than
		// consulted. Neither one reads a negative as "disabled": the
		// shutdown budget becomes a context deadline that is already
		// expired, so SIGTERM drops every in-flight request at once instead
		// of draining, and the drain delay is skipped without a word. Zero
		// already says "no wait", so a negative can only be a mistake, and
		// one nothing in the running process would report.
		rejectNegative bool
	}{
		{env: "SERVER_GRACEFUL_SECONDS", value: int64(cfg.Server.GracefulSeconds), rejectNegative: true},
		{env: "SERVER_DRAIN_DELAY_SECONDS", value: int64(cfg.Server.DrainDelaySeconds), rejectNegative: true},
		{env: "NON_STREAMING_HEARTBEAT_INTERVAL_SECONDS", value: cfg.NonStreamingHeartbeatIntervalSeconds},
		{env: "LW_GATEWAY_AUTH_CACHE_SOFT_BUMP_SECONDS", value: cfg.AuthCache.SoftBumpSeconds},
		{env: "LW_GATEWAY_AUTH_CACHE_HARD_GRACE_SECONDS", value: cfg.AuthCache.HardGraceSeconds},
		{env: "LW_GATEWAY_AUTH_CACHE_CONFIG_TTL_SECONDS", value: cfg.AuthCache.ConfigTTLSeconds},
		{env: "LW_GATEWAY_CIRCUIT_WINDOW_S", value: cfg.Circuit.WindowS},
		{env: "LW_GATEWAY_CIRCUIT_COOLDOWN_S", value: cfg.Circuit.CooldownS},
		{env: "LW_GATEWAY_SPEND_FLUSH_INTERVAL_SECONDS", value: cfg.SpendEmitter.FlushIntervalSeconds},
	} {
		if f.value > MaxConfigurableSeconds || f.value < -MaxConfigurableSeconds {
			return fmt.Errorf("%s is %d seconds, which is outside the supported range of +/-%d seconds (10 years); values are seconds, not milliseconds or nanoseconds", f.env, f.value, int64(MaxConfigurableSeconds))
		}
		if f.rejectNegative && f.value < 0 {
			return fmt.Errorf("%s is %d seconds; it is a wait, so it must be zero or positive. Use 0 for no wait at all", f.env, f.value)
		}
	}
	return nil
}

// retiredEnvVars are the duration-string variables the _SECONDS names
// replaced. Nothing reads them any more, so a deployment that still carries
// one would boot on the default instead: an operator who set
// LW_GATEWAY_AUTH_CACHE_HARD_GRACE=0s to hard-fail at JWT exp, as the
// runbook once told them to, would come back up serving stale bundles for
// six hours with no signal that their setting had stopped applying.
// Refusing to boot is what makes an upgrade reach whoever set it. Same
// reasoning, and same wording, as the chart's guard on the retired
// shutdown.preDrainWait / shutdown.timeout keys.
var retiredEnvVars = []struct{ old, replacement string }{
	{"LW_GATEWAY_AUTH_CACHE_SOFT_BUMP", "LW_GATEWAY_AUTH_CACHE_SOFT_BUMP_SECONDS"},
	{"LW_GATEWAY_AUTH_CACHE_HARD_GRACE", "LW_GATEWAY_AUTH_CACHE_HARD_GRACE_SECONDS"},
	{"LW_GATEWAY_AUTH_CACHE_CONFIG_TTL", "LW_GATEWAY_AUTH_CACHE_CONFIG_TTL_SECONDS"},
}

// validateRetiredEnvVars stops startup when a retired duration-string
// variable is still set, naming the variable that replaced it.
func validateRetiredEnvVars() error {
	for _, v := range retiredEnvVars {
		value := os.Getenv(v.old)
		if value == "" {
			continue
		}
		return fmt.Errorf("%s=%q is no longer read. Set %s instead, as a plain count of seconds (a negative value disables, 0 takes the default)", v.old, value, v.replacement)
	}
	return nil
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
