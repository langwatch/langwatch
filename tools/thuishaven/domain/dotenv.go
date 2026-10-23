package domain

import (
	"fmt"
	"net/url"
	"strings"
)

// The .env reader `haven secrets move` and the `haven up` guard use. It reads a
// value exactly as Node's own dotenv parser (util.parseEnv, node --env-file)
// does, because that is what the apps read; it refuses an unterminated quote
// where Node would quietly keep the raw line.

// DotenvEntry is one assignment in a dotenv file and the lines it spans
// (0-based, inclusive), so a rewrite can drop it without touching the lines around it.
type DotenvEntry struct {
	Key, Value  string
	First, Last int
}

// ParseDotenvEntries reads every assignment in a dotenv text in file order,
// including a quoted value that spans lines (a PEM key). Comments and blank
// lines are not entries; an unterminated quote is an error naming its key.
func ParseDotenvEntries(text string) ([]DotenvEntry, error) {
	lines := strings.Split(text, "\n")
	var entries []DotenvEntry
	for i := 0; i < len(lines); i++ {
		line := strings.TrimSpace(strings.TrimSuffix(lines[i], "\r"))
		key, rest, ok := strings.Cut(strings.TrimPrefix(line, "export "), "=")
		key = strings.TrimSpace(key)
		if strings.HasPrefix(line, "#") || !ok || !envKeyPattern.MatchString(key) {
			continue
		}
		value, last, err := dotenvValue(strings.TrimSpace(rest), lines, i)
		if err != nil {
			return nil, fmt.Errorf(".env line %d (%s): %w", i+1, key, err)
		}
		entries = append(entries, DotenvEntry{Key: key, Value: value, First: i, Last: last})
		i = last
	}
	return entries, nil
}

// dotenvValue reads the value starting on line first, by Node's rules: a value
// opened by ", ' or ` runs to the same quote, however many lines on, and the
// rest of that line is ignored; inside double quotes \n is a newline and no
// other escape exists. An unquoted value ends at the first #.
func dotenvValue(rest string, lines []string, first int) (string, int, error) {
	if rest == "" || !strings.ContainsRune("\"'`", rune(rest[0])) {
		value, _, _ := strings.Cut(rest, "#")
		return strings.TrimSpace(value), first, nil
	}
	quote, body := rest[0], rest[1:]
	last := first
	for !strings.ContainsRune(body, rune(quote)) {
		if last+1 >= len(lines) {
			return "", last, fmt.Errorf("the %c quote is never closed", quote)
		}
		last++
		body += "\n" + strings.TrimSuffix(lines[last], "\r")
	}
	value, _, _ := strings.Cut(body, string(quote))
	if quote == '"' {
		value = strings.ReplaceAll(value, `\n`, "\n")
	}
	return value, last, nil
}

// connectionStringKeys are the store URLs whose value is config unless it
// carries a password. Every other secret-class key with a value is a credential,
// URL-shaped or not (a Slack webhook URL is the credential itself).
var connectionStringKeys = map[string]bool{
	"DATABASE_URL": true, "CLICKHOUSE_URL": true, "REDIS_URL": true, "SMTP_URL": true,
}

// CarriesCredential reports whether one .env assignment holds a credential: a
// set value of a secret-class key, except a store URL with no password in it.
func CarriesCredential(classes map[string]SecretClass, key, value string) bool {
	if value == "" || key == OnePasswordAccountKey || ClassOf(classes, key) != ClassSecret {
		return false
	}
	if !connectionStringKeys[key] && !strings.HasPrefix(key, "CLICKHOUSE_URL__") {
		return true
	}
	parsed, err := url.Parse(strings.TrimSpace(value))
	if err != nil || parsed.Host == "" {
		return true
	}
	_, hasPassword := parsed.User.Password()
	return hasPassword
}

// DotenvCredentials are the entries that carry a credential, one per key: the
// last, which is the one Node reads.
func DotenvCredentials(classes map[string]SecretClass, entries []DotenvEntry) []DotenvEntry {
	last := map[string]int{}
	for i, entry := range entries {
		last[entry.Key] = i
	}
	var out []DotenvEntry
	for i, entry := range entries {
		if last[entry.Key] == i && CarriesCredential(classes, entry.Key, entry.Value) {
			out = append(out, entry)
		}
	}
	return out
}

// RewriteDotenv drops every line of every entry whose key is in moved and sets
// LANGWATCH_OP_ACCOUNT to account, replacing its line or appending one. Every
// other line is kept byte for byte.
func RewriteDotenv(text string, moved map[string]bool, account string) (string, error) {
	entries, err := ParseDotenvEntries(text)
	if err != nil {
		return "", err
	}
	lines := strings.Split(text, "\n")
	drop, accountLine := dotenvEdits(entries, len(lines), moved)
	assignment := OnePasswordAccountKey + `="` + account + `"`
	kept := make([]string, 0, len(lines)+1)
	for i, line := range lines {
		if i == accountLine {
			line = assignment
		}
		if !drop[i] {
			kept = append(kept, line)
		}
	}
	if accountLine >= 0 {
		return strings.Join(kept, "\n"), nil
	}
	if n := len(kept); n > 0 && kept[n-1] == "" {
		return strings.Join(append(kept[:n-1], assignment, ""), "\n"), nil
	}
	return strings.Join(append(kept, assignment), "\n"), nil
}

// dotenvEdits marks the lines of every moved entry and finds the last
// LANGWATCH_OP_ACCOUNT line (-1 when there is none); earlier ones are dropped.
func dotenvEdits(entries []DotenvEntry, lineCount int, moved map[string]bool) ([]bool, int) {
	drop := make([]bool, lineCount)
	var account *DotenvEntry
	for i := range entries {
		switch entry := &entries[i]; {
		case moved[entry.Key]:
			markLines(drop, *entry)
		case entry.Key == OnePasswordAccountKey:
			if account != nil {
				markLines(drop, *account)
			}
			account = entry
		}
	}
	if account == nil {
		return drop, -1
	}
	markLines(drop, *account)
	drop[account.First] = false
	return drop, account.First
}

func markLines(drop []bool, entry DotenvEntry) {
	for i := entry.First; i <= entry.Last; i++ {
		drop[i] = true
	}
}
