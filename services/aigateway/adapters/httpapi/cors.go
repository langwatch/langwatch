package httpapi

import (
	"fmt"
	"net/http"
	"net/url"
	"strings"

	"github.com/langwatch/langwatch/pkg/herr"
	"github.com/langwatch/langwatch/services/aigateway/adapters/gatewaytracer"
)

// corsAnyOrigin is the configured value that allows every origin.
const corsAnyOrigin = "*"

// corsMaxAgeSeconds is how long a browser may reuse a preflight answer.
const corsMaxAgeSeconds = "600"

const corsAllowedMethods = "GET, POST, PUT, OPTIONS"

// corsExposedHeaders are the response headers a page may read. A browser
// hides every header outside its short safelist unless it is named here.
var corsExposedHeaders = strings.Join([]string{
	"X-LangWatch-Session-Id",
	"X-LangWatch-Gateway-Request-Id",
	"X-Request-Id",
	"Request-Id",
	"Location",
	"Retry-After",
	"X-LangWatch-Budget-Warning",
	"X-LangWatch-Guardrails-Not-Applied",
	"X-LangWatch-Fallback-Count",
	"X-LangWatch-Cache-Mode",
	"X-LangWatch-Params-Dropped",
	"X-LangWatch-Provider",
	"X-LangWatch-Gateway-Version",
	"X-Langwatch-Models-Discovery-Incomplete",
	gatewaytracer.HeaderTraceID,
	gatewaytracer.HeaderSpanID,
	herr.HandledErrorHeader,
	"character-cost",
}, ", ")

// ParseCORSAllowedOrigins reads LW_GATEWAY_CORS_ALLOWED_ORIGINS: a comma
// separated list of exact origins, or "*" alone. Empty means CORS is off.
func ParseCORSAllowedOrigins(value string) ([]string, error) {
	var origins []string
	anyOrigin := false
	for _, part := range strings.Split(value, ",") {
		origin := strings.TrimSpace(part)
		switch origin {
		case "":
			continue
		case corsAnyOrigin:
			anyOrigin = true
		default:
			if err := validateCORSOrigin(origin); err != nil {
				return nil, err
			}
			origin = strings.ToLower(origin)
		}
		origins = append(origins, origin)
	}
	if anyOrigin && len(origins) > 1 {
		return nil, fmt.Errorf("LW_GATEWAY_CORS_ALLOWED_ORIGINS mixes %q with exact origins; set %q alone or list the origins", corsAnyOrigin, corsAnyOrigin)
	}
	return origins, nil
}

// validateCORSOrigin accepts scheme://host[:port] and nothing after it, the
// exact form a browser sends in the Origin header.
func validateCORSOrigin(origin string) error {
	refuse := func(why string) error {
		return fmt.Errorf("LW_GATEWAY_CORS_ALLOWED_ORIGINS has %q, which %s; an origin is scheme://host[:port], for example https://app.example.com", origin, why)
	}
	parsed, err := url.Parse(origin)
	if err != nil {
		return refuse("is not a URL")
	}
	switch {
	case parsed.Scheme == "" || parsed.Host == "":
		return refuse("has no scheme or no host")
	case parsed.User != nil:
		return refuse("carries credentials")
	case parsed.Path != "" || parsed.RawQuery != "" || parsed.Fragment != "" || strings.HasSuffix(origin, "?") || strings.HasSuffix(origin, "#"):
		return refuse("has a path, a query or a trailing slash")
	case strings.Contains(parsed.Host, "*"):
		return refuse("has a wildcard host, and origins are matched exactly")
	}
	return nil
}

// corsPolicy is the parsed set of origins a page may call from.
type corsPolicy struct {
	allowAny bool
	allowed  map[string]struct{}
}

func newCORSPolicy(allowedOrigins []string) corsPolicy {
	policy := corsPolicy{allowed: make(map[string]struct{}, len(allowedOrigins))}
	for _, origin := range allowedOrigins {
		if origin == corsAnyOrigin {
			policy.allowAny = true
			continue
		}
		policy.allowed[strings.ToLower(origin)] = struct{}{}
	}
	return policy
}

// allowOrigin is the Access-Control-Allow-Origin value for a request origin,
// or empty when that origin is not allowed.
func (p corsPolicy) allowOrigin(origin string) string {
	if p.allowAny {
		return corsAnyOrigin
	}
	if _, listed := p.allowed[strings.ToLower(origin)]; listed {
		return origin
	}
	return ""
}

// CORSMiddleware answers preflights and marks responses for the allowed
// origins. It never sends Access-Control-Allow-Credentials: the gateway
// authenticates by bearer key, not by cookie.
func CORSMiddleware(allowedOrigins []string) func(http.Handler) http.Handler {
	policy := newCORSPolicy(allowedOrigins)
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			origin := r.Header.Get("Origin")
			// A WebSocket handshake is not subject to CORS.
			if origin == "" || isSocketUpgrade(r) {
				next.ServeHTTP(w, r)
				return
			}
			h := w.Header()
			h.Add("Vary", "Origin")
			allow := policy.allowOrigin(origin)
			if allow == "" {
				next.ServeHTTP(w, r)
				return
			}
			h.Set("Access-Control-Allow-Origin", allow)
			if isCORSPreflight(r) {
				writeCORSPreflight(w, r)
				return
			}
			h.Set("Access-Control-Expose-Headers", corsExposedHeaders)
			next.ServeHTTP(w, r)
		})
	}
}

func isCORSPreflight(r *http.Request) bool {
	return r.Method == http.MethodOptions && r.Header.Get("Access-Control-Request-Method") != ""
}

// writeCORSPreflight answers 204 and reflects the requested headers, since
// vendor SDKs send their own (x-stainless-*, xi-api-key) beside ours.
func writeCORSPreflight(w http.ResponseWriter, r *http.Request) {
	h := w.Header()
	h.Add("Vary", "Access-Control-Request-Method")
	h.Add("Vary", "Access-Control-Request-Headers")
	h.Set("Access-Control-Allow-Methods", corsAllowedMethods)
	if requested := r.Header.Get("Access-Control-Request-Headers"); requested != "" {
		h.Set("Access-Control-Allow-Headers", requested)
	}
	h.Set("Access-Control-Max-Age", corsMaxAgeSeconds)
	w.WriteHeader(http.StatusNoContent)
}
