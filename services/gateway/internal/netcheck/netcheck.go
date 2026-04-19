// Package netcheck validates outbound network reachability at startup
// time. It exists to fail-fast on the classic NetworkPolicy misconfig
// where the pod passes /healthz and every in-cluster dependency check,
// but the first real request dies on a kube-level egress denial (DNS
// not allowed to kube-system, or :443 not allowed to provider IPs).
//
// A probe here runs BEFORE MarkStarted, so a broken deploy never sinks
// traffic — the startup probe fails and k8s recycles the pod.
//
// The probe is opt-in. Self-hosted deploys that route providers through
// a forward proxy, or air-gapped clusters that only hit internal
// endpoints, should leave the host list empty.
package netcheck

import (
	"context"
	"errors"
	"fmt"
	"net"
	"strings"
	"time"
)

// Host is one TCP endpoint the probe must be able to resolve and dial.
// Name is a short label for logs/metrics (e.g. "openai"); Addr is the
// net.Dial-compatible `host:port` form (e.g. "api.openai.com:443").
type Host struct {
	Name string
	Addr string
}

// ParseHosts parses a comma-separated list of host:port entries.
// Whitespace around entries is tolerated; empty entries are skipped.
// The Name is derived from the host portion (up to the first dot).
//
// "api.openai.com:443, api.anthropic.com:443"
//
//	→ [{Name:"api", Addr:"api.openai.com:443"}, {Name:"api", Addr:"api.anthropic.com:443"}]
//
// Callers who want unique names should disambiguate before logging.
func ParseHosts(raw string) ([]Host, error) {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return nil, nil
	}
	parts := strings.Split(raw, ",")
	out := make([]Host, 0, len(parts))
	for _, p := range parts {
		p = strings.TrimSpace(p)
		if p == "" {
			continue
		}
		host, port, err := net.SplitHostPort(p)
		if err != nil {
			return nil, fmt.Errorf("netcheck: invalid host:port %q: %w", p, err)
		}
		if host == "" || port == "" {
			return nil, fmt.Errorf("netcheck: invalid host:port %q", p)
		}
		name := host
		if i := strings.IndexByte(host, '.'); i > 0 {
			name = host[:i]
		}
		out = append(out, Host{Name: name, Addr: net.JoinHostPort(host, port)})
	}
	return out, nil
}

// Prober runs reachability checks. Dialer is injectable so tests can
// swap in a deterministic resolver+dialer.
type Prober struct {
	Dialer         *net.Dialer
	PerHostTimeout time.Duration
}

// Probe runs each host sequentially. Returns nil if every host resolves
// and TCP-dials within PerHostTimeout. Returns the first failure —
// subsequent hosts are skipped because a single missing NP rule is
// usually the root cause and we want a clean, short error message for
// operators to pattern-match against.
func (p *Prober) Probe(ctx context.Context, hosts []Host) error {
	if len(hosts) == 0 {
		return nil
	}
	dialer := p.Dialer
	if dialer == nil {
		dialer = &net.Dialer{}
	}
	timeout := p.PerHostTimeout
	if timeout <= 0 {
		timeout = 2 * time.Second
	}
	for _, h := range hosts {
		if err := probeOne(ctx, dialer, h, timeout); err != nil {
			return fmt.Errorf("netcheck %s (%s): %w", h.Name, h.Addr, err)
		}
	}
	return nil
}

func probeOne(ctx context.Context, dialer *net.Dialer, h Host, timeout time.Duration) error {
	cctx, cancel := context.WithTimeout(ctx, timeout)
	defer cancel()
	conn, err := dialer.DialContext(cctx, "tcp", h.Addr)
	if err != nil {
		// Disambiguate DNS-level failures so operators know to check
		// the kube-system DNS egress rule rather than the provider
		// :443 rule. Go's resolver wraps DNS errors as *net.DNSError.
		var dnsErr *net.DNSError
		if errors.As(err, &dnsErr) {
			return fmt.Errorf("dns resolution failed: %w", err)
		}
		return fmt.Errorf("tcp dial failed: %w", err)
	}
	_ = conn.Close()
	return nil
}
