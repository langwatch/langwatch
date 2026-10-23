// Package entrypoint tests scripts/entrypoint-wrapper.sh with stubbed
// ch-config and official entrypoint, so no ClickHouse binary is needed.
package entrypoint

import (
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
)

// runWrapper runs the wrapper with args and env, returning the environment
// and arguments the official entrypoint would have been handed.
func runWrapper(t *testing.T, initdbFiles []string, env map[string]string, args ...string) (map[string]string, string) {
	t.Helper()
	dir := t.TempDir()
	initdb := filepath.Join(dir, "initdb")
	if err := os.Mkdir(initdb, 0o755); err != nil {
		t.Fatal(err)
	}
	for _, f := range initdbFiles {
		if err := os.WriteFile(filepath.Join(initdb, f), []byte("SELECT 1;\n"), 0o644); err != nil {
			t.Fatal(err)
		}
	}
	bin := filepath.Join(dir, "bin")
	if err := os.Mkdir(bin, 0o755); err != nil {
		t.Fatal(err)
	}
	chConfig := "#!/usr/bin/env bash\nexit 0\n"
	if pw := env["TEST_BOOTSTRAP_PASSWORD"]; pw != "" {
		// Stands in for `ch-config generate` in dynamic-only mode.
		chConfig = "#!/usr/bin/env bash\nmkdir -p " + filepath.Join(dir, "bootstrap") + " && echo " + pw + " > " + filepath.Join(dir, "bootstrap", "password") + "\n"
	}
	writeExec(t, filepath.Join(bin, "ch-config"), chConfig)
	out := filepath.Join(dir, "out")
	official := filepath.Join(dir, "entrypoint.sh")
	writeExec(t, official, "#!/usr/bin/env bash\nenv > "+out+".env\necho \"$*\" > "+out+".args\n")

	src, err := os.ReadFile("../../scripts/entrypoint-wrapper.sh")
	if err != nil {
		t.Fatal(err)
	}
	script := strings.NewReplacer(
		"exec /entrypoint.sh", "exec "+official,
		"/run/clickhouse-access", filepath.Join(dir, "bootstrap"),
		"/docker-entrypoint-initdb.d", initdb,
	).Replace(string(src))
	wrapper := filepath.Join(dir, "wrapper.sh")
	writeExec(t, wrapper, script)

	cmd := exec.Command("bash", append([]string{wrapper}, args...)...)
	cmd.Env = []string{"PATH=" + bin + ":/usr/bin:/bin"}
	for k, v := range env {
		cmd.Env = append(cmd.Env, k+"="+v)
	}
	if b, err := cmd.CombinedOutput(); err != nil {
		t.Fatalf("wrapper failed: %v\n%s", err, b)
	}
	got := map[string]string{}
	raw, err := os.ReadFile(out + ".env")
	if err != nil {
		t.Fatal(err)
	}
	for _, line := range strings.Split(string(raw), "\n") {
		if k, v, ok := strings.Cut(line, "="); ok {
			got[k] = v
		}
	}
	argv, err := os.ReadFile(out + ".args")
	if err != nil {
		t.Fatal(err)
	}
	return got, strings.TrimSpace(string(argv))
}

func writeExec(t *testing.T, path, content string) {
	t.Helper()
	if err := os.WriteFile(path, []byte(content), 0o755); err != nil {
		t.Fatal(err)
	}
}

func passwordFile(t *testing.T, content string) string {
	t.Helper()
	path := filepath.Join(t.TempDir(), "password")
	if err := os.WriteFile(path, []byte(content), 0o440); err != nil {
		t.Fatal(err)
	}
	return path
}

