package cmd

import (
	"encoding/json"
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

// @scenario "A browser lane's actions are recorded as a script and replayed"
func TestBrowserHoverDragAndSnapshotFlags(t *testing.T) {
	inv, _ := parse(browserSpec(), []string{"drag", "e1", "e2", "--lane", "a"})
	req, err := browserRequest("drag", inv)
	if err != nil || req["targetRef"] != "e2" {
		t.Fatalf("drag req = %v (%v)", req, err)
	}
	inv, _ = parse(browserSpec(), []string{"drag", "e1", "--by", "120,-40", "--lane", "a"})
	req, err = browserRequest("drag", inv)
	if by, _ := req["by"].(map[string]any); err != nil || by["dx"] != 120 || by["dy"] != -40 {
		t.Errorf("drag --by req = %v (%v)", req, err)
	}
	inv, _ = parse(browserSpec(), []string{"drag", "e1", "--lane", "a"})
	if _, err := browserRequest("drag", inv); err == nil {
		t.Error("drag with neither target nor --by was accepted")
	}
	inv, _ = parse(browserSpec(), []string{"hover", "e1", "--lane", "a"})
	if _, err := browserRequest("hover", inv); err != nil {
		t.Error(err)
	}
	inv, _ = parse(browserSpec(), []string{"upload", "e1", "/etc/hosts", "--lane", "a"})
	if _, err := browserRequest("upload", inv); err == nil || !strings.Contains(err.Error(), ".claude/tmp") {
		t.Errorf("upload outside .claude/tmp: %v", err)
	}
	inv, _ = parse(browserSpec(), []string{"upload", "e1", "--lane", "a"})
	if _, err := browserRequest("upload", inv); err == nil {
		t.Error("upload without a file was accepted")
	}
	inv, _ = parse(browserSpec(), []string{"snapshot", "--grep", "Save", "--depth", "3", "--max-chars", "2000", "--lane", "a"})
	req, err = browserRequest("snapshot", inv)
	if err != nil || req["grep"] != "Save" || req["depth"] != 3 || req["maxChars"] != 2000 {
		t.Errorf("snapshot req = %v (%v)", req, err)
	}
	inv, _ = parse(browserSpec(), []string{"snapshot", "--depth", "x", "--lane", "a"})
	if _, err := browserRequest("snapshot", inv); err == nil {
		t.Error("--depth x was accepted")
	}
}

func TestExportScriptHoverAndDrag(t *testing.T) {
	var script recordedScript
	body := `{"version":1,"steps":[
	 {"verb":"hover","locator":{"by":"text","value":"Toast"},"expect":{"url":"/p","queries":[]}},
	 {"verb":"drag","locator":{"by":"css","value":".h1"},"target":{"by":"css","value":".h2"},"expect":{"url":"/p","queries":[]}},
	 {"verb":"drag","locator":{"by":"css","value":".h1"},"by":{"dx":10,"dy":-5},"expect":{"url":"/p","queries":[]}}]}`
	if err := json.Unmarshal([]byte(body), &script); err != nil {
		t.Fatal(err)
	}
	got := playwrightTest(script)
	for _, want := range []string{`.hover();`, `page.locator(".h2").boundingBox()`, `from.x + from.width / 2 + 10, from.y + from.height / 2 + -5`} {
		if !strings.Contains(got, want) {
			t.Errorf("export lacks %s:\n%s", want, got)
		}
	}
}
