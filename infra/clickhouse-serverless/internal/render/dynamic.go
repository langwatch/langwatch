package render

import (
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strings"

	"github.com/langwatch/langwatch/infra/clickhouse-serverless/internal/access"
	"github.com/langwatch/langwatch/infra/clickhouse-serverless/internal/bootstrap"
	"github.com/langwatch/langwatch/infra/clickhouse-serverless/internal/config"
)

const dynamicOnlyFile = "access-dynamic-only.yaml"

// renderLocalAdmin generates this start's local admin password into the
// bootstrap tmpfs, then renders the user with only its hash (ADR-190).
func renderLocalAdmin(input *config.Input, usersD string) error {
	cred, err := bootstrap.Generate(input.AccessBootstrapDir)
	if err != nil {
		return fmt.Errorf("%s: %w", input.AccessBootstrapDir, err)
	}
	data, err := bootstrap.UsersYAML(cred)
	if err != nil {
		return err
	}
	return os.WriteFile(filepath.Join(usersD, bootstrap.UsersFileName), data, 0o600)
}

// refusedSQLPassword never matches, so CREATE or ALTER USER with a password
// is refused. A pre-hashed password skips ClickHouse's complexity check; the
// sidecar's audit reports those.
const refusedSQLPassword = `[^\s\S]`

// renderDynamicOnlyServer turns off the passwordless and plaintext login
// types server-wide and refuses new SQL passwords.
func renderDynamicOnlyServer(configD string) error {
	return writeYAML(filepath.Join(configD, dynamicOnlyFile), map[string]any{
		"allow_no_password":        0,
		"allow_plaintext_password": 0,
		"password_complexity": map[string]any{
			"rule": map[string]string{
				"pattern": refusedSQLPassword,
				"message": "be absent: this server is in dynamic-only mode, give the user a token login (ADR-190)",
			},
		},
	})
}

// imageUsersFiles are the users.d files ch-config itself renders.
var imageUsersFiles = map[string]bool{
	"profiles.yaml":         true,
	"default-password.yaml": true,
	accessManagementFile:    true,
	tiersFile:               true,
	access.UsersFileName:    true,
	bootstrap.UsersFileName: true,
}

// refuseStaticCredentials fails when any users file the server merges, other
// than the image's own, gives a user a long-lived password. The official
// image's users.xml defines default, which renderDefaultPassword locks.
func refuseStaticCredentials(outputDir string) error {
	var found []string
	scan := func(path string, allow ...string) error {
		f, err := access.StaticCredentials(path, allow...)
		found = append(found, f...)
		return err
	}
	if _, err := os.Stat(filepath.Join(outputDir, "users.xml")); err == nil {
		if err := scan(filepath.Join(outputDir, "users.xml"), "default"); err != nil {
			return err
		}
	}
	for _, dir := range []string{"users.d", "conf.d"} {
		entries, err := os.ReadDir(filepath.Join(outputDir, dir))
		if os.IsNotExist(err) {
			continue
		}
		if err != nil {
			return err
		}
		for _, e := range entries {
			name := e.Name()
			switch strings.ToLower(filepath.Ext(name)) {
			case ".xml", ".conf", ".yaml", ".yml":
			default:
				continue
			}
			if strings.HasPrefix(name, ".") || (dir == "users.d" && imageUsersFiles[name]) {
				continue
			}
			if err := scan(filepath.Join(outputDir, dir, name)); err != nil {
				return err
			}
		}
	}
	if len(found) == 0 {
		return nil
	}
	sort.Strings(found)
	return fmt.Errorf("dynamic-only mode (access.yaml) refuses long-lived passwords; "+
		"move these users to token logins in access.yaml or remove the files:\n  - %s", strings.Join(found, "\n  - "))
}
