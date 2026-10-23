package domain

import (
	"encoding/json"
	"errors"
	"net/url"
	"regexp"
	"sort"
	"strings"
)

// 1Password addressing is the same convention the Node secrets chain uses
// (ARCHITECTURE.md §6): one account named by LANGWATCH_OP_ACCOUNT, the vault
// Private, the item LangWatch, one field per secret named by its env key.
const (
	OnePasswordAccountKey = "LANGWATCH_OP_ACCOUNT"
	OnePasswordVault      = "Private"
	OnePasswordItem       = "LangWatch Dev"
)

// envKeyPattern is what a field label must look like to become a variable.
var envKeyPattern = regexp.MustCompile(`^[A-Za-z_][A-Za-z0-9_]*$`)

// onePasswordField is the part of one field of `op item get --format json` haven reads.
type onePasswordField struct {
	Label   string `json:"label"`
	Value   string `json:"value"`
	Purpose string `json:"purpose"`
}

// OnePasswordFields reads an item's JSON into label to value: every field whose
// label is an env key and whose value is set. The notes field is not a secret.
func OnePasswordFields(raw []byte) (map[string]string, error) {
	var item struct {
		Fields []onePasswordField `json:"fields"`
	}
	if err := json.Unmarshal(raw, &item); err != nil {
		return nil, err
	}
	fields := make(map[string]string, len(item.Fields))
	for _, field := range item.Fields {
		if field.Purpose == "NOTES" || field.Value == "" || !envKeyPattern.MatchString(field.Label) {
			continue
		}
		if _, seen := fields[field.Label]; !seen {
			fields[field.Label] = field.Value
		}
	}
	return fields, nil
}

// NewOnePasswordItem is the template `op item create -` reads from stdin.
func NewOnePasswordItem(values map[string]string) ([]byte, error) {
	fields := make([]map[string]any, 0, len(values))
	for _, key := range sortedKeys(values) {
		fields = append(fields, concealedField(key, values[key]))
	}
	return json.Marshal(map[string]any{
		"title": OnePasswordItem, "category": "SECURE_NOTE", "fields": fields,
	})
}

// MergeOnePasswordItem sets values on an existing item's JSON, keeping every
// other part of it, for `op item edit` to read from stdin. A field with the
// key's label takes the new value; a key with no field gets a concealed one.
func MergeOnePasswordItem(raw []byte, values map[string]string) ([]byte, error) {
	var item map[string]any
	if err := json.Unmarshal(raw, &item); err != nil {
		return nil, err
	}
	existing, _ := item["fields"].([]any)
	if item["fields"] != nil && existing == nil {
		return nil, errors.New("the item's fields are not a list")
	}
	pending := make(map[string]string, len(values))
	for key, value := range values {
		pending[key] = value
	}
	for _, entry := range existing {
		field, ok := entry.(map[string]any)
		label, _ := field["label"].(string)
		if value, wanted := pending[label]; ok && wanted {
			field["value"] = value
			delete(pending, label)
		}
	}
	for _, key := range sortedKeys(pending) {
		existing = append(existing, concealedField(key, pending[key]))
	}
	item["fields"] = existing
	return json.Marshal(item)
}

func concealedField(key, value string) map[string]any {
	return map[string]any{"label": key, "type": "CONCEALED", "value": value}
}

// OnePasswordEnv is the KEY=VALUE set to inject from the item: every field the
// shell and .env (resolved) leave unset, in a stable order.
func OnePasswordEnv(fields, resolved map[string]string) []string {
	env := make([]string, 0, len(fields))
	for _, key := range sortedKeys(fields) {
		if resolved[key] == "" {
			env = append(env, key+"="+fields[key])
		}
	}
	return env
}

// DotenvEntry is one assignment in a dotenv file and the lines it spans
// (0-based, inclusive), so a rewrite can drop it without touching the lines around it.
type DotenvEntry struct {
	Key, Value  string
	First, Last int
}

