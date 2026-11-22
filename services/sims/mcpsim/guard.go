package mcpsim

import (
	"encoding/json"
	"net"
	"net/http"
	"strings"
)

func writeJSON(w http.ResponseWriter, code int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(code)
	_ = json.NewEncoder(w).Encode(v)
}

func writeError(w http.ResponseWriter, code int, message string) {
	writeJSON(w, code, map[string]string{"error": message})
}

// localOnly refuses a request whose Host is not this machine. A page that rebinds
// its own DNS name to 127.0.0.1 still sends that name as the Host, so it cannot
// reach the control API that way.
func localOnly(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if !isLocalHost(r.Host) {
			writeError(w, http.StatusForbidden, "mcpsim answers only on localhost, 127.0.0.1 or a *.localhost name")
			return
		}
		next.ServeHTTP(w, r)
	})
}

func isLocalHost(hostport string) bool {
	host := hostport
	if h, _, err := net.SplitHostPort(hostport); err == nil {
		host = h
	}
	host = strings.ToLower(strings.TrimSuffix(host, "."))
	if host == "localhost" || strings.HasSuffix(host, ".localhost") {
		return true
	}
	ip := net.ParseIP(strings.Trim(host, "[]"))
	return ip != nil && ip.IsLoopback()
}

// jsonOnly refuses a POST that is not JSON. A web page can only send JSON across origins after a
// preflight this sim never answers, so a page the developer visits cannot start a run that
// spends the sim's held session or tokens.
func jsonOnly(next http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if !strings.HasPrefix(r.Header.Get("Content-Type"), applicationJSON) {
			writeError(w, http.StatusUnsupportedMediaType, "send the request as application/json")
			return
		}
		next(w, r)
	}
}
