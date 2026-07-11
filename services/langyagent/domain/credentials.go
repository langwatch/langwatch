package domain

import (
	"net/url"
	"regexp"
	"sort"
	"strings"
)

// Credentials is the per-conversation auth bundle the control plane sends in
// each /chat request. They are NEVER persisted — they live in the worker
// subprocess's env for the lifetime of the worker, and die with it. This is a
// pure value object: the workerpool adapter injects it into the subprocess
// env, and the httpapi adapter decodes it off the wire.
type Credentials struct {
	// LangwatchAPIKey is deliberately NOT `validate:"required"`.
	//
	// The control plane probes us before a turn and, when we already have a live
	// worker with the right capabilities, sends NO key at all — because a reused
	// worker keeps the key it booted with (it lives in the subprocess env; see
	// worker.go) and any key sent alongside a reuse would be minted, discarded
	// unread, and left valid for hours. Requiring it here would reject exactly the
	// requests we are trying to make cheap.
	//
	// The mandatory-ness moved to where it is actually true: a SPAWN needs a key.
	// Acquire enforces that and answers ErrCredentialsRequired when a spawn is
	// needed and no key came with the request, which the control plane resolves by
	// minting once and retrying. See `Spawnable`.
	LangwatchAPIKey string `json:"langwatchApiKey,omitempty"`
	// LangwatchAPIKeyID names the key WITHOUT granting anything: it is the handle
	// we hand back to the control plane when the worker dies so it can revoke the
	// key. We can revoke, and only revoke — we can never ask for a key to be
	// minted. That keeps the trust boundary where it was: the manager holds keys
	// it was given, and the worst a compromised manager can do with this handle is
	// destroy its own access.
	LangwatchAPIKeyID string `json:"langwatchApiKeyId,omitempty"`
	LLMVirtualKey     string `json:"llmVirtualKey" validate:"required"`
	GatewayBaseURL    string `json:"gatewayBaseUrl" validate:"required"`
	LangwatchEndpoint string `json:"langwatchEndpoint" validate:"required"`
	Model             string `json:"model,omitempty"`
	GithubToken       string `json:"githubToken,omitempty"`
	GithubLogin       string `json:"githubLogin,omitempty"`
	// EgressAllowlist is the project's per-project Langy egress allow-list
	// (ADR-043 rung 2), resolved by the control plane's
	// LangyCredentialService.getEgressAllowlist and threaded through this
	// envelope. The *presence* of the list is the mode: nil/empty ⇒ the egress
	// adapter watches but blocks nothing; non-empty ⇒ the adapter restricts
	// outbound to floor ∪ this list. Bound at worker spawn — a change recycles
	// the worker (see SignatureOf) so a live worker never runs a stale policy.
	EgressAllowlist []string `json:"egressAllowlist,omitempty"`
}

// Complete reports whether the mandatory credential fields are present. The
// per-worker LangWatch key, the LLM virtual key, and both base URLs are
// required to spawn a functional worker.
func (c Credentials) Complete() bool {
	return c.LangwatchAPIKey != "" && c.LLMVirtualKey != "" &&
		c.GatewayBaseURL != "" && c.LangwatchEndpoint != ""
}

// Spawnable reports whether these credentials can boot a NEW worker — i.e. a
// LangWatch key actually came with them.
//
// Reuse and spawn have different needs and this is the seam between them: a
// reuse legitimately arrives with no key (the live worker already has one in its
// env), whereas a spawn without a key would produce a worker that cannot call
// LangWatch at all. Rather than let that worker boot broken, Acquire refuses with
// ErrCredentialsRequired and the control plane mints and retries.
func (c Credentials) Spawnable() bool {
	return c.LangwatchAPIKey != ""
}

