package accesse2e

import (
	"fmt"
	"os"
	"os/exec"
	"strings"
	"testing"
)

// @scenario "A masked setting's value never reaches a log"
func TestQueryMaskingAgainstRealClickHouse(t *testing.T) {
	image := os.Getenv("CH_ACCESS_E2E_IMAGE")
	if image == "" {
		t.Skip("CH_ACCESS_E2E_IMAGE not set; run `make e2e-access` (needs Docker)")
	}
	password := randomHex(t)
	// Trace level with text_log on, so every log would hold the query text.
	run := startGrants(t, image, password, "-e", "CLICKHOUSE_AUDIT_QUERY_LOG=true",
		"-e", "LOG_LEVEL=trace", "-e", "ENABLE_TEXT_LOG=true", "-e", "TEXT_LOG_LEVEL=trace")

	// The audit pin must leave log_query_settings to the user's own profile.
	for _, sql := range []string{
		"CREATE SETTINGS PROFILE masking_probe SETTINGS log_query_settings = 0 CONST, " +
			"custom_api_key_hash = '' CHANGEABLE_IN_READONLY, custom_control = '' CHANGEABLE_IN_READONLY",
		"CREATE USER masking_probe IDENTIFIED BY 'masking-probe-password-0123' SETTINGS PROFILE masking_probe",
		"GRANT SELECT ON system.one TO masking_probe",
	} {
		if _, err := run(sql); err != nil {
			t.Fatalf("%s: %v", sql, err)
		}
	}
	secret, control := randomHex(t), randomHex(t)
	query := fmt.Sprintf("SELECT dummy FROM system.one SETTINGS custom_api_key_hash = '%s', custom_control = '%s'", secret, control)
	if out, err := exec.Command("docker", "exec", grantsContainer, "clickhouse-client", "--user", "masking_probe",
		"--password", "masking-probe-password-0123", "--query", query).CombinedOutput(); err != nil {
		t.Fatalf("the probe query failed: %v: %s", err, out)
	}
	if _, err := run("SYSTEM FLUSH LOGS"); err != nil {
		t.Fatal(err)
	}

	// Read before any search below: ClickHouse logs each search's folded constant.
	logs, _ := exec.Command("docker", "exec", grantsContainer, "sh", "-c",
		"cat /var/log/clickhouse-server/clickhouse-server.log /var/log/clickhouse-server/clickhouse-server.err.log 2>/dev/null").CombinedOutput()
	if strings.Contains(string(logs), secret) {
		t.Error("the server log file holds the masked value")
	}
	if !strings.Contains(string(logs), control) {
		t.Error("the server log file never logged the control value, so its absence proves nothing")
	}

	// Each place holds the unmasked control value, so the secret's absence means masking.
	for _, place := range []struct{ name, sql string }{
		{"system.query_log.query", "SELECT count() FROM system.query_log WHERE position(query, reverse('%s')) > 0"},
		{"system.query_log.Settings", "SELECT count() FROM system.query_log WHERE position(toString(Settings), reverse('%s')) > 0"},
		{"system.text_log", "SELECT count() FROM system.text_log WHERE position(message, reverse('%s')) > 0"},
	} {
		got := func(value string) string {
			// Reversed, so this search's own text never holds the value it looks for.
			out, err := run(fmt.Sprintf(place.sql, reversed(value)))
			if err != nil {
				t.Fatalf("%s: %v", place.name, err)
			}
			return out
		}
		if n := got(secret); n != "0" {
			t.Errorf("%s holds the masked value in %s rows", place.name, n)
		}
		if place.name != "system.query_log.Settings" && got(control) == "0" {
			t.Errorf("%s never logged the control value, so its absence proves nothing", place.name)
		}
	}
}

func reversed(s string) string {
	r := []rune(s)
	for i, j := 0, len(r)-1; i < j; i, j = i+1, j-1 {
		r[i], r[j] = r[j], r[i]
	}
	return string(r)
}
