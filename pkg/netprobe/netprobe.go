// Package netprobe validates outbound network reachability at startup.
// Catches NetworkPolicy misconfigs before the pod accepts traffic.
package netprobe

import (
	"context"
	"errors"
	"fmt"
	"net"
	"strings"
	"time"
)

// Host is a TCP endpoint to probe.
type Host struct {
	Name string // short label for logs (e.g. "openai")
	Addr string // host:port form (e.g. "api.openai.com:443")
}

// ParseHosts parses a comma-separated list of host:port entries.
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
			return nil, fmt.Errorf("netprobe: invalid host:port %q: %w", p, err)
		}
		if host == "" || port == "" {
			return nil, fmt.Errorf("netprobe: invalid host:port %q", p)
		}
		name := host
		if i := strings.IndexByte(host, '.'); i > 0 {
			name = host[:i]
		}
		out = append(out, Host{Name: name, Addr: net.JoinHostPort(host, port)})
	}
	return out, nil
}

// Prober runs reachability checks.
type Prober struct {
	Dialer         *net.Dialer
	PerHostTimeout time.Duration // default 2s
}

// Probe checks each host sequentially. Returns the first failure.
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
			return fmt.Errorf("netprobe %s (%s): %w", h.Name, h.Addr, err)
		}
	}
	return nil
}

func probeOne(ctx context.Context, dialer *net.Dialer, h Host, timeout time.Duration) error {
	cctx, cancel := context.WithTimeout(ctx, timeout)
	defer cancel()
	conn, err := dialer.DialContext(cctx, "tcp", h.Addr)
	if err != nil {
		var dnsErr *net.DNSError
		if errors.As(err, &dnsErr) {
			return fmt.Errorf("dns resolution failed: %w", err)
		}
		return fmt.Errorf("tcp dial failed: %w", err)
	}
	_ = conn.Close()
	return nil
}