// CredentialSignature is a stable fingerprint of the credential capabilities a
// worker was spawned with. A worker whose capability set has changed since
// spawn (model swap, GH token added/removed) cannot be reused — reusing would
// mean:
//   - A worker that got a GH_TOKEN at spawn keeps it across later turns where
//     the control plane denied the daily PR cap (token's still in the
//     subprocess env; the model can still call `gh pr create`).
//   - A user switching the model picker mid-conversation appears to succeed but
//     execution stays on the originally-spawned model because setupWorkerHome
//     only ran once.
//
// The signature is compared on every reuse; mismatch → kill + respawn.
type CredentialSignature struct {
	Model         string
	HasGithubAuth bool
	// EgressAllowlist is a canonical fingerprint (sorted + newline-joined) of
	// the project's egress allow-list (ADR-043). Folding it in means a policy
	// change (the customer edits the list) recycles the worker on its next turn
	// — the egress adapter is rebuilt with the new list, so a live worker is
	// never left running under the old policy. A string (not the []string
	// itself) keeps CredentialSignature comparable with ==.
	EgressAllowlist string
}

// SignatureOf derives the comparable signature from a credentials payload.
// GithubLogin is deliberately excluded — it is a display label, not a
// capability, so a login change without a token must NOT force a recycle.
func SignatureOf(creds Credentials) CredentialSignature {
	return CredentialSignature{
		Model:           creds.Model,
		HasGithubAuth:   creds.GithubToken != "",
		EgressAllowlist: canonicalEgressAllowlist(creds.EgressAllowlist),
	}
}

// hostPatternPattern validates a normalised egress allow-list entry: an
// optional single "*." wildcard prefix, then dot-separated [a-z0-9-] labels.
// Mirrors the control plane's egressHostPatternSchema
// (LangyCredentialService.ts) so the Go and TS validators agree on what a host
// pattern is.
var hostPatternPattern = regexp.MustCompile(`^(\*\.)?([a-z0-9-]+\.)*[a-z0-9-]+$`)

// canonicalEgressAllowlist normalises an allow-list into an order-independent,
// case-insensitive fingerprint so semantically-equal lists (reordered, mixed
// case, trailing dots) do not spuriously recycle the worker, while any real
// membership change does. Entries that are not clean host patterns are DROPPED
// (defence in depth): the control plane already Zod-validates on write, so this
// only fires on a drifted or hostile envelope — but the manager still refuses to
// fold a URL, an authority with a port/userinfo, or a path-traversal like
// "../../etc" into an allow rule. Kept in step with the Go matcher's
// normalizeHost in adapters/egress/policy.go.
func canonicalEgressAllowlist(list []string) string {
	if len(list) == 0 {
		return ""
	}
	norm := make([]string, 0, len(list))
	for _, h := range list {
		if n, ok := normalizeHostPattern(h); ok {
			norm = append(norm, n)
		}
	}
	if len(norm) == 0 {
		return ""
	}
	sort.Strings(norm)
	return strings.Join(norm, "\n")
}

// normalizeHostPattern lowercases + trims an allow-list entry and validates it
// is a bare host (optionally "*."-wildcarded), returning ("", false) for
// anything carrying a scheme, path, port, userinfo, query, or path-traversal.
// It parses the value as the host of a scheme-relative URL — so "evil.com/steal",
// "host:443", "user@host", and "../../etc" cannot round-trip to a bare host —
// then charset-checks the result against hostPatternPattern.
func normalizeHostPattern(raw string) (string, bool) {
	h := strings.TrimSuffix(strings.ToLower(strings.TrimSpace(raw)), ".")
	if h == "" {
		return "", false
	}
	base := h
	if rest, ok := strings.CutPrefix(h, "*."); ok {
		base = rest
	}
	u, err := url.Parse("//" + base)
	if err != nil || u.Hostname() != base || u.Path != "" || u.RawQuery != "" || u.Fragment != "" || u.User != nil {
		return "", false
	}
	if !hostPatternPattern.MatchString(h) {
		return "", false
	}
	return h, true
}

// conversationIDPattern restricts conversationId to a filesystem-safe charset
// before it ever reaches filepath.Join — otherwise values like "../../etc"
// escape SESSIONS_ROOT.
var conversationIDPattern = regexp.MustCompile(`^[A-Za-z0-9_-]{1,128}$`)

// IsValidConversationID is true when value is safe to use as a path segment.
func IsValidConversationID(value string) bool {
	return conversationIDPattern.MatchString(value)
}
