package diffsuite

import (
	"flag"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

var update = flag.Bool("update", false, "rewrite testdata/publish.golden.md from the render")

const publishBody = `Intro text.

<!-- parity-status:start -->
## Parity status

_old header_

**Verdict: old.**

### Coverage by area

| | area | API vs main (latest run) | UI proven against main | not tested yet or failing |
|---|---|---|---|---|
| 🟢 | Datasets | 1/1 | dataset list | exports |

### Open defects

| area | what's wrong | failing scenarios | status |
|---|---|---|---|
| Workflows | REST create answers 400 | 10 | fixing |

**Found in review, no scenario yet:** kept by hand.

### Test runs

| check | latest run | run before | usable? |
|---|---|---|---|
| API | old | older | yes |

### Next

1. Hand-kept.

<details><summary>Decisions made</summary>

- kept

</details>
<!-- parity-status:end -->

Outro.
`

// writeSuiteRun lays out one suite run as its tools leave it: summary.json, each
// tool's log, apidiff's scenarios.jsonl, fuzz's findings and two flow files.
func writeSuiteRun(t *testing.T) (string, string) {
	t.Helper()
	root := t.TempDir()
	out := filepath.Join(root, "runs", "latest")
	files := map[string]string{
		"tools/visualdiff/flows/workflows.yaml": "flows:\n  - id: workflow-create\n  - id: workflow-run\n",
		"tools/visualdiff/flows/datasets.yaml":  "flows:\n  - id: dataset-open\n",
		"runs/latest/summary.json": `{"startedAt":"2026-09-30T05:48:00Z","commit":"5ae6959","branchStack":"visualdiff-check","tools":[
			{"name":"api","exit":2},{"name":"visual","exit":1},{"name":"fuzzapi","exit":0},
			{"name":"fuzzui","exit":3,"stop":{"reason":"10 consecutive errors, most common cause: still loading (x10)","cause":"other"}}]}`,
		"runs/latest/api.log": "[05:48:13] scenarios: 3 deferred: self-hosted pass (instance-admin key unusable under SaaS): a, b, c\n" +
			"[05:48:13] scenarios: runs/latest/apidiff/scenarios.jsonl\n",
		"runs/latest/apidiff/scenarios.jsonl": `{"id":"wf-create","endpoint":"POST /api/v1/workflows","verdict":"FAIL"}
{"id":"wf-list","endpoint":"GET /api/workflows","verdict":"PASS"}
{"id":"ds-get","endpoint":"GET /api/2025-01-01/dataset/{id}","verdict":"PASS"}
{"id":"q-run","endpoint":"POST /api/query","verdict":"ERROR"}
{"id":"mystery","endpoint":"GET /api/nowhere","verdict":"PASS"}
`,
		"runs/latest/visual.log": "[05:50:00] FAIL workflow-run · step 2 click: timeout\n" +
			"[05:55:00] PASS     workflow-create (2 expects) · looks like main\n" +
			"[05:55:00] FAIL     workflow-run · step 2 click: timeout · no baseline\n" +
			"[05:55:00] PASS     dataset-open (1 expects) · no baseline\n" +
			"[05:55:00] 2/3 flows passed in 5m0s\n" +
			"[05:55:00] 10/12 routes without a finding (1 with nothing of main's to compare)\n",
		"runs/latest/fuzzapi.log": "operations exercised: 736/736 (100%)\n  21912 requests · 122 req/s · 3 findings\n" +
			"fuzz api: wrote " + filepath.Join(out, "fuzzapi-run") + "\n",
		"runs/latest/fuzzapi-run/findings.jsonl": `{"oracle":"5xx","status":502,"finding":true}
{"oracle":"5xx","status":502,"finding":true}
{"oracle":"5xx","status":500,"finding":true}
`,
		"runs/latest/fuzzui.log": "fuzz ui: wrote " + filepath.Join(out, "fuzzui-run", "plan.json") + "\n",
		"runs/latest/fuzzui-run/findings.jsonl": `{"oracle":"hang","finding":true}
{"oracle":"console-error","finding":true}
{"kind":"run-complete","total":2,"routesExercised":5,"routesTotal":130}
`,
	}
	for name, body := range files {
		path := filepath.Join(root, filepath.FromSlash(name))
		if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(path, []byte(body), 0o600); err != nil {
			t.Fatal(err)
		}
	}
	return root, out
}

func TestPublishRendersTheGoldenSection(t *testing.T) {
	root, out := writeSuiteRun(t)
	found, err := readResults(out, root)
	if err != nil {
		t.Fatal(err)
	}
	rows := found.runRows()
	before := map[string]string{"API": "2,449 pass · 70 fail · 326 tool errors"}
	got, err := splice(publishBody, found.preamble(rows, time.UTC), found.tables(rows, before))
	if err != nil {
		t.Fatal(err)
	}
	golden := filepath.Join("testdata", "publish.golden.md")
	if *update {
		if err := os.WriteFile(golden, []byte(got), 0o600); err != nil {
			t.Fatal(err)
		}
	}
	want, err := os.ReadFile(golden)
	if err != nil {
		t.Fatal(err)
	}
	if got != string(want) {
		t.Fatalf("render differs from %s (go test -run TestPublishRendersTheGoldenSection -update rewrites it):\n%s", golden, got)
	}
	for _, banned := range []string{"latest/", "r11", "1. API"} {
		if strings.Contains(got, banned) {
			t.Errorf("the view carries a run id or a numbered row: %q", banned)
		}
	}
}

func TestSpliceAddsMissingMachineSectionsAndRefusesWithoutMarkers(t *testing.T) {
	root, out := writeSuiteRun(t)
	found, _ := readResults(out, root)
	rows := found.runRows()
	body := "<!-- parity-status:start -->\n## Parity status\n\n### Next\n\n1. Hand.\n<!-- parity-status:end -->\n"
	got, err := splice(body, found.preamble(rows, time.UTC), found.tables(rows, nil))
	if err != nil {
		t.Fatal(err)
	}
	coverage, defects, runs, next := strings.Index(got, "### Coverage by area"), strings.Index(got, "### Open defects"),
		strings.Index(got, "### Test runs"), strings.Index(got, "### Next")
	if coverage < 0 || coverage > defects || defects > runs || runs > next || !strings.Contains(got, "1. Hand.") {
		t.Fatalf("sections out of order or hand text lost:\n%s", got)
	}
	if _, err := splice("no markers", nil, nil); err == nil {
		t.Fatal("a body without the section: want an error")
	}
}

func TestAreaOfSkipsVersionsAndFallsBackToOther(t *testing.T) {
	for endpoint, want := range map[string]string{
		"GET /api/v1/workflows/{id}":        "Workflows",
		"GET /api/latest/prompts":           "Prompts and playground",
		"POST /api/2025-01-01/dataset/{id}": "Datasets",
		"GET /api/nowhere":                  otherArea,
		"GET /":                             otherArea,
	} {
		if got := areaOf(endpoint); got != want {
			t.Errorf("areaOf(%q) = %q, want %q", endpoint, got, want)
		}
	}
	if got := thousands(21912); got != "21,912" {
		t.Errorf("thousands: %s", got)
	}
}
