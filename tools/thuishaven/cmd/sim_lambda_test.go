package cmd

import (
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/langwatch/langwatch/tools/thuishaven/cmd/viewer/sources"
)

// @scenario "An agent drives lambdasim from the terminal"
func TestLambdaCommandsReadAndSetTheSim(t *testing.T) {
	api, seen := stubSim(t, map[string]string{
		"GET /_sim/api/info":     `{"stack":"s","target":"http://127.0.0.1:45562","capacity":500,"functions":["langwatch_nlp-p1"],"settings":{"forcedError":""}}`,
		"GET /_sim/api/calls":    `{"calls":[{"id":"1","function":"langwatch_nlp-p1","mode":"stream","method":"POST","path":"/studio/execute","status":200}]}`,
		"GET /_sim/api/calls/1":  `{"id":"1","request":"{}"}`,
		"DELETE /_sim/api/calls": ``,
	})
	run := func(args ...string) string {
		return captureStdout(t, func() {
			if err := lambdaCommand(api, simInv(args...), false); err != nil {
				t.Fatal(err)
			}
		})
	}
	if out := run("info"); !strings.Contains(out, "nlpgo: http://127.0.0.1:45562") || !strings.Contains(out, "langwatch_nlp-p1") {
		t.Fatalf("info printed %q", out)
	}
	if out := run("calls"); !strings.Contains(out, "/studio/execute") || !strings.Contains(out, "stream") {
		t.Fatalf("calls printed %q", out)
	}
	if out := run("call", "1"); !strings.Contains(out, `"request"`) {
		t.Fatalf("call printed %q", out)
	}
	run("clear")
	if last := (*seen)[len(*seen)-1]; last != "DELETE /_sim/api/calls?" {
		t.Fatalf("clear sent %q", last)
	}
	if err := lambdaCommand(api, simInv("nope"), false); err == nil {
		t.Fatal("an unknown subcommand was accepted")
	}
}

func TestLambdaSetSendsTheForcedError(t *testing.T) {
	var body string
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		raw, _ := io.ReadAll(r.Body)
		body = string(raw)
		_, _ = w.Write(raw)
	}))
	t.Cleanup(srv.Close)
	for kind, want := range map[string]string{"throttled": `"throttled"`, "none": `""`} {
		inv := simInv("set")
		inv.flags = map[string]string{"--error": kind}
		captureStdout(t, func() {
			if err := lambdaCommand(sources.NewSimAPIAt(srv.URL), inv, false); err != nil {
				t.Fatal(err)
			}
		})
		if !strings.Contains(body, `"forcedError":`+want) {
			t.Fatalf("set --error %s sent %s", kind, body)
		}
	}
}
