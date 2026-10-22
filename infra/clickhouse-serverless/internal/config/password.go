package config

import "strings"

// publishedPasswords are defaults shipped in compose files, docs and
// examples. A server using one starts, but warns at every boot (ADR-184).
var publishedPasswords = map[string]bool{
	"langwatch":  true,
	"clickhouse": true,
	"password":   true,
	"default":    true,
}

// WeakPasswordWarning returns a warning when the default user's password is
// published or blank-looking, and "" otherwise.
func (i *Input) WeakPasswordWarning() string {
	pw := strings.ToLower(strings.TrimSpace(i.Password))
	if pw != "" && !publishedPasswords[pw] {
		return ""
	}
	return "the default user's password is a published default or blank; anyone who can reach " +
		"ports 8123/9000 can log in as admin. Set CLICKHOUSE_PASSWORD (Docker Compose: in .env, " +
		"generate with `openssl rand -hex 24`) or CLICKHOUSE_PASSWORD_FILE. The `langwatch` " +
		"fallback in infra/compose.yml is deprecated and goes in the next major release"
}
