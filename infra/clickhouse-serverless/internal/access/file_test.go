package access

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

const validFile = `
issuers:
  - name: staff
    url: https://accounts.example.com
    required_claims: {email_verified: true}
  - name: ci
    url: https://token.actions.githubusercontent.com
    username_claim: sub
    allow_admin: true
users:
  - name: alice
    tier: read
    databases: [analytics]
    networks: [10.0.0.0/8]
    login: {token: {issuer: staff, subject: alice@example.com}}
  - name: deployer
    tier: admin
    login: {token: {issuer: ci}}
  - name: metabase
    tier: write
    databases: [analytics, staging]
    login: {rolling: {dir: /mnt/secrets/metabase}}
  - name: auditor
    tier: inspect
    login: {rolling: {dir: /mnt/secrets/auditor}}
`

func TestParse_ValidFileGetsDefaults(t *testing.T) {
	f, err := Parse([]byte(validFile))
	if err != nil {
		t.Fatalf("Parse: %v", err)
	}
	staff, _ := f.Issuer("staff")
	if staff.Audience != "clickhouse" || staff.UsernameClaim != "sub" {
		t.Errorf("staff defaults = audience %q, claim %q", staff.Audience, staff.UsernameClaim)
	}
	deployer, _ := f.User("deployer")
	if deployer.Login.Token.Subject != "deployer" {
		t.Errorf("subject defaults to the user name, got %q", deployer.Login.Token.Subject)
	}
	if got := deployer.Networks; len(got) != 1 || got[0] != "::/0" {
		t.Errorf("networks default = %v, want [::/0]", got)
	}
	alice, _ := f.User("alice")
	if alice.Login.Token.Subject != "alice@example.com" {
		t.Errorf("explicit subject lost: %q", alice.Login.Token.Subject)
	}
}

// @scenario "An invalid access file stops the server from starting"
func TestParse_RefusesInvalidFiles(t *testing.T) {
	user := func(body string) string { return "users:\n  - " + body + "\n" }
	cases := []struct {
		name, file, want string
	}{
		{"unknown top-level key", "groups: []\n", "field groups not found"},
		{"unknown user key", user("{name: a, tier: read, databases: [d], login: {rolling: {dir: /x}}, password: x}"), "field password not found"},
		{"unknown tier", user("{name: a, tier: owner, login: {rolling: {dir: /x}}}"), `unknown tier "owner"`},
		{"read without databases", user("{name: a, tier: read, login: {rolling: {dir: /x}}}"), "needs a databases list"},
		{"inspect with databases", user("{name: a, tier: inspect, databases: [d], login: {rolling: {dir: /x}}}"), "takes no databases list"},
		{"system database", user("{name: a, tier: read, databases: [system], login: {rolling: {dir: /x}}}"), `database "system" cannot be granted`},
		{"injected database", user("{name: a, tier: read, databases: ['d.* TO x; --'], login: {rolling: {dir: /x}}}"), "must match"},
		{"reserved name", user("{name: default, tier: admin, login: {rolling: {dir: /x}}}"), "name is reserved"},
		{"local admin name", user("{name: local_admin, tier: admin, login: {rolling: {dir: /x}}}"), "name is reserved"},
		{"unknown mode", "mode: tokens\n", `unknown mode "tokens"`},
		{"tier-prefixed name", user("{name: tier_read, tier: read, databases: [d], login: {rolling: {dir: /x}}}"), "name is reserved"},
		{"dotted name", user("{name: a.b, tier: inspect, login: {rolling: {dir: /x}}}"), "name must match"},
		{"duplicate user", user("{name: a, tier: inspect, login: {rolling: {dir: /x}}}") + "  - {name: a, tier: inspect, login: {rolling: {dir: /y}}}\n", "duplicate user name"},
		{"bad network", user("{name: a, tier: inspect, networks: [10.0.0.0/33], login: {rolling: {dir: /x}}}"), "neither an IP address nor a CIDR"},
		{"no login", user("{name: a, tier: inspect, login: {}}"), "exactly one of rolling or token"},
		{"two logins", "issuers: [{name: s, url: 'https://i.example'}]\n" + user("{name: a, tier: inspect, login: {rolling: {dir: /x}, token: {issuer: s}}}"), "exactly one of rolling or token"},
		{"relative directory", user("{name: a, tier: inspect, login: {rolling: {dir: secrets/a}}}"), "absolute path"},
		{"unknown issuer", user("{name: a, tier: inspect, login: {token: {issuer: nobody}}}"), `issuer "nobody" is not declared`},
		{"admin token without allow_admin", "issuers: [{name: s, url: 'https://i.example'}]\n" + user("{name: a, tier: admin, login: {token: {issuer: s}}}"), "needs allow_admin"},
		{"plain http issuer", "issuers: [{name: s, url: 'http://i.example'}]\n", "must use https"},
		{"issuer with credentials", "issuers: [{name: s, url: 'https://u:p@i.example'}]\n", "no query, fragment or credentials"},
		{"duplicate issuer", "issuers: [{name: s, url: 'https://a.example'}, {name: s, url: 'https://b.example'}]\n", "duplicate issuer name"},
		{"list-valued required claim", "issuers: [{name: s, url: 'https://a.example', required_claims: {groups: [a]}}]\n", "must be a string, number or boolean"},
		{"two documents", "users: []\n---\nusers: []\n", "more than one YAML document"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			_, err := Parse([]byte(tc.file))
			if err == nil || !strings.Contains(err.Error(), tc.want) {
				t.Errorf("Parse error = %v, want it to mention %q", err, tc.want)
			}
		})
	}
}