// @scenario "Initialisation scripts and CLICKHOUSE_DB still log in as default"
func TestWrapper_InitdbGetsThePassword(t *testing.T) {
	for _, tc := range []struct {
		name   string
		initdb []string
		env    map[string]string
	}{
		{"CLICKHOUSE_DB with an env password", nil,
			map[string]string{"CLICKHOUSE_DB": "langwatch", "CLICKHOUSE_PASSWORD": "pw"}},
		{"initdb script with a password file", []string{"01-schema.sql"},
			map[string]string{"CLICKHOUSE_PASSWORD_FILE": passwordFile(t, "  file-pw \n")}},
		{"password file wins over env, as in ch-config", []string{"01-schema.sql"},
			map[string]string{"CLICKHOUSE_PASSWORD": "env-pw", "CLICKHOUSE_PASSWORD_FILE": passwordFile(t, "file-pw\n")}},
	} {
		t.Run(tc.name, func(t *testing.T) {
			env, args := runWrapper(t, tc.initdb, tc.env, "--listen_host=0.0.0.0")
			want := tc.env["CLICKHOUSE_PASSWORD"]
			if tc.env["CLICKHOUSE_PASSWORD_FILE"] != "" {
				want = "file-pw"
			}
			if env["CLICKHOUSE_PASSWORD"] != want {
				t.Errorf("CLICKHOUSE_PASSWORD = %q, want %q", env["CLICKHOUSE_PASSWORD"], want)
			}
			if _, set := env["CLICKHOUSE_PASSWORD_FILE"]; set {
				t.Error("CLICKHOUSE_PASSWORD_FILE must be unset")
			}
			if env["CLICKHOUSE_SKIP_USER_SETUP"] != "1" {
				t.Error("CLICKHOUSE_SKIP_USER_SETUP must be 1")
			}
			if !strings.HasSuffix(args, "--config-file=/etc/clickhouse-server/config.xml") {
				t.Errorf("args = %q, want the config file appended", args)
			}
		})
	}
}

// @scenario "Initialisation scripts and CLICKHOUSE_DB still log in as default"
func TestWrapper_NoPasswordWithoutInitdb(t *testing.T) {
	for _, tc := range []struct {
		name   string
		initdb []string
		env    map[string]string
		args   []string
	}{
		{"no initdb inputs", nil, map[string]string{"CLICKHOUSE_PASSWORD": "pw"}, nil},
		{"default clickhouse-server command skips initdb", []string{"01-schema.sql"},
			map[string]string{"CLICKHOUSE_PASSWORD": "pw", "CLICKHOUSE_DB": "langwatch"}, []string{"clickhouse-server"}},
	} {
		t.Run(tc.name, func(t *testing.T) {
			env, _ := runWrapper(t, tc.initdb, tc.env, tc.args...)
			if _, set := env["CLICKHOUSE_PASSWORD"]; set {
				t.Error("CLICKHOUSE_PASSWORD must be unset when the official entrypoint runs no initdb")
			}
			if env["CLICKHOUSE_SKIP_USER_SETUP"] != "1" {
				t.Error("CLICKHOUSE_SKIP_USER_SETUP must be 1")
			}
		})
	}
}

// @scenario "Initialisation scripts log in as the local admin in dynamic-only mode"
func TestWrapper_DynamicOnlyInitdbUsesTheLocalAdmin(t *testing.T) {
	pw := strings.Repeat("ab", 32)
	env, _ := runWrapper(t, []string{"01-schema.sql"}, map[string]string{"TEST_BOOTSTRAP_PASSWORD": pw}, "--listen_host=0.0.0.0")
	if env["CLICKHOUSE_USER"] != "local_admin" || env["CLICKHOUSE_PASSWORD"] != pw {
		t.Errorf("initdb runs as %q with password %q, want local_admin with this start's password", env["CLICKHOUSE_USER"], env["CLICKHOUSE_PASSWORD"])
	}

	t.Run("without initdb nothing is handed on", func(t *testing.T) {
		env, _ := runWrapper(t, nil, map[string]string{"TEST_BOOTSTRAP_PASSWORD": pw})
		if _, set := env["CLICKHOUSE_PASSWORD"]; set {
			t.Error("the local admin password reached the server's environment")
		}
		if _, set := env["CLICKHOUSE_USER"]; set {
			t.Error("CLICKHOUSE_USER set without initdb")
		}
	})
}
