package httpx

import (
	"crypto/subtle"
	"net"
	"net/http"
	"strings"
)

// RequireBearer guards a handler behind a static bearer token. Returns
// 401 with `WWW-Authenticate: Bearer realm="<realm>"` for missing /
// malformed / mismatched credentials.
//
// Comparison uses crypto/subtle.ConstantTimeCompare so token-length
// and prefix timing cannot leak. If token is empty the wrapper returns
// the handler unchanged — callers should enforce their own "token
// required" policy at startup (see IsLoopbackAddr below) rather than
// letting a misconfig silently bypass auth.
func RequireBearer(token, realm string, next http.Handler) http.Handler {
	if token == "" {
		return next
	}
	expected := []byte(token)
	challenge := `Bearer realm="` + realm + `"`
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		h := r.Header.Get("Authorization")
		const p = "Bearer "
		if !strings.HasPrefix(h, p) {
			w.Header().Set("WWW-Authenticate", challenge)
			http.Error(w, "unauthorized", http.StatusUnauthorized)
			return
		}
		got := []byte(strings.TrimSpace(h[len(p):]))
		if subtle.ConstantTimeCompare(got, expected) != 1 {
			w.Header().Set("WWW-Authenticate", challenge)
			http.Error(w, "unauthorized", http.StatusUnauthorized)
			return
		}
		next.ServeHTTP(w, r)
	})
}

// IsLoopbackAddr returns true when addr binds only to the loopback
// interface. Accepts the net.Listen(":port", "host:port", "[::1]:port")
// forms. Empty host ("" or ":port") means "all interfaces" — NOT
// loopback. Used by main to reject a configuration that exposes an
// admin listener without authentication on a non-loopback interface.
func IsLoopbackAddr(addr string) bool {
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
