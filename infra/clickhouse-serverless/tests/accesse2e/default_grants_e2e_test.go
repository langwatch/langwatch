package accesse2e

import (
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

const grantsContainer = "ch-e2e-default-grants"

// The collections a rendered LangWatchQL model delivers, plus one it does not.
const grantsCollections = `named_collections:
  lwql_postgres: {host: 127.0.0.1, port: 5432, database: x, user: u, password: p}
  lwql_postgres_db_under_test: {host: 127.0.0.1, port: 5432, database: x, user: u, password: p}
  other_collection: {host: 127.0.0.1, port: 5432, database: x, user: u, password: p}
`

// @scenario "A real ClickHouse gives the default user access DDL only in sql mode"
func TestDefaultUserGrantsAgainstRealClickHouse(t *testing.T) {
	image := os.Getenv("CH_ACCESS_E2E_IMAGE")
	if image == "" {
		t.Skip("CH_ACCESS_E2E_IMAGE not set; run `make e2e-access` (needs Docker)")
	}
	password := randomHex(t)
	lwqlDir := t.TempDir()
	for name, body := range map[string]string{
		"lwql-access.yaml":           "users: {}\n",
		"lwql-named-collection.yaml": grantsCollections,
	} {
		if err := os.WriteFile(filepath.Join(lwqlDir, name), []byte(body), 0o644); err != nil {
			t.Fatal(err)
		}
	}
	if err := os.Chmod(lwqlDir, 0o755); err != nil {
		t.Fatal(err)
	}

	engine := func(collection string) string {
		return fmt.Sprintf("CREATE TABLE t_%s (a Int32) ENGINE = PostgreSQL(%s, table = 't')", collection, collection)
	}
	const createUser = "CREATE USER grants_probe IDENTIFIED WITH no_password"
	const createCollection = "CREATE NAMED COLLECTION grants_probe AS host = 'h'"

	t.Run("rendered mode uses only the LangWatchQL collections and runs no access DDL", func(t *testing.T) {
		run := startGrants(t, image, password, "-v", lwqlDir+":/etc/clickhouse-server/lwql:ro")
		for _, ok := range []string{engine("lwql_postgres"), engine("lwql_postgres_db_under_test")} {
			if _, err := run(ok); err != nil {
				t.Errorf("%s: %v", ok, err)
			}
		}
		for _, refused := range []string{engine("other_collection"), createUser, createCollection,
			"ALTER NAMED COLLECTION lwql_postgres SET host = 'h'"} {
			if _, err := run(refused); err == nil || !strings.Contains(err.Error(), "ACCESS_DENIED") {
				t.Errorf("%s was not refused: %v", refused, err)
			}
		}
		listed, err := run("SELECT arrayStringConcat(arraySort(groupArray(name)), ',') FROM system.named_collections")
		if err != nil || listed != "lwql_postgres,lwql_postgres_db_under_test" {
			t.Errorf("default lists %q, %v; want only the LangWatchQL collections", listed, err)
		}
	})

	t.Run("sql mode creates users and named collections", func(t *testing.T) {
		run := startGrants(t, image, password)
		for _, ok := range []string{createUser, createCollection} {
			if _, err := run(ok); err != nil {
				t.Errorf("%s: %v", ok, err)
			}
		}
	})

	t.Run("opting out takes the stock users.xml grants away", func(t *testing.T) {
		run := startGrants(t, image, password, "-e", "DEFAULT_USER_ACCESS_MANAGEMENT=false")
		for _, refused := range []string{createUser, createCollection} {
			if _, err := run(refused); err == nil || !strings.Contains(err.Error(), "ACCESS_DENIED") {
				t.Errorf("%s was not refused: %v", refused, err)
			}
		}
	})
}

// startGrants starts the image with extra docker args and returns a runner for
// SQL as default over the native protocol inside the container.
func startGrants(t *testing.T, image, password string, extra ...string) func(sql string) (string, error) {
	t.Helper()
	_ = exec.Command("docker", "rm", "-f", grantsContainer).Run()
	args := append([]string{"run", "-d", "--name", grantsContainer,
		"-e", "CH_CPU=2", "-e", "CH_RAM=2147483648", "-e", "CLICKHOUSE_PASSWORD=" + password}, extra...)
	if out, err := exec.Command("docker", append(args, image)...).CombinedOutput(); err != nil {
		t.Fatalf("docker run: %v\n%s", err, out)
	}
	t.Cleanup(func() {
		if t.Failed() {
			logs, _ := exec.Command("docker", "logs", "--tail", "80", grantsContainer).CombinedOutput()
			t.Logf("container logs:\n%s", logs)
		}
		_ = exec.Command("docker", "rm", "-f", grantsContainer).Run()
	})
	run := func(sql string) (string, error) {
		out, err := exec.Command("docker", "exec", grantsContainer, "clickhouse-client",
			"--password", password, "--query", sql).CombinedOutput()
		if err != nil {
			return "", fmt.Errorf("%v: %s", err, strings.TrimSpace(string(out)))
		}
		return strings.TrimSpace(string(out)), nil
	}
	deadline := time.Now().Add(90 * time.Second)
	for {
		if _, err := run("SELECT 1"); err == nil {
			return run
		}
		if time.Now().After(deadline) {
			t.Fatal("ClickHouse did not start")
		}
		time.Sleep(time.Second)
	}
}
