package targets

import (
	"crypto/rand"
	"encoding/hex"
	"regexp"
	"sort"
	"strconv"
	"strings"
)

// secretReference is `{{ secrets.NAME }}` with flexible whitespace
// (specs/scenarios/http-agent-secret-references.feature).
var secretReference = regexp.MustCompile(`\{\{\s*secrets\.([A-Za-z_][A-Za-z0-9_]*)\s*\}\}`)

// redactedPlaceholder replaces a resolved secret value before it is shown.
const redactedPlaceholder = "[redacted]"

// fenced is a template with its secret references lifted out, and the
// substitution that puts the values back once it is rendered.
type fenced struct {
	template string
	values   []string
	nonce    string
}

func (f fenced) placeholder(i int) string { return "lw-secret-" + f.nonce + "-" + strconv.Itoa(i) }

// restore puts the lifted values back into the rendered output.
func (f fenced) restore(rendered string) string {
	for i, v := range f.values {
		rendered = strings.ReplaceAll(rendered, f.placeholder(i), v)
	}
	return rendered
}

// fence lifts secret references out of a template before Liquid renders it.
// A name the project lacks is put back verbatim, so a missing secret is a
// visible configuration error rather than a silent blank.
func fence(template string, secrets map[string]string) fenced {
	f := fenced{template: template, nonce: nonce()}
	if template == "" {
		return f
	}
	f.template = secretReference.ReplaceAllStringFunc(template, func(match string) string {
		name := secretReference.FindStringSubmatch(match)[1]
		value, ok := secrets[name]
		if !ok {
			value = match
		}
		f.values = append(f.values, value)
		return f.placeholder(len(f.values) - 1)
	})
	return f
}

// preserve lifts references out of a body template without resolving them.
func preserve(template string) fenced { return fence(template, nil) }

func nonce() string {
	var b [12]byte
	_, _ = rand.Read(b[:])
	return hex.EncodeToString(b[:])
}

// resolveSecrets replaces every reference with the project's secret.
func resolveSecrets(value string, secrets map[string]string) string {
	if value == "" || len(secrets) == 0 {
		return value
	}
	return secretReference.ReplaceAllStringFunc(value, func(match string) string {
		if v, ok := secrets[secretReference.FindStringSubmatch(match)[1]]; ok {
			return v
		}
		return match
	})
}

// renderAuth resolves references in the credential fields, on a copy.
func renderAuth(auth *AuthConfig, secrets map[string]string) *AuthConfig {
	if auth == nil || len(secrets) == 0 {
		return auth
	}
	out := *auth
	out.Token = resolveSecrets(auth.Token, secrets)
	out.Value = resolveSecrets(auth.Value, secrets)
	out.Username = resolveSecrets(auth.Username, secrets)
	if auth.Password != nil {
		p := resolveSecrets(*auth.Password, secrets)
		out.Password = &p
	}
	return &out
}

// redact replaces resolved secret values in a message, longest first.
func redact(message string, secrets map[string]string) string {
	if message == "" {
		return message
	}
	values := make([]string, 0, len(secrets))
	for _, v := range secrets {
		if v != "" {
			values = append(values, v)
		}
	}
	sort.SliceStable(values, func(i, j int) bool { return len(values[i]) > len(values[j]) })
	for _, v := range values {
		message = strings.ReplaceAll(message, v, redactedPlaceholder)
	}
	return message
}

// scrubKnownSecrets replaces each known secret of eight characters or more.
func scrubKnownSecrets(text string, secrets []string) string {
	for _, s := range secrets {
		if len(s) < 8 {
			continue
		}
		text = strings.ReplaceAll(text, s, redactedPlaceholder)
	}
	return text
}
