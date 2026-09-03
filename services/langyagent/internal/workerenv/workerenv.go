// Package workerenv holds the parts of a worker subprocess environment that
// are identical for every worker: the inherited-variable allowlist and the
// NO_PROXY host list. The adapter spawns the same kind of
// process into the same cluster, so one copy per adapter would let a key added
// on one side change what leaks into a worker.
package workerenv

import (
	"net/url"
	"os"
	"strings"

	"github.com/langwatch/langwatch/services/langyagent/domain"
)

// InheritedEnvKeys is the complete set of manager environment variables a
// worker may inherit. Everything security-sensitive is injected explicitly by
// the adapter from the turn's scoped Credentials and Capabilities instead of
// relying on naming conventions. An allowlist means a newly introduced manager
// secret is private by default, regardless of its name.
var InheritedEnvKeys = []string{
	"PATH",
	"LANG",
	"LC_ALL",
	"LC_CTYPE",
	"TZ",
	"TERM",
	"COLORTERM",
	"NO_COLOR",
	"FORCE_COLOR",
	"SSL_CERT_FILE",
	"SSL_CERT_DIR",
	// The image sets DO_NOT_TRACK=1 so the Bun-compiled `langwatch` CLI never
	// auto-uploads a crash report. A Bun crash report reprints the process
	// argv, and argv for `langwatch ui call` carries the customer's own
	// payload. The CLI runs inside the WORKER, not in the manager, so without
	// this entry the image setting stops at the allowlist and never reaches
	// the process it is meant to cover.
	"DO_NOT_TRACK",
}

// BaseEnv returns the allowlisted manager variables that are set, as KEY=value
// entries, in InheritedEnvKeys order.
func BaseEnv() []string {
	out := make([]string, 0, len(InheritedEnvKeys))
	for _, key := range InheritedEnvKeys {
		if value, ok := os.LookupEnv(key); ok {
			out = append(out, key+"="+value)
		}
	}
	return out
}

// NoProxyHosts is the NO_PROXY list for a worker: loopback plus the in-cluster
// control-plane and gateway hosts, which egress via their own explicit
// NetworkPolicy rules and must NOT go through the per-worker egress adapter
// (ADR-076: "loopback and the in-cluster control-plane/gateway paths are
// unaffected").
func NoProxyHosts(creds domain.Credentials) string {
	hosts := []string{"127.0.0.1", "localhost", "::1"}
	seen := map[string]struct{}{"127.0.0.1": {}, "localhost": {}, "::1": {}}
	for _, raw := range []string{creds.LangwatchEndpoint, creds.GatewayBaseURL} {
		h := HostFromURL(raw)
		if h == "" {
			continue
		}
		if _, dup := seen[h]; dup {
			continue
		}
		seen[h] = struct{}{}
		hosts = append(hosts, h)
	}
	return strings.Join(hosts, ",")
}

// HostFromURL extracts the bare hostname from a URL, tolerating a value with
// no scheme. Returns "" when nothing host-like can be parsed.
func HostFromURL(raw string) string {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return ""
	}
	if !strings.Contains(raw, "://") {
		raw = "//" + raw
	}
	u, err := url.Parse(raw)
	if err != nil {
		return ""
	}
	return u.Hostname()
}
