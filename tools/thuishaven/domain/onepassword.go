package domain

import (
	"encoding/json"
	"errors"
	"regexp"
	"sort"
)

// 1Password addressing, read by haven only: the account LANGWATCH_OP_ACCOUNT names,
// the vault Private, the item "LangWatch haven secrets", one field per env key. Not
// plain "LangWatch": op matches titles case-insensitively, and saved logins share it.
const (
	OnePasswordAccountKey = "LANGWATCH_OP_ACCOUNT"
	OnePasswordVault      = "Private"
	OnePasswordItem       = "LangWatch haven secrets"
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

func sortedKeys(values map[string]string) []string {
	keys := make([]string, 0, len(values))
	for key := range values {
		keys = append(keys, key)
	}
	sort.Strings(keys)
	return keys
}
