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

// LangevalsService is the Python evaluator service (services/langevals) the
// app calls for monitors and evaluations. Off by default: its import alone
// holds gigabytes. Routed at langevals.<slug>.langwatch.localhost.
const LangevalsService = "langevals"

// StorageService is the local S3 stand-in (services/storagesim), routed at
// storage.<slug>.langwatch.localhost. On by default, like mail.
const StorageService = "storage"

// VoiceService is the voice provider stand-in (services/voicesim) a scenario
// voice call talks to, routed at voice.<slug>.langwatch.localhost. Opt-in:
// it replaces a real provider endpoint, so nobody lands on it by surprise.
const VoiceService = "voice"

// LLMService is the LLM provider stand-in (services/llmsim), routed at
// llm.<slug>.langwatch.localhost. Opt-in like voice: it answers every model
// call the stack makes with seeded Markov text, so nothing costs money.
const LLMService = "llm"

// AnalyticsService is the product-analytics stand-in (services/analyticssim)
// that catches PostHog and Customer.io calls, routed at
// analytics.<slug>.langwatch.localhost. Opt-in like voice and llm.
const AnalyticsService = "analytics"

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

// MailAddress is this worktree's own inbox address. The sink is a catch-all,
// so any local part lands in the same inbox; dev@ is the one haven prints.
func (n Naming) MailAddress(slug string) string {
	return "dev@" + n.MailAddressDomain(slug)
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

// machineWideNames are the one-label hostnames under the project domain that
// belong to the machine, not to a worktree. A slug spelling one of them gets
// no home: routing it would take the hub, telemetry, Grafana or the
// standalone IdP away from every other stack.
var machineWideNames = map[string]bool{
	HubService: true, IdPService: true, ObservabilityService: true, "telemetry": true,
}

// StackHomeService is the routed name of a worktree's home page, served by the
// daemon at <slug>.langwatch.localhost: Hostname(name, "") is that host. ok is
// false for a slug that is not a hostname label or that names a machine-wide
// surface, and such a stack has no home.
func (n Naming) StackHomeService(slug string) (string, bool) {
	if !ValidSlug(slug) || slug == n.Project || machineWideNames[slug] {
		return "", false
	}
	return slug, true
}

// StackHomeSlug is StackHomeService read backwards: the slug whose home a Host
// header names, and ok=false for any host that is not one (the hub, a
// service's own host, anything off the project domain). A port is ignored.
func (n Naming) StackHomeSlug(host string) (string, bool) {
	if h, _, found := strings.Cut(host, ":"); found {
		host = h
	}
	label, isUnder := strings.CutSuffix(strings.ToLower(host), "."+n.Project+"."+n.TLD)
	if !isUnder || strings.Contains(label, ".") {
		return "", false
	}
	if _, ok := n.StackHomeService(label); !ok {
		return "", false
	}
	return label, true
}
