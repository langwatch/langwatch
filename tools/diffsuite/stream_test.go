package diffsuite

import (
	"bytes"
	"os"
	"strings"
	"testing"
)

func TestResultsStreamDedupeAndSummarise(t *testing.T) {
	api, visual, fuzz := &tool{name: "api"}, &tool{name: "visual"}, &tool{name: "fuzzui"}
	var streamed []string
	feed := func(tool *tool, text string) {
		if line := tool.result(text); line != "" {
			streamed = append(streamed, "["+tool.name+"] "+line)
		}
	}
	feed(api, "[07:22:27] scenarios 149/2693 · 146 pass 3 fail · 1.9/s · ~22m45s left")
	feed(api, "FAIL-branch  orders-list  (GET /api/orders, orders.yaml)")
	feed(api, "  first failing step: step 2 answered 500")
	feed(api, "ERROR       sso-login  (POST /api/sso/login, sso.yaml)")
	feed(api, "scenarios: 2693 run: 2690 PASS, 2 FAIL-branch, 1 ERROR")
	feed(visual, "[07:21:42] FAIL sign-in · step 0 signIn: passkey offer: no passkey offer")
	feed(visual, "FAIL     sign-in · step 0 signIn: passkey offer · looks like main")
	feed(visual, "UNPROVEN gateway-budget-detail-page · no expect held")
	feed(visual, "ROUTE    /[project]/workflows · hang · request pending")
	feed(visual, "225/228 flows passed in 12m0s")
	feed(fuzz, "fuzz ui: wrote /tmp/.fuzz/20260930-072027/plan.json")

	want := []string{
		"[api] first failing step: step 2 answered 500",
		"[visual] UNPROVEN gateway-budget-detail-page · no expect held",
		"[visual] ROUTE    /[project]/workflows · hang · request pending",
	}
	if strings.Join(streamed, "\n") != strings.Join(want, "\n") {
		t.Fatalf("streamed %q", streamed)
	}
	if got := api.results; got.pass != 2690 || got.fail != 2 || got.errs != 1 || len(got.failing) != 2 {
		t.Fatalf("api %+v", got)
	}
	if got := visual.results; got.pass != 225 || got.fail != 3 || len(got.failing) != 3 {
		t.Fatalf("visual %+v (sign-in must count once)", got)
	}
	if fuzz.results.dir != "/tmp/.fuzz/20260930-072027" {
		t.Fatal(fuzz.results.dir)
	}

	hang := `{"oracle":"hang","finding":true,"route":"/ops","signature":"hang :: request /ops","message":"request pending https://x/api/trpc/organization.getAll"}`
	other := `{"oracle":"console","finding":true,"route":"/[project]/workflows","signature":"console :: /[project]/workflows","message":"boom","status":500}`
	done := `{"kind":"run-complete","routesExercised":1,"routesTotal":108}`
	lines := fuzz.results.absorb([]byte(strings.Join([]string{hang, done, other, hang}, "\n") + "\n"))
	if len(lines) != 2 || !strings.HasPrefix(lines[0], "FINDING #1 hang /ops: ") || !strings.HasPrefix(lines[1], "FINDING #2 console /[project]/workflows status 500: boom") {
		t.Fatalf("findings %q", lines)
	}
	if again := fuzz.results.absorb([]byte(hang + "\n")); len(again) != 0 {
		t.Fatalf("a repeat streamed: %q", again)
	}

	report := summaryReport([]*tool{api, visual, fuzz})
	for _, part := range []string{
		"[api] pass 2690 fail 2 error 1 distinct findings 0",
		"failing /orders (1): FAIL-branch orders-list",
		"failing /sso (1): ERROR sso-login",
		"[visual] pass 225 fail 3 error 0",
		"failing sign (1): FAIL sign-in",
		"[fuzzui] pass 0 fail 0 error 0 distinct findings 2",
		"finding /ops (1): hang /ops",
	} {
		if !strings.Contains(report, part) {
			t.Fatalf("report lacks %q:\n%s", part, report)
		}
	}
}

func TestSummaryReportCapsLinesPerTool(t *testing.T) {
	api := &tool{name: "api"}
	for index := range 80 {
		api.results.failing = append(api.results.failing, item{"FAIL id", "/group" + strings.Repeat("x", index)})
	}
	report := summaryReport([]*tool{api})
	if lines := strings.Count(report, "\n"); lines > reportLines+2 {
		t.Fatalf("%d lines", lines)
	}
	if !strings.Contains(report, "more failing in api.log") {
		t.Fatal(report)
	}
}

func TestReadNewKeepsPartialLineForNextRead(t *testing.T) {
	path := t.TempDir() + "/findings.jsonl"
	var buffer bytes.Buffer
	buffer.WriteString("one\ntw")
	writeFile(t, path, buffer.Bytes())
	chunk, offset := readNew(path, 0)
	if string(chunk) != "one\n" || offset != 4 {
		t.Fatalf("%q %d", chunk, offset)
	}
	writeFile(t, path, []byte("one\ntwo\n"))
	if chunk, _ = readNew(path, offset); string(chunk) != "two\n" {
		t.Fatalf("%q", chunk)
	}
}

func writeFile(t *testing.T, path string, body []byte) {
	t.Helper()
	if err := os.WriteFile(path, body, 0o644); err != nil {
		t.Fatal(err)
	}
}
