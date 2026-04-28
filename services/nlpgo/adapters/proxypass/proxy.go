// Package proxypass reverse-proxies any non-/go/* request from nlpgo
// to the uvicorn child. The Lambda Web Adapter (and the dev pod entry)
// points at nlpgo as the entrypoint; everything that's not the new Go
// surface flows through here unchanged so existing customer behavior
// is preserved bit-for-bit.
package proxypass

import (
	"errors"
	"fmt"
	"net"
	"net/http"
	"net/http/httputil"
	"net/url"
	"strings"
	"time"

	"go.uber.org/zap"
)

// Options configures the reverse proxy.
type Options struct {
	// UpstreamURL is the base URL of the uvicorn child (e.g. http://127.0.0.1:5561).
	UpstreamURL string
	// Logger receives proxy events.
	Logger *zap.Logger
	// FlushInterval controls SSE/streaming flush. -1 = flush after every write.
	FlushInterval time.Duration
	// ColdStartWait caps how long an incoming request will wait for the
	// upstream to become reachable on first hit. The lifecycle reorder
	// in services/nlpgo/serve.go (PR #3559) made the HTTP listener bind
	// $PORT before the uvicorn child finishes warming, which closed the
	// Lambda init-timeout problem but opened a new one: requests that
	// land in the ~12-18s child-warmup window would dial 127.0.0.1:5561
	// and get connection-refused, surfacing as "502 child upstream
	// unavailable" to Studio (the prod symptom on 2026-04-28 19:xx UTC
	// after saas#476 deploy). With ColdStartWait > 0 we briefly poll for
	// the child instead of failing fast, so the cold-start window is
	// invisible to callers. Default: 5s. Set to 0 to disable the wait
	// (tests).
	ColdStartWait time.Duration
	// ColdStartProbeInterval is the gap between TCP dial probes during
	// the wait. Default: 100ms.
	ColdStartProbeInterval time.Duration
	// ColdStartProbeTimeout caps each individual TCP probe. Default: 200ms.
	ColdStartProbeTimeout time.Duration
}

// New builds a reverse proxy ready to mount as a chi NotFound handler.
func New(opts Options) (http.Handler, error) {
	if opts.UpstreamURL == "" {
		return nil, errors.New("proxypass: UpstreamURL is required")
	}
	if opts.Logger == nil {
		opts.Logger = zap.NewNop()
	}
	if opts.FlushInterval == 0 {
		// -1 forces ReverseProxy to flush after each write — required
		// for the legacy Python /studio/execute SSE stream to surface
		// chunks to the client without waiting on an internal buffer.
		opts.FlushInterval = -1
	}
	if opts.ColdStartWait == 0 {
		opts.ColdStartWait = 5 * time.Second
	}
	if opts.ColdStartProbeInterval == 0 {
		opts.ColdStartProbeInterval = 100 * time.Millisecond
	}
	if opts.ColdStartProbeTimeout == 0 {
		opts.ColdStartProbeTimeout = 200 * time.Millisecond
	}
	target, err := url.Parse(opts.UpstreamURL)
	if err != nil {
		return nil, fmt.Errorf("proxypass: parse upstream: %w", err)
	}
	if target.Host == "" {
		return nil, fmt.Errorf("proxypass: upstream URL %q has no host", opts.UpstreamURL)
	}

	rp := &httputil.ReverseProxy{
		Rewrite: func(pr *httputil.ProxyRequest) {
			pr.SetURL(target)
			pr.Out.Host = target.Host
			pr.Out.Header.Set("X-Forwarded-Host", pr.In.Host)
			pr.Out.Header.Set("X-Forwarded-Proto", forwardedProto(pr.In))
			// Mark the proxied call so the child can recognize it (helpful
			// for log correlation; child is free to ignore).
			pr.Out.Header.Set("X-LangWatch-NLPGO-Proxy", "1")
		},
		FlushInterval: opts.FlushInterval,
		ErrorHandler: func(w http.ResponseWriter, r *http.Request, err error) {
			opts.Logger.Warn("proxypass_upstream_error",
				zap.String("path", r.URL.Path),
				zap.Error(err),
			)
			http.Error(w, "child upstream unavailable", http.StatusBadGateway)
		},
	}
	return waitForUpstream(rp, target.Host, opts), nil
}

// waitForUpstream wraps the reverse proxy with a short cold-start
// tolerance window. On each request we TCP-probe the upstream host:
// if reachable, hand off to the reverse proxy immediately; if not,
// poll every ColdStartProbeInterval up to ColdStartWait. After the
// deadline, return 503 with Retry-After:1 — Studio's invokeLambda has
// LambdaClient maxAttempts:6 (langwatch PR #3559) so a transient cold-
// start storm transparently retries instead of toasting "Failed run
// workflow: 502 child upstream unavailable" at the user.
//
// Once the probe succeeds the request flows through the standard
// httputil.ReverseProxy: any subsequent failure (upstream 5xx, write
// error mid-SSE, etc.) still hits the 502 ErrorHandler above. The
// wrapper only widens the no-route window — it doesn't change happy-
// path or steady-state behavior.
func waitForUpstream(next http.Handler, host string, opts Options) http.Handler {
	if opts.ColdStartWait <= 0 {
		return next
	}
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		deadline := time.Now().Add(opts.ColdStartWait)
		probeStart := time.Now()
		for {
			if conn, err := net.DialTimeout("tcp", host, opts.ColdStartProbeTimeout); err == nil {
				_ = conn.Close()
				if waited := time.Since(probeStart); waited > opts.ColdStartProbeInterval {
					// Only log when we actually waited — happy path stays quiet.
					opts.Logger.Info("proxypass_upstream_ready_after_wait",
						zap.String("path", r.URL.Path),
						zap.Duration("waited", waited),
					)
				}
				next.ServeHTTP(w, r)
				return
			}
			if time.Now().After(deadline) {
				opts.Logger.Warn("proxypass_upstream_unavailable_after_wait",
					zap.String("path", r.URL.Path),
					zap.String("host", host),
					zap.Duration("waited", time.Since(probeStart)),
				)
				w.Header().Set("Retry-After", "1")
				http.Error(w, "child upstream warming up — retry shortly", http.StatusServiceUnavailable)
				return
			}
			select {
			case <-time.After(opts.ColdStartProbeInterval):
			case <-r.Context().Done():
				return
			}
		}
	})
}

func forwardedProto(r *http.Request) string {
	if v := r.Header.Get("X-Forwarded-Proto"); v != "" {
		return v
	}
	if r.TLS != nil {
		return "https"
	}
	if strings.HasPrefix(r.URL.Scheme, "http") {
		return r.URL.Scheme
	}
	return "http"
}
