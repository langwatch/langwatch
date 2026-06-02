package engine

import (
	"regexp"

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
