package egress

import "strings"

// egressPolicy is the per-worker allow decision (ADR-043 rungs 2 and 3). It is
// constructed at worker spawn from that worker's credentials envelope
// (customer allowlist) plus the operator floor, and never mutated afterwards —
// a policy change recycles the worker (see domain.SignatureOf).
//
// Decision precedence, given a destination FQDN:
//
//  1. floor      → allow (the always-on structural set; allowed even when a
//     customer allow-list would otherwise exclude it).
//  2. not enforcing (no customer list AND floor not enforced) → allow, but
//     flagged monitor-only. This is the safe default: an install that
//     configured nothing upgrades into watching, not blocking.
//  3. customer list contains it → allow.
//  4. otherwise → deny.
//
// "Enforcing" is the whole opt-in: the *presence* of a customer allow-list is
// the mode (non-empty ⇒ restrict to floor ∪ list). enforceFloor is the
// separate operator rung-3 lever that turns the floor into a hard ceiling even
// without a customer list — off by default so the stock posture stays
// monitor-only.
type egressPolicy struct {
	// allowlist is the customer's per-project set (nil/empty ⇒ monitor-only).
	// Threaded from Project.langyEgressAllowlist via the credentials envelope.
	allowlist []string
	// floor is the operator-owned always-allowed set (github / gateway /
	// control plane). Additive to the customer list, never a ceiling by itself.
	floor []string
	// enforceFloor makes the floor a hard ceiling when the customer sets no
	// list (rung 3 "always-on floor" operator lever). Default false.
	enforceFloor bool
}

// enforcing reports whether the policy blocks anything at all. False ⇒ every
// destination is allowed (monitor-only). True ⇒ only floor ∪ allowlist pass.
func (p egressPolicy) enforcing() bool {
	return len(p.allowlist) > 0 || p.enforceFloor
}

// decide returns the verb for a destination FQDN and whether it is allowed.
// The host is compared case-insensitively with the trailing root-dot stripped.
func (p egressPolicy) decide(host string) egressDecision {
	if hostMatchesAny(host, p.floor) {
		return egressAllowedFloor
	}
	if !p.enforcing() {
		return egressAllowedMonitor
	}
	if hostMatchesAny(host, p.allowlist) {
		return egressAllowedListed
	}
	return egressDenied
}

// hostMatchesAny is true if host matches any pattern. A pattern is either an
// exact FQDN ("registry.npmjs.org") or a single-leading-label wildcard
// ("*.internal.acme.com" — matches "a.internal.acme.com" but NOT the bare
// "internal.acme.com" nor a two-label "a.b.internal.acme.com"). The
// single-label bound is deliberate (ADR-043 open question 1): it keeps the
// matcher's attack surface narrow while covering the common "any host under my
// internal domain" case.
func hostMatchesAny(host string, patterns []string) bool {
	h := normalizeHost(host)
	if h == "" {
		return false
	}
	for _, raw := range patterns {
		p := normalizeHost(raw)
		if p == "" {
			continue
		}
		if suffix, ok := strings.CutPrefix(p, "*."); ok {
			// host must be exactly one label followed by ".<suffix>".
			rest, matched := strings.CutSuffix(h, "."+suffix)
			if matched && rest != "" && !strings.Contains(rest, ".") {
				return true
			}
			continue
		}
		if h == p {
			return true
		}
	}
	return false
}

// normalizeHost lowercases and strips a trailing root dot so "GitHub.com." and
// "github.com" compare equal.
func normalizeHost(host string) string {
	return strings.TrimSuffix(strings.ToLower(strings.TrimSpace(host)), ".")
}
