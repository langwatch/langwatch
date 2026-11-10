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
	secret, control, settingsControl := randomHex(t), randomHex(t), randomHex(t)
	asProbe := []string{"--user", "masking_probe", "--password", "masking-probe-password-0123"}
	// Every spelling the reviews found, over the native protocol, then over HTTP.
	for _, form := range []string{
		"SETTINGS custom_api_key_hash = '%[1]s', custom_control = '%[2]s'",
		"SETTINGS `custom_api_key_hash` = '%[1]s', custom_control = '%[2]s'",
		"SETTINGS custom_api_key_hash/**/= 'x\\'%[1]s', custom_control = '%[2]s'",
		"SETTINGS custom_api_key_hash = 'x''%[1]s', custom_control = '%[2]s'",
		"SETTINGS custom_api_key_hash = $$%[1]s$$, custom_control = '%[2]s'",
	} {
		query := "SELECT dummy FROM system.one " + fmt.Sprintf(form, secret, control)
		args := append(append([]string{"exec", grantsContainer, "clickhouse-client"}, asProbe...), "--query", query)
		if out, err := exec.Command("docker", args...).CombinedOutput(); err != nil {
			t.Fatalf("the probe query %q failed: %v: %s", form, err, out)
		}
	}
	for _, url := range []string{
		"http://127.0.0.1:8123/?custom_api_key_hash=" + secret + "&custom_control=" + control + "&query=SELECT+1",
		"http://127.0.0.1:8123/?query=SELECT+1+SETTINGS+custom_api_key_hash%20%3D%20%27" + secret + "%27%2C+custom_control%3D%27" + control + "%27",
	} {
		if out, err := exec.Command("docker", "exec", grantsContainer, "curl", "-sf", "-u", "masking_probe:masking-probe-password-0123", url).CombinedOutput(); err != nil {
			t.Fatalf("HTTP probe failed: %v: %s", err, out)
		}
	}
	// A sha256-shaped value folded into a filter, as the query condition cache logs it.
	hash := (randomHex(t) + randomHex(t))[:64]
	folded := fmt.Sprintf("SELECT count() FROM system.one WHERE has(['%s', '%s'], toString(dummy))", hash, control)
	if out, err := exec.Command("docker", append(append([]string{"exec", grantsContainer, "clickhouse-client"}, asProbe...), "--query", folded)...).CombinedOutput(); err != nil {
		t.Fatalf("the folded probe failed: %v: %s", err, out)
	}
	// Proves the Settings column is recorded at all: default keeps log_query_settings on.
	if _, err := run(fmt.Sprintf("SELECT 1 SETTINGS custom_control = '%s'", settingsControl)); err != nil {
		t.Fatal(err)
	}
	if _, err := run("SYSTEM FLUSH LOGS"); err != nil {
		t.Fatal(err)
	}

	// Read before any search below: ClickHouse logs each search's folded constant.
	logs, _ := exec.Command("docker", "exec", grantsContainer, "sh", "-c",
		"cat /var/log/clickhouse-server/clickhouse-server.log /var/log/clickhouse-server/clickhouse-server.err.log 2>/dev/null").CombinedOutput()
	for _, hidden := range []string{secret, hash} {
		if strings.Contains(string(logs), hidden) {
			t.Errorf("the server log file holds the masked value %s", hidden[:8])
		}
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
		for _, hidden := range []string{secret, hash} {
			if n := got(hidden); n != "0" {
				t.Errorf("%s holds the masked value %s in %s rows", place.name, hidden[:8], n)
			}
		}
		want := control
		if place.name == "system.query_log.Settings" {
			want = settingsControl
		}
		if got(want) == "0" {
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
