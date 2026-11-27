package access

import (
	"bytes"
	"context"
	"encoding/xml"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"time"

	"go.uber.org/zap"
	"gopkg.in/yaml.v3"

	"github.com/langwatch/langwatch/infra/clickhouse-serverless/internal/bootstrap"
)

// staticCredentialKeys are the users.d login methods dynamic-only mode refuses:
// a password, or a key, that stays valid until someone edits the file.
// ldap, kerberos, ssl_certificates and http_authentication defer to a system
// that can expire or revoke the credential, so they stay allowed.
var staticCredentialKeys = map[string]bool{
	"password":                  true,
	"password_sha256_hex":       true,
	"password_double_sha1_hex":  true,
	"password_scram_sha256_hex": true,
	"no_password":               true,
	"ssh_keys":                  true,
}

// StaticCredentials lists the users a users.d file (XML or YAML) defines with
// a long-lived credential, as "<file>: user <name> logs in with <key>". Users
// named in allow are skipped, as is any user the file removes.
func StaticCredentials(path string, allow ...string) ([]string, error) {
	raw, err := os.ReadFile(path)
	if err != nil {
		return nil, err
	}
	var users []configNode
	switch strings.ToLower(filepath.Ext(path)) {
	case ".yaml", ".yml":
		users, err = yamlUsers(raw)
	default:
		users, err = xmlUsers(raw)
	}
	if err != nil {
		return nil, fmt.Errorf("%s: %w", path, err)
	}
	skip := map[string]bool{}
	for _, name := range allow {
		skip[name] = true
	}
	var found []string
	for _, u := range users {
		if skip[u.name] || u.removed {
			continue
		}
		for _, key := range u.credentialKeys() {
			found = append(found, fmt.Sprintf("%s: user %s logs in with %s", path, u.name, key))
		}
	}
	return found, nil
}

// configNode is one element of a ClickHouse config tree: its name, whether
// it carries remove="1", and its children.
type configNode struct {
	name     string
	removed  bool
	children []configNode
}

func (n configNode) credentialKeys() []string {
	var keys []string
	for _, c := range n.children {
		switch {
		case c.removed:
		case staticCredentialKeys[c.name]:
			keys = append(keys, c.name)
		case c.name == "auth_methods":
			for _, method := range c.children {
				for _, k := range method.credentialKeys() {
					keys = append(keys, "auth_methods."+method.name+"."+k)
				}
			}
		}
	}
	sort.Strings(keys)
	return keys
}

func isRemoved(v string) bool { return v == "1" || v == "true" }

func xmlUsers(raw []byte) ([]configNode, error) {
	dec := xml.NewDecoder(bytes.NewReader(raw))
	var stack []*configNode
	root := &configNode{}
	stack = append(stack, root)
	for {
		tok, err := dec.Token()
		if errors.Is(err, io.EOF) {
			break
		}
		if err != nil {
			return nil, err
		}
		switch t := tok.(type) {
		case xml.StartElement:
			n := configNode{name: t.Name.Local}
			for _, a := range t.Attr {
				if a.Name.Local == "remove" && isRemoved(a.Value) {
					n.removed = true
				}
			}
			parent := stack[len(stack)-1]
			parent.children = append(parent.children, n)
			stack = append(stack, &parent.children[len(parent.children)-1])
		case xml.EndElement:
			stack = stack[:len(stack)-1]
		}
	}
	var users []configNode
	for _, top := range root.children { // <clickhouse> or <yandex>
		for _, section := range top.children {
			if section.name == "users" {
				users = append(users, section.children...)
			}
		}
	}
	return users, nil
}

func yamlUsers(raw []byte) ([]configNode, error) {
	var doc map[string]any
	if err := yaml.Unmarshal(raw, &doc); err != nil {
		return nil, err
	}
	users, _ := doc["users"].(map[string]any)
	var out []configNode
	for name, v := range users {
		out = append(out, yamlNode(name, v))
	}
	sort.Slice(out, func(i, j int) bool { return out[i].name < out[j].name })
	return out, nil
}

func yamlNode(name string, v any) configNode {
	n := configNode{name: name}
	m, ok := v.(map[string]any)
	if !ok {
		return n
	}
	for k, child := range m {
		if strings.HasPrefix(k, "@") {
			if k == "@remove" && isRemoved(fmt.Sprint(child)) {
				n.removed = true
			}
			continue
		}
		n.children = append(n.children, yamlNode(k, child))
	}
	return n
}

// Querier runs SQL against the local server; bootstrap.Client is one.
type Querier interface {
	Query(ctx context.Context, sql string) ([]byte, error)
}

// passwordLoginsQuery finds users, file-defined or SQL, with a password or key
// login: what dynamic-only mode allows nobody but the local admin. default
// counts only while some network may reach it.
var passwordLoginsQuery = `SELECT name, storage, arrayStringConcat(arrayMap(t -> toString(t), auth_type), ',')
FROM system.users
WHERE name != '` + bootstrap.User + `'
  AND arrayExists(t -> toString(t) IN ('no_password', 'plaintext_password', 'sha256_password', 'scram_sha256_password', 'double_sha1_password', 'bcrypt_password', 'ssh_key'), auth_type)
  AND (name != 'default' OR length(host_ip) + length(host_names) + length(host_names_regexp) + length(host_names_like) > 0)
ORDER BY name
FORMAT TabSeparated`

// PasswordLogins asks the server which users still log in with a password.
// Run by the sidecar in dynamic-only mode: a SQL user created with a password
// before the mode was on, or a users.d file added while the server runs,
// is out of reach of the checks at startup.
func PasswordLogins(ctx context.Context, q Querier) ([]string, error) {
	out, err := q.Query(ctx, passwordLoginsQuery)
	if err != nil {
		return nil, err
	}
	var found []string
	for _, line := range strings.Split(strings.TrimSpace(string(out)), "\n") {
		cols := strings.Split(line, "\t")
		if len(cols) != 3 {
			continue
		}
		found = append(found, fmt.Sprintf("user %s (%s) logs in with %s", cols[0], cols[1], cols[2]))
	}
	return found, nil
}

// AuditInterval is how often the sidecar asks for password logins.
const AuditInterval = time.Minute

// Auditor logs password logins on a dynamic-only server, at error level, each
// time the set changes. It reports and never drops a user: that is the
// operator's call, and an admin may have made it on purpose.
type Auditor struct {
	Q   Querier
	Log *zap.Logger

	last string
}

// Check runs one audit.
func (a *Auditor) Check(ctx context.Context) {
	found, err := PasswordLogins(ctx, a.Q)
	if err != nil {
		a.Log.Warn("password login audit failed", zap.Error(err))
		return
	}
	key := strings.Join(found, "\n")
	if key == a.last {
		return
	}
	a.last = key
	if len(found) == 0 {
		a.Log.Info("password login audit: only the local admin has a password")
		return
	}
	a.Log.Error("dynamic-only server still has password logins; move them to token logins or drop them",
		zap.Strings("users", found))
}

// Run audits every interval while enabled reports true, until ctx ends.
func (a *Auditor) Run(ctx context.Context, interval time.Duration, enabled func() bool) {
	ticker := time.NewTicker(interval)
	defer ticker.Stop()
	for {
		if enabled() {
			a.Check(ctx)
		}
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
		}
	}
}