// ParseDotenvEntries reads every assignment in a dotenv text, including a
// quoted value that spans lines (a PEM key). Comments and blank lines are not entries.
func ParseDotenvEntries(text string) []DotenvEntry {
	lines := strings.Split(text, "\n")
	var entries []DotenvEntry
	for i := 0; i < len(lines); i++ {
		line := strings.TrimPrefix(strings.TrimSpace(lines[i]), "export ")
		key, rest, ok := strings.Cut(line, "=")
		key = strings.TrimSpace(key)
		if strings.HasPrefix(line, "#") || !ok || !envKeyPattern.MatchString(key) {
			continue
		}
		value, last := dotenvValue(strings.TrimSpace(rest), lines, i)
		entries = append(entries, DotenvEntry{Key: key, Value: value, First: i, Last: last})
		i = last
	}
	return entries
}

// dotenvValue reads the value starting on line first: a quoted one up to its
// closing quote, however many lines on; an unquoted one cut at " #".
func dotenvValue(rest string, lines []string, first int) (string, int) {
	if rest == "" || (rest[0] != '"' && rest[0] != '\'') {
		if i := strings.Index(rest, " #"); i >= 0 {
			rest = rest[:i]
		}
		return strings.TrimSpace(rest), first
	}
	quote, body := rest[0], rest[1:]
	for last := first; ; last++ {
		if end := strings.IndexByte(body, quote); end >= 0 {
			return body[:end], last
		}
		if last+1 >= len(lines) {
			return body, last
		}
		body += "\n" + lines[last+1]
	}
}

// CarriesCredential reports whether one .env assignment holds a credential: a
// set value of a secret-class key, except a connection string with no password
// in it (a local database URL is config).
func CarriesCredential(classes map[string]SecretClass, key, value string) bool {
	if value == "" || key == OnePasswordAccountKey || ClassOf(classes, key) != ClassSecret {
		return false
	}
	parsed, err := url.Parse(strings.TrimSpace(value))
	if err != nil || parsed.Host == "" {
		return true
	}
	_, hasPassword := parsed.User.Password()
	return hasPassword
}

// DotenvCredentials are the entries that carry a credential, one per key: the
// first, which is the line the secrets chain reads.
func DotenvCredentials(classes map[string]SecretClass, entries []DotenvEntry) []DotenvEntry {
	seen := map[string]bool{}
	var out []DotenvEntry
	for _, entry := range entries {
		if seen[entry.Key] || !CarriesCredential(classes, entry.Key, entry.Value) {
			continue
		}
		seen[entry.Key] = true
		out = append(out, entry)
	}
	return out
}

// RewriteDotenv drops every line of every entry whose key is in moved and sets
// LANGWATCH_OP_ACCOUNT to account, replacing its line or appending one. Every
// other line is kept byte for byte.
func RewriteDotenv(text string, moved map[string]bool, account string) string {
	lines := strings.Split(text, "\n")
	drop, accountLine := dotenvEdits(text, len(lines), moved)
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
		return strings.Join(kept, "\n")
	}
	if n := len(kept); n > 0 && kept[n-1] == "" {
		return strings.Join(append(kept[:n-1], assignment, ""), "\n")
	}
	return strings.Join(append(kept, assignment), "\n")
}

// dotenvEdits marks the lines of every moved entry and finds the first
// LANGWATCH_OP_ACCOUNT line (-1 when there is none).
func dotenvEdits(text string, lineCount int, moved map[string]bool) ([]bool, int) {
	drop := make([]bool, lineCount)
	accountLine := -1
	for _, entry := range ParseDotenvEntries(text) {
		if moved[entry.Key] {
			for i := entry.First; i <= entry.Last; i++ {
				drop[i] = true
			}
		} else if entry.Key == OnePasswordAccountKey && accountLine < 0 {
			accountLine = entry.First
		}
	}
	return drop, accountLine
}

func sortedKeys(values map[string]string) []string {
	keys := make([]string, 0, len(values))
	for key := range values {
		keys = append(keys, key)
	}
	sort.Strings(keys)
	return keys
}
