package cmd

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// @scenario "A browser lane's actions are recorded as a script and replayed"
func TestBrowserRecordVerbs(t *testing.T) {
	inv, _ := parse(browserSpec(), []string{"record", "start", "--lane", "a"})
	verb, inv, err := recordVerb(inv)
	if err != nil || verb != "record-start" {
		t.Fatalf("verb = %q (%v)", verb, err)
	}
	req, err := browserRequest(verb, inv)
	if err != nil || req["lane"] != "a" {
		t.Errorf("req = %v (%v)", req, err)
	}
	inv, _ = parse(browserSpec(), []string{"record", "stop", "--lane", "a", "--out", "x.json"})
	verb, inv, _ = recordVerb(inv)
	req, err = browserRequest(verb, inv)
	if err != nil || !strings.HasSuffix(req["out"].(string), "x.json") {
		t.Errorf("record stop req = %v (%v)", req, err)
	}
	inv, _ = parse(browserSpec(), []string{"record", "pause", "--lane", "a"})
	if _, _, err := recordVerb(inv); err == nil {
		t.Error("record pause was accepted")
	}
	inv, _ = parse(browserSpec(), []string{"replay", "s.json", "--lane", "a"})
	if req, err := browserRequest("replay", inv); err != nil || req["file"] == nil {
		t.Errorf("replay req = %v (%v)", req, err)
	}
}

// @scenario "A recorded script exports as a Playwright test in the repo's e2e style"
func TestExportScriptWritesAPlaywrightTest(t *testing.T) {
	dir := t.TempDir()
	script := filepath.Join(dir, "s.json")
	out := filepath.Join(dir, "flow.spec.ts")
	body := `{"version":1,"startUrl":"/p","steps":[
	 {"verb":"click","locator":{"by":"role","value":"button","name":"Save","nth":1},"expect":{"url":"/p","queries":[{"method":"POST","path":"trpc:a.b","status":200}]}},
	 {"verb":"fill","locator":{"by":"label","value":"Key"},"text":"<redacted>","expect":{"url":"/p","queries":[]}},
	 {"verb":"select","locator":{"by":"role","value":"combobox","name":"Plan"},"text":"Team","expect":{"url":"/p","queries":[]}}]}`
	if err := os.WriteFile(script, []byte(body), 0o600); err != nil {
		t.Fatal(err)
	}
	inv, _ := parse(browserSpec(), []string{"record", "export", script, "--playwright", out})
	if _, inv, err := recordVerb(inv); err != nil {
		t.Fatal(err)
	} else if err := exportScript(inv); err != nil {
		t.Fatal(err)
	}
	got, _ := os.ReadFile(out)
	for _, want := range []string{
		`import { expect, test } from "../test.ts";`,
		`page.goto("/p")`,
		`page.getByRole("button", { name: "Save", exact: true }).nth(1).click()`,
		`page.getByLabel("Key", { exact: true }).fill("<redacted>")`,
		`getByRole("option", { name: "Team", exact: true }).click()`,
		`.toBe("/p")`,
	} {
		if !strings.Contains(string(got), want) {
			t.Errorf("export lacks %s:\n%s", want, got)
		}
	}
}

func TestPrintReplayFailsOnADivergence(t *testing.T) {
	if err := printReplay(map[string]any{"ok": true, "steps": 2.0}, true); err != nil {
		t.Error(err)
	}
	div := map[string]any{"step": 2.0, "action": "click Save", "expected": "url /a", "got": "url /b"}
	err := printReplay(map[string]any{"ok": false, "divergence": div}, true)
	if err == nil || !strings.Contains(err.Error(), "step 2") || !strings.Contains(err.Error(), "url /b") {
		t.Errorf("err = %v", err)
	}
}
