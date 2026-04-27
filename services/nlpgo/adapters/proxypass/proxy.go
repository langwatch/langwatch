// Package proxypass reverse-proxies any non-/go/* request from nlpgo
// to the uvicorn child. The Lambda Web Adapter (and the dev pod entry)
// points at nlpgo as the entrypoint; everything that's not the new Go
// surface flows through here unchanged so existing customer behavior
// is preserved bit-for-bit.
package proxypass

import (
	"errors"
	"fmt"
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
	target, err := url.Parse(opts.UpstreamURL)
	if err != nil {
		return nil, fmt.Errorf("proxypass: parse upstream: %w", err)
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
	return rp, nil
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
