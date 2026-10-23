package access

import (
	"context"
	"errors"
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"testing"
)

func writeFile(t *testing.T, name, content string) string {
	t.Helper()
	path := filepath.Join(t.TempDir(), name)
	if err := os.WriteFile(path, []byte(content), 0o600); err != nil {
		t.Fatal(err)
	}
	return path
}

// @scenario "Dynamic-only mode refuses a users.d file with a long-lived password"
func TestStaticCredentials(t *testing.T) {
	const xmlFile = `<?xml version="1.0"?>
<clickhouse>
  <profiles><default/></profiles>
  <users>
    <grafana><password_sha256_hex>abc</password_sha256_hex><profile>default</profile></grafana>
    <legacy><password>plain</password></legacy>
    <open><no_password/></open>
    <multi><auth_methods><a><ldap><server>corp</server></ldap></a><b><password_double_sha1_hex>x</password_double_sha1_hex></b></auth_methods></multi>
    <robot><ssh_keys><ssh_key><type>ssh-ed25519</type><base64_key>AAAA</base64_key></ssh_key></ssh_keys></robot>
    <corp><ldap><server>corp</server></ldap></corp>
    <cert><ssl_certificates><common_name>svc</common_name></ssl_certificates></cert>
    <token><http_authentication><server>access</server></http_authentication></token>
    <gone remove="1"><password>x</password></gone>
    <tuned><profile>tier_read</profile></tuned>
  </users>
</clickhouse>`
	const yamlFile = `
users:
  langwatch_lwql:
    password_sha256_hex: abc
    profile: langwatch_profile
  rolled:
    auth_methods:
      first: {password_sha256_hex: a}
      second: {password_sha256_hex: b}
  gone:
    "@remove": 1
  token:
    http_authentication: {server: access, scheme: basic}
profiles:
  langwatch_profile: {readonly: 1}
`
	for _, tc := range []struct {
		name, file, content string
		allow               []string
		want                []string
	}{
		{"XML", "ops.xml", xmlFile, nil, []string{
			"user grafana logs in with password_sha256_hex",
			"user legacy logs in with password",
			"user open logs in with no_password",
			"user multi logs in with auth_methods.b.password_double_sha1_hex",
			"user robot logs in with ssh_keys",
		}},
		{"XML, allowing one user", "ops.xml", xmlFile, []string{"grafana", "legacy", "open", "robot"}, []string{
			"user multi logs in with auth_methods.b.password_double_sha1_hex",
		}},
		{"YAML", "lwql-access.yaml", yamlFile, nil, []string{
			"user langwatch_lwql logs in with password_sha256_hex",
			"user rolled logs in with auth_methods.first.password_sha256_hex",
			"user rolled logs in with auth_methods.second.password_sha256_hex",
		}},
		{"a file of profiles only", "profiles.yml", "profiles:\n  p: {readonly: 1}\n", nil, nil},
		{"the official image's users.xml, allowing default", "users.xml",
			"<clickhouse><users><default><password></password><networks><ip>::/0</ip></networks></default></users></clickhouse>",
			[]string{"default"}, nil},
	} {
		t.Run(tc.name, func(t *testing.T) {
			path := writeFile(t, tc.file, tc.content)
			got, err := StaticCredentials(path, tc.allow...)
			if err != nil {
				t.Fatalf("StaticCredentials: %v", err)
			}
			var want []string
			for _, w := range tc.want {
				want = append(want, path+": "+w)
			}
			if !reflect.DeepEqual(got, want) {
				t.Errorf("got\n  %s\nwant\n  %s", strings.Join(got, "\n  "), strings.Join(want, "\n  "))
			}
		})
	}

	t.Run("a file that does not parse is an error", func(t *testing.T) {
		if _, err := StaticCredentials(writeFile(t, "bad.xml", "<clickhouse><users>")); err == nil {
			t.Error("a truncated XML file was accepted")
		}
		if _, err := StaticCredentials(writeFile(t, "bad.yaml", "users: [")); err == nil {
			t.Error("a broken YAML file was accepted")
		}
	})
}

type fakeQuerier struct {
	out []byte
	err error
	sql string
}

func (f *fakeQuerier) Query(_ context.Context, sql string) ([]byte, error) {
	f.sql = sql
	return f.out, f.err
}

// @scenario "The sidecar reports any password login left on a dynamic-only server"
func TestPasswordLogins(t *testing.T) {
	q := &fakeQuerier{out: []byte("legacy\tlocal_directory\tsha256_password\nmixed\tlocal_directory\thttp,bcrypt_password\n")}
	got, err := PasswordLogins(context.Background(), q)
	if err != nil {
		t.Fatal(err)
	}
	want := []string{
		"user legacy (local_directory) logs in with sha256_password",
		"user mixed (local_directory) logs in with http,bcrypt_password",
	}
	if !reflect.DeepEqual(got, want) {
		t.Errorf("PasswordLogins = %v, want %v", got, want)
	}
	for _, part := range []string{"FROM system.users", "name != 'local_admin'", "'sha256_password'", "'no_password'", "host_ip"} {
		if !strings.Contains(q.sql, part) {
			t.Errorf("the query lacks %q", part)
		}
	}

	t.Run("none left", func(t *testing.T) {
		got, err := PasswordLogins(context.Background(), &fakeQuerier{out: []byte("\n")})
		if err != nil || len(got) != 0 {
			t.Errorf("PasswordLogins = %v, %v; want none", got, err)
		}
	})
	t.Run("the server's error is returned", func(t *testing.T) {
		if _, err := PasswordLogins(context.Background(), &fakeQuerier{err: errors.New("down")}); err == nil {
			t.Error("want an error")
		}
	})
}
