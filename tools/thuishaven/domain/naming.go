// Package domain holds thuishaven's pure logic: how a worktree becomes a slug,
// and how a (service, slug) pair becomes a routable hostname and URL. No I/O
// lives here, so it is trivially testable and has no dependency on portless, the
// filesystem, or the process table.
package domain

import (
	"fmt"
	"strings"
)

// Naming derives hostnames from a (service, slug) pair. `project` is the brand
// label just before the TLD (giving langwatch.localhost), and `tld` is the final
// label — `.localhost` resolves to loopback natively, which is why thuishaven
// needs no /etc/hosts, resolver, or sudo.
type Naming struct {
	Project string
	TLD     string
}

// HubService is the routed name for the machine-wide dashboard ("home port"):
// hub.langwatch.localhost. The bare langwatch.localhost stays registered as a
// legacy alias.
const HubService = "hub"

// DefaultNaming is the standard scheme: <service>.<slug>.langwatch.localhost.
func DefaultNaming(tld string) Naming {
	if tld == "" {
		tld = "localhost"
	}
	return Naming{Project: "langwatch", TLD: tld}
}

// Hostname is the routable hostname. Per-worktree services carry the slug;
// shared surfaces (dashboard, observability, telemetry) pass slug == "". The bare
// project name with no slug is the dashboard root (langwatch.localhost).
func (n Naming) Hostname(service, slug string) string {
	if service == n.Project && slug == "" {
		return n.Project + "." + n.TLD
	}
	left := service
	if slug != "" {
		left = service + "." + slug
	}
	return fmt.Sprintf("%s.%s.%s", left, n.Project, n.TLD)
}

// RouteName is the name handed to `portless alias` — the hostname minus the TLD,
// because portless re-appends the configured TLD.
func (n Naming) RouteName(service, slug string) string {
	return strings.TrimSuffix(n.Hostname(service, slug), "."+n.TLD)
}

// URL is the full browser URL for a service, reflecting the proxy's real
// scheme+port so it is correct on the default 443 or an unprivileged port.
func (n Naming) URL(service, slug, scheme string, port int) string {
	suffix := ""
	if !((scheme == "https" && port == 443) || (scheme == "http" && port == 80)) {
		suffix = fmt.Sprintf(":%d", port)
	}
	return fmt.Sprintf("%s://%s%s", scheme, n.Hostname(service, slug), suffix)
}
