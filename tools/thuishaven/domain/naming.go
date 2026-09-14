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

// IdPService is the IdP simulator's routed name. Per-worktree stacks carry the
// slug (idp.<slug>.langwatch.localhost); the standalone `haven idp` runner
// routes it slugless, as the machine-wide idp.langwatch.localhost.
const IdPService = "idp"

// MailService is the local mail sink (mailsim)'s routed name. Per-worktree
// stacks carry the slug (mail.<slug>.langwatch.localhost). "mail" was retired
// as a ±selector spelling for the mail studio when that studio was renamed to
// mail-room (see RetiredSelectionServices's history) — freeing it for this,
// the actual mail lane, rather than a compatibility alias for a different
// service.
const MailService = "mail"

// DesignSystemService is the design system's Storybook, routed as
// design-system.<slug>.langwatch.localhost. The lane is called design-system
// everywhere someone types it too (`haven up +design-system`, `haven logs
// design-system`) — the hostname and the CLI spelling are the same word.
const DesignSystemService = "design-system"

// MailRoomService is the mail studio — the preview of every transactional
// message the product sends — routed at mail-room.<slug>.langwatch.localhost.
// Its lane is called mail-room too.
const MailRoomService = "mail-room"

// APIService is the Hono API's own routed hostname
// (api.<slug>.langwatch.localhost). It is additive, not a replacement: the
// same-origin app.<slug>.../api path (Vite's own proxy to Stack.APIPort)
// keeps working unchanged. This hostname is a direct route to the same port
// for tooling that wants the API without the UI dev server in front of it  -
// see Stack.APIPort.
const APIService = "api"

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

// MailAddressDomain is the domain half of this worktree's own inbox address —
// deliberately NOT the routed hostname's order (mail.<slug>...): an email
// address domain carries no scheme or port, so there is no ambiguity in
// leading with the slug. `haven mail address` builds on this convention; haven
// itself never sets SEED_EMAIL_DOMAIN — the seeded login stays the stable
// global address so a saved credential keeps working, and a developer who
// wants per-stack seeded addresses sets that variable themselves.
func (n Naming) MailAddressDomain(slug string) string {
	return fmt.Sprintf("%s.mail.%s.%s", slug, n.Project, n.TLD)
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
