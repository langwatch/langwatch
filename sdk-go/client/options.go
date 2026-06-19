package client

import (
	"net/http"
	"time"
)

// Default configuration values. These mirror sensible production defaults and
// can each be overridden via the corresponding Option.
const (
	// DefaultEndpoint is the LangWatch SaaS base URL used when neither
	// [WithEndpoint] nor the LANGWATCH_ENDPOINT environment variable is set.
	DefaultEndpoint = "https://app.langwatch.ai"

	// DefaultTimeout is the per-request timeout applied to the internal
	// http.Client when the caller does not supply their own via
	// [WithHTTPClient]. It bounds a single attempt, not the whole retry loop.
	DefaultTimeout = 30 * time.Second

	// DefaultMaxRetries is the number of additional attempts made for retryable
	// responses (HTTP 429 and 5xx) beyond the initial request.
	DefaultMaxRetries = 2

	// DefaultRetryWaitMin and DefaultRetryWaitMax bound the exponential backoff
	// between retry attempts.
	DefaultRetryWaitMin = 500 * time.Millisecond
	DefaultRetryWaitMax = 5 * time.Second
)

// config holds the resolved client configuration after options and environment
// fallbacks have been applied. It is internal; callers configure it through
// [Option] values passed to [New].
type config struct {
	apiKey       string
	projectID    string
	endpoint     string
	httpClient   *http.Client
	maxRetries   int
	retryWaitMin time.Duration
	retryWaitMax time.Duration
	userAgent    string
}

// Option configures a [Client]. Options are applied in order by [New], after
// environment-variable fallbacks are seeded, so an explicit option always wins
// over the environment.
type Option func(*config)

// WithAPIKey sets the LangWatch API key or Personal Access Token used to
// authenticate every request.
//
// When omitted, the client reads the LANGWATCH_API_KEY environment variable.
// Accepts both legacy project keys (sk-lw-*) and Personal Access Tokens
// (pat-lw-*); see the package documentation for how each is sent on the wire.
func WithAPIKey(key string) Option {
	return func(c *config) { c.apiKey = key }
}

// WithProjectID sets the LangWatch project identifier (project_...).
//
// It is required when the API key is a Personal Access Token (pat-lw-*) and is
// ignored for legacy sk-lw-* keys. When omitted, the client reads the
// LANGWATCH_PROJECT_ID environment variable.
func WithProjectID(projectID string) Option {
	return func(c *config) { c.projectID = projectID }
}

// WithEndpoint sets the LangWatch base URL, for self-hosted or staging
// deployments.
//
// When omitted, the client reads LANGWATCH_ENDPOINT, falling back to
// [DefaultEndpoint]. The value should be a scheme + host (and optional base
// path), e.g. "https://langwatch.internal.example.com"; API paths are appended
// to it.
func WithEndpoint(endpoint string) Option {
	return func(c *config) { c.endpoint = endpoint }
}

// WithHTTPClient supplies the underlying *http.Client used for transport,
// letting callers control TLS, proxies, connection pooling and timeouts.
//
// When omitted, the client uses an *http.Client with a [DefaultTimeout]
// per-request timeout. A client supplied here is used as-is; its Timeout (if
// any) bounds each individual attempt, while the SDK's retry loop spans
// attempts.
func WithHTTPClient(httpClient *http.Client) Option {
	return func(c *config) { c.httpClient = httpClient }
}

// WithMaxRetries sets how many additional attempts are made for retryable
// responses (HTTP 429 and 5xx) beyond the first request.
//
// The default is [DefaultMaxRetries]. Pass 0 to disable retries entirely.
func WithMaxRetries(n int) Option {
	return func(c *config) {
		if n < 0 {
			n = 0
		}
		c.maxRetries = n
	}
}

// WithRetryWaitMax sets the upper bound on the exponential backoff between retry
// attempts. The default is [DefaultRetryWaitMax]. A server-provided Retry-After
// header still takes precedence when present.
func WithRetryWaitMax(d time.Duration) Option {
	return func(c *config) {
		if d > 0 {
			c.retryWaitMax = d
		}
	}
}

// WithUserAgent overrides the User-Agent header sent with every request. When
// omitted, the client sends "langwatch-sdk-go/<version>".
func WithUserAgent(ua string) Option {
	return func(c *config) {
		if ua != "" {
			c.userAgent = ua
		}
	}
}