// @scenario "Dynamic-only mode refuses every long-lived password in access.yaml"
func TestParse_DynamicOnly(t *testing.T) {
	const tokens = `issuers:
  - {name: cluster, url: 'https://oidc.example.com'}
  - {name: ci, url: 'https://token.actions.githubusercontent.com', allow_admin: true}
users:
  - {name: app, tier: write, databases: [langwatch], login: {token: {issuer: cluster, subject: 'system:serviceaccount:langwatch:app'}}}
  - {name: grafana, tier: read, databases: [langwatch], login: {token: {issuer: cluster}}}
  - {name: deployer, tier: admin, login: {token: {issuer: ci}}}
`
	t.Run("token users only is valid", func(t *testing.T) {
		f, err := Parse([]byte("mode: dynamic-only\n" + tokens))
		if err != nil {
			t.Fatalf("Parse: %v", err)
		}
		if !f.DynamicOnly() {
			t.Error("DynamicOnly() = false")
		}
	})

	t.Run("absent, the mode is standard", func(t *testing.T) {
		f, err := Parse([]byte(tokens))
		if err != nil || f.DynamicOnly() {
			t.Errorf("Parse = %v, DynamicOnly = %v; want standard mode", err, f != nil && f.DynamicOnly())
		}
	})

	// Each violation is reported on its own, naming the user.
	for _, tc := range []struct{ name, user, want string }{
		{"a rolling user", "{name: metabase, tier: read, databases: [d], login: {rolling: {dir: /secrets/metabase}}}",
			`users[3] "metabase": login.rolling is a long-lived password, refused in dynamic-only mode`},
		{"a rolling admin", "{name: ops, tier: admin, login: {rolling: {dir: /secrets/ops}}}",
			`users[3] "ops": login.rolling is a long-lived password`},
		{"the local admin's name", "{name: local_admin, tier: admin, login: {token: {issuer: ci}}}",
			`users[3] "local_admin": name is reserved`},
		{"default", "{name: default, tier: admin, login: {token: {issuer: ci}}}",
			`users[3] "default": name is reserved`},
		{"an admin token from an issuer without allow_admin", "{name: root, tier: admin, login: {token: {issuer: cluster}}}",
			"needs allow_admin"},
	} {
		t.Run("refuses "+tc.name, func(t *testing.T) {
			_, err := Parse([]byte("mode: dynamic-only\n" + tokens + "  - " + tc.user + "\n"))
			if err == nil || !strings.Contains(err.Error(), tc.want) {
				t.Errorf("Parse error = %v, want it to mention %q", err, tc.want)
			}
		})
	}

	t.Run("the same rolling user is fine in standard mode", func(t *testing.T) {
		if _, err := Parse([]byte(tokens + "  - {name: metabase, tier: read, databases: [d], login: {rolling: {dir: /secrets/metabase}}}\n")); err != nil {
			t.Errorf("Parse: %v", err)
		}
	})
}

func TestParse_AllowsLoopbackHTTPIssuer(t *testing.T) {
	if _, err := Parse([]byte("issuers: [{name: s, url: 'http://127.0.0.1:5556'}]\n")); err != nil {
		t.Errorf("loopback http issuer refused: %v", err)
	}
}

func TestLoad_ReadsTheIssuerCA(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "access.yaml")
	write := func(name, content string) string {
		p := filepath.Join(dir, name)
		if err := os.WriteFile(p, []byte(content), 0o600); err != nil {
			t.Fatal(err)
		}
		return p
	}
	write("access.yaml", "issuers: [{name: s, url: 'https://i.example', ca_file: "+filepath.Join(dir, "missing.pem")+"}]\n")
	if _, err := Load(path); err == nil || !strings.Contains(err.Error(), "ca_file") {
		t.Errorf("missing ca_file accepted: %v", err)
	}
	notPEM := write("ca.pem", "not a certificate")
	write("access.yaml", "issuers: [{name: s, url: 'https://i.example', ca_file: "+notPEM+"}]\n")
	if _, err := Load(path); err == nil || !strings.Contains(err.Error(), "no PEM certificate") {
		t.Errorf("non-PEM ca_file accepted: %v", err)
	}
}

func TestValidateListen(t *testing.T) {
	for addr, ok := range map[string]bool{
		"127.0.0.1:8124": true,
		"[::1]:8124":     true,
		"0.0.0.0:8124":   false,
		"10.0.0.5:8124":  false,
		"localhost:8124": false,
		"127.0.0.1:0":    false,
		"127.0.0.1":      false,
	} {
		if err := ValidateListen(addr); (err == nil) != ok {
			t.Errorf("ValidateListen(%q) = %v, want ok=%v", addr, err, ok)
		}
	}
}
