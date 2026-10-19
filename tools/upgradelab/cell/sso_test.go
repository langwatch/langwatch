package cell

import (
	"strings"
	"testing"
)

func TestJudgeSSO(t *testing.T) {
	passed := []SSOResult{
		{Phase: "main", Door: "deployment", Check: "signin", OK: true},
		{Phase: "head", Door: "deployment", Check: "cookie", OK: true},
		{Phase: "head", Door: "deployment", Check: "signin", OK: true},
		{Phase: "main", Door: "connection", Check: "signin", OK: true},
		{Phase: "head", Door: "connection", Check: "cookie", OK: true},
		{Phase: "head", Door: "connection", Check: "signin", OK: true},
	}
	if got := judgeSSO("E6", "deployment", passed, 0); got.Result != "pass" {
		t.Errorf("all deployment checks passed, got %s: %s", got.Result, got.Detail)
	}
	if got := judgeSSO("E7", "connection", passed, 0); got.Result != "fail" || !strings.Contains(got.Detail, "head/setup: never ran") {
		t.Errorf("a connection needs head's setup read, got %s: %s", got.Result, got.Detail)
	}
	active := append(append([]SSOResult{}, passed...), SSOResult{Phase: "head", Door: "connection", Check: "setup", OK: true})
	if got := judgeSSO("E7", "connection", active, 0); got.Result != "pass" {
		t.Errorf("all connection checks passed, got %s: %s", got.Result, got.Detail)
	}
	if got := judgeSSO("E6", "deployment", passed, 2); got.Result != "inconclusive" {
		t.Errorf("ledger outstanding, got %s", got.Result)
	}
	refused := append(append([]SSOResult{}, passed...), SSOResult{Phase: "head", Door: "deployment", Member: "member@acme1.test", Check: "signin", URL: "/auth/error", Detail: "ended on /auth/error"})
	if got := judgeSSO("E6", "deployment", refused, 0); got.Result != "fail" || !strings.Contains(got.Detail, "/auth/error") {
		t.Errorf("a refused head sign-in must fail with the page, got %s: %s", got.Result, got.Detail)
	}
	if got := judgeSSO("E7", "connection", passed[:3], 0); got.Result != "fail" {
		t.Errorf("another door's results never pass this one, got %s: %s", got.Result, got.Detail)
	}
}
