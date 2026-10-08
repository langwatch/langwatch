package domain

import (
	"strings"
	"testing"
)

// @scenario "A Mac with nothing stated runs ClickHouse natively"
// @scenario "A stated container runtime keeps the container"
// @scenario "Other systems keep the container by default"
// @scenario "Native stated where no binary is pinned is refused"
func TestResolveClickHouseRuntime(t *testing.T) {
	cases := []struct {
		stated, goos, goarch string
		want                 ClickHouseRuntime
		wantErr              bool
	}{
		{"", "darwin", "arm64", ClickHouseRuntimeNative, false},
		{"", "darwin", "amd64", ClickHouseRuntimeNative, false},
		{"container", "darwin", "arm64", ClickHouseRuntimeContainer, false},
		{"Docker", "darwin", "arm64", ClickHouseRuntimeContainer, false},
		{"", "linux", "amd64", ClickHouseRuntimeContainer, false},
		{"native", "darwin", "arm64", ClickHouseRuntimeNative, false},
		{"native", "linux", "amd64", ClickHouseRuntimeContainer, true},
		{"vm", "darwin", "arm64", ClickHouseRuntimeContainer, true},
	}
	for _, c := range cases {
		got, err := ResolveClickHouseRuntime(c.stated, c.goos, c.goarch)
		if got != c.want || (err != nil) != c.wantErr {
			t.Errorf("ResolveClickHouseRuntime(%q, %s/%s) = %q, %v; want %q, err=%v", c.stated, c.goos, c.goarch, got, err, c.want, c.wantErr)
		}
	}
}

// @scenario "Each supported Mac CPU has one pinned download with its digest"
func TestClickHouseNativeArtifactFor(t *testing.T) {
	for arch, asset := range map[string]string{"arm64": "/clickhouse-macos-aarch64", "amd64": "/clickhouse-macos"} {
		a, ok := ClickHouseNativeArtifactFor("darwin", arch)
		if !ok || !strings.HasSuffix(a.URL, asset) || !strings.Contains(a.URL, "/v"+ClickHouseNativeVersion+"-lts/") {
			t.Errorf("darwin/%s: got %+v, %v", arch, a, ok)
		}
		if len(a.SHA256) != 64 || strings.Trim(a.SHA256, "0123456789abcdef") != "" {
			t.Errorf("darwin/%s: digest %q is not a lowercase sha256", arch, a.SHA256)
		}
	}
	if _, ok := ClickHouseNativeArtifactFor("linux", "amd64"); ok {
		t.Error("linux/amd64 must have no pinned native binary")
	}
}

// @scenario "The native server listens on loopback only, in haven's home"
// @scenario "The native server keeps the container's access rules and timezone"
func TestRenderClickHouseNativeServerConfig(t *testing.T) {
	got := RenderClickHouseNativeServerConfig("/h/clickhouse-native/", 18123)
	for _, want := range []string{
		"<listen_host>127.0.0.1</listen_host>",
		"<http_port>18123</http_port>",
		"<path>/h/clickhouse-native/data/</path>",
		"<tmp_path>/h/clickhouse-native/data/tmp/</tmp_path>",
		"<local_directory><path>/h/clickhouse-native/data/access/</path></local_directory>",
		"<users_xml><path>/h/clickhouse-native/users.xml</path></users_xml>",
		"<log>/h/clickhouse-native/log/clickhouse-server.log</log>",
		"<select_from_system_db_requires_grant>true</select_from_system_db_requires_grant>",
		"<timezone>UTC</timezone>",
	} {
		if !strings.Contains(got, want) {
			t.Errorf("native config missing %s", want)
		}
	}
	for _, port := range []string{"<tcp_port>", "<mysql_port>", "<postgresql_port>", "<interserver_http_port>", "0.0.0.0", "::<"} {
		if strings.Contains(got, port) {
			t.Errorf("native config must not contain %s", port)
		}
	}
}

// @scenario "The native default user has the container's local credentials"
func TestRenderClickHouseNativeUsersConfig(t *testing.T) {
	got := RenderClickHouseNativeUsersConfig()
	for _, want := range []string{"<password>" + ClickHousePassword + "</password>", "<ip>127.0.0.1</ip>", "<ip>::1</ip>"} {
		if !strings.Contains(got, want) {
			t.Errorf("users config missing %s", want)
		}
	}
}

// @scenario "A native ClickHouse reaches Postgres on 127.0.0.1"
// @scenario "A stack provisioned in colima keeps the VM's host route"
func TestLWQLPostgresHostFollowsRuntime(t *testing.T) {
	native := Stack{ClickHousePostgresHost: ClickHouseRuntimeNative.PostgresHost()}
	if got := native.LWQLPostgresHost(); got != "127.0.0.1" {
		t.Errorf("native stack: got %q", got)
	}
	if got := (Stack{}).LWQLPostgresHost(); got != ColimaHostAddress {
		t.Errorf("legacy stack: got %q", got)
	}
	if got := ClickHouseRuntimeContainer.PostgresHost(); got != ColimaHostAddress {
		t.Errorf("container runtime: got %q", got)
	}
}
