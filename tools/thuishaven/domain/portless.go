package domain

import "strings"

// PortlessVersion is the one portless release haven installs and runs. It is
// recorded here and nowhere else: the install argument, the "already current"
// check and the upgrade decision all read this constant, so a bump is a
// one-line change and every worktree on the machine converges on the same
// proxy. Upstream (github.com/vercel-labs/portless) ships portless as an npm
// package, so this is an npm version.
const PortlessVersion = "0.15.6"

// PortlessPackage is the npm spec `npm install -g` is given — the pin applied.
func PortlessPackage() string { return "portless@" + PortlessVersion }

// PortlessAction is what `haven up` must do about portless before it can route
// a hostname.
type PortlessAction int

const (
	// PortlessReady means a binary at the pinned version is on the machine.
	PortlessReady PortlessAction = iota
	// PortlessInstall means nothing runnable is resolvable — install the pin.
	PortlessInstall
	// PortlessUpgrade means a runnable binary at a different version is present
	// — install the pin over it. haven upgrades rather than refusing: portless is
	// a local dev proxy shared by every worktree on the machine, and a stack
	// routed by an unpinned build fails in ways that look like haven bugs.
	PortlessUpgrade
	// PortlessUnknownVersion means a runnable binary is present but will not say
	// what it is. Left alone — reinstalling on every `up` would be the opposite
	// of idempotent — but said out loud, because nothing vouched for it.
	PortlessUnknownVersion
)

// PlanPortless decides that, given whether a real binary resolved and the
// version it reported ("" when it reported none). Pure, so the decision is
// testable without touching npm or the network.
func PlanPortless(installed bool, version string) PortlessAction {
	if !installed {
		return PortlessInstall
	}
	switch normalizePortlessVersion(version) {
	case "":
		return PortlessUnknownVersion
	case PortlessVersion:
		return PortlessReady
	default:
		return PortlessUpgrade
	}
}

// normalizePortlessVersion pulls the version out of whatever `portless
// --version` printed: bare ("0.15.6"), v-prefixed, or a banner whose first
// whitespace-separated token is the number.
func normalizePortlessVersion(raw string) string {
	fields := strings.Fields(strings.TrimSpace(raw))
	if len(fields) == 0 {
		return ""
	}
	return strings.TrimPrefix(fields[len(fields)-1], "v")
}
