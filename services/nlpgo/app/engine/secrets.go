package engine

import (
	"regexp"
	"sort"
	"strings"

	"github.com/langwatch/langwatch/services/nlpgo/app/engine/blocks/httpblock"
)

// secretRefRE matches a secret reference like `{{ secrets.NAME }}` with
// flexible internal whitespace. NAME follows the usual identifier shape.
var secretRefRE = regexp.MustCompile(`\{\{\s*secrets\.([A-Za-z_][A-Za-z0-9_]*)\s*\}\}`)

// resolveSecretRefs replaces `{{ secrets.NAME }}` references in s with the
// matching value from the workflow's decrypted secrets map (populated
// upstream by addEnvs.ts and carried on the DSL as `workflow.secrets`).
//
// Resolution happens at request-build time — not parse time — so a rotated
// value is honored on the next execute, and the plaintext is substituted
// only into the outbound request, never into the body template that gets
// rendered into logged execution events. This mirrors the Python executor,
// which exposes secrets only at execution time (build_secrets_preamble).
//
// A reference whose name is absent from the map is left verbatim: a missing
// secret is a configuration error the author should see, not a silent blank
// that masks the problem (or sends an empty credential upstream).
func resolveSecretRefs(s string, secrets map[string]string) string {
	if s == "" || len(secrets) == 0 {
		return s
	}
	return secretRefRE.ReplaceAllStringFunc(s, func(match string) string {
		name := secretRefRE.FindStringSubmatch(match)[1]
		if v, ok := secrets[name]; ok {
			return v
		}
		return match
	})
}

// resolveSecretsInMap returns a copy of m with secret references resolved in
// every value. Keys (e.g. header names) are left untouched — they are not
// credentials. Returns m unchanged when there is nothing to resolve.
func resolveSecretsInMap(m map[string]string, secrets map[string]string) map[string]string {
	if len(m) == 0 || len(secrets) == 0 {
		return m
	}
	out := make(map[string]string, len(m))
	for k, v := range m {
		out[k] = resolveSecretRefs(v, secrets)
	}
	return out
}

// redactSecrets replaces any occurrence of a resolved secret *value* in s with
// a placeholder. It is the engine's scrubber for DIAGNOSTIC text — node error
// messages, tracebacks, stdout and stderr.
//
// It covers every node kind not because each kind was enumerated but by
// construction: redactNodeSecrets calls it from dispatch, dispatch is the sole
// caller of dispatchNode (the executor switch), and dispatch itself has exactly
// two callers, runLayer and runLayerStream. Adding a node kind cannot route
// around it without adding a third caller of dispatchNode. The HTTP path also
// calls it directly, where Go transport errors embed the full request URL (e.g.
// `Get "https://api/x?token=rotated-value": dial ...`) and would otherwise
// reflect a substituted secret into execution events, traces, and logs.
//
// Longest value first, and that ordering is load-bearing rather than tidy. When
// one secret's value contains another's — versioned or paired keys, `…live` and
// `…live-v2`, are the ordinary case — replacing the SHORTER one first chops the
// longer one into "[redacted]" plus a surviving tail, and the pass for the
// longer value then finds no intact match left. Go randomizes map iteration, so
// before this sort the outcome varied run to run and the bad outcome was the
// common one. A fragment left beside a "[redacted]" tag is worse than no
// redaction: the tag reads as proof the value was scrubbed.
//
// What it does NOT catch: this is a literal substring replace, so any transform
// defeats it — base64, hex or URL encoding, case folding, or a `key[:8]` slice.
// A code node runs arbitrary Python over a live `secrets.NAME` namespace, so
// treat this as closing ACCIDENTAL disclosure (a secret interpolated into a
// message that then raises), NOT as a boundary against code written to
// exfiltrate. The author of the code already holds the secret.
func redactSecrets(s string, secrets map[string]string) string {
	if s == "" || len(secrets) == 0 {
		return s
	}
	values := make([]string, 0, len(secrets))
	for _, v := range secrets {
		if v != "" {
			values = append(values, v)
		}
	}
	sort.Slice(values, func(i, j int) bool { return len(values[i]) > len(values[j]) })
	for _, v := range values {
		s = strings.ReplaceAll(s, v, "[redacted]")
	}
	return s
}

// resolveAuthSecrets resolves secret references in the credential-bearing
// fields of an HTTP auth config. Type and Header (the api_key header *name*)
// are left alone — they are not secrets.
func resolveAuthSecrets(a *httpblock.Auth, secrets map[string]string) *httpblock.Auth {
	if a == nil || len(secrets) == 0 {
		return a
	}
	a.Token = resolveSecretRefs(a.Token, secrets)
	a.Value = resolveSecretRefs(a.Value, secrets)
	a.Username = resolveSecretRefs(a.Username, secrets)
	a.Password = resolveSecretRefs(a.Password, secrets)
	return a
}
