package langyagent

import (
	"context"
	"crypto/rand"
	"crypto/subtle"
	"encoding/hex"
	"fmt"
	"net"
	"net/http"
	"net/http/httputil"
	"net/url"
	"time"

	"go.uber.org/zap"
)

// generateBearerToken returns a random 32-byte token encoded as hex. Used as
// the per-worker shared secret between the manager and its own reverse proxy.
// 256 bits of entropy makes online brute-force from a sibling worker
// implausible even if the sibling were given unbounded loopback access.
func generateBearerToken() (string, error) {
	buf := make([]byte, 32)
	if _, err := rand.Read(buf); err != nil {
		return "", fmt.Errorf("generate bearer token: %w", err)
	}
	return hex.EncodeToString(buf), nil
}

// authProxy is a per-worker reverse proxy that fronts opencode's HTTP server.
// It listens on 127.0.0.1:externalPort, requires a per-worker Bearer token,
// and proxies validated requests to opencode at 127.0.0.1:internalPort.
//
// Threat model addressed: an attacker that controls a sibling worker
// process (same pod, same network namespace) can no longer issue arbitrary
// requests against another worker's opencode by guessing or scanning the
// announced port — the request needs the per-worker bearer token, which
// only the manager process holds.
//
// Residual: the underlying opencode TCP listener on 127.0.0.1:internalPort
// is still reachable from any process in the pod netns via /proc/net/tcp
// scanning. Closing that hole requires either patching opencode to listen
// on a UNIX domain socket (Bun.serve supports `unix:`, opencode does not
// expose a flag for it today) or running each opencode in its own network
// namespace (CAP_NET_ADMIN, broader cap surface than we want). Documented
// as a follow-up in specs/langy/langy-worker-isolation.feature.
type authProxy struct {
	server *http.Server
	listen net.Listener
}

// startAuthProxy binds 127.0.0.1:externalPort and reverse-proxies authorised
// requests to 127.0.0.1:internalPort. The returned proxy is already serving
// in a goroutine; the caller closes it via shutdown(ctx).
func startAuthProxy(externalPort, internalPort int, bearerToken string, log *zap.Logger) (*authProxy, error) {
	target := &url.URL{
		Scheme: "http",
		Host:   fmt.Sprintf("127.0.0.1:%d", internalPort),
	}
	rev := httputil.NewSingleHostReverseProxy(target)

	// Default ReverseProxy uses http.DefaultTransport — fine; it pools
	// connections to the single backend. We DO want errors to come back
	// as 502 rather than half-written headers polluting the SSE stream.
	rev.ErrorHandler = func(w http.ResponseWriter, _ *http.Request, err error) {
		log.Debug("authproxy upstream error", zap.Error(err))
		http.Error(w, "bad gateway", http.StatusBadGateway)
	}

	// Constant-time compare on the credential to avoid leaking the token
	// via response timing. Build the expected header once.
	expected := []byte("Bearer " + bearerToken)
	handler := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		got := []byte(r.Header.Get("Authorization"))
		if len(got) != len(expected) || subtle.ConstantTimeCompare(got, expected) != 1 {
			http.Error(w, "unauthorized", http.StatusUnauthorized)
			return
		}
		// Strip the credential before it reaches opencode; opencode does
		// not need it and would log it. Keep this AFTER the compare.
		r.Header.Del("Authorization")
		rev.ServeHTTP(w, r)
	})

	addr := fmt.Sprintf("127.0.0.1:%d", externalPort)
	listener, err := net.Listen("tcp", addr)
	if err != nil {
		return nil, fmt.Errorf("authproxy listen %s: %w", addr, err)
	}

	srv := &http.Server{
		Handler:           handler,
		ReadHeaderTimeout: 10 * time.Second,
	}
	go func() {
		if err := srv.Serve(listener); err != nil && err != http.ErrServerClosed {
			log.Error("authproxy serve exited",
				zap.String("addr", addr),
				zap.Error(err),
			)
		}
	}()

	return &authProxy{server: srv, listen: listener}, nil
}

// shutdown stops the proxy goroutine. Best-effort: a 1s deadline is enough
// for in-flight HTTP turns to drain on a healthy worker; we drop anything
// longer rather than block a worker recycle.
func (p *authProxy) shutdown() {
	if p == nil || p.server == nil {
		return
	}
	ctx, cancel := context.WithTimeout(context.Background(), 1*time.Second)
	defer cancel()
	_ = p.server.Shutdown(ctx)
}
