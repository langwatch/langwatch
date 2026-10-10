package cell

import (
	"strings"
	"testing"
)

func TestJudgeSSO(t *testing.T) {
	main := []SSOResult{{Phase: "main", Check: "signin", OK: true}}
	head := []SSOResult{{Phase: "head", Check: "cookie", OK: true}, {Phase: "head", Check: "signin", OK: true}}
	if got := judgeSSO(main, head, 0); got.Result != "pass" {
		t.Errorf("all checks passed, got %s: %s", got.Result, got.Detail)
	}
	if got := judgeSSO(main, head, 2); got.Result != "inconclusive" {
		t.Errorf("ledger outstanding, got %s", got.Result)
	}
	refused := []SSOResult{head[0], {Phase: "head", Member: "member@acme1.test", Check: "signin", URL: "/auth/error", Detail: "ended on /auth/error"}}
	if got := judgeSSO(main, refused, 0); got.Result != "fail" || !strings.Contains(got.Detail, "/auth/error") {
		t.Errorf("a refused head sign-in must fail with the page, got %s: %s", got.Result, got.Detail)
	}
	if got := judgeSSO(main, head[1:], 0); got.Result != "fail" || !strings.Contains(got.Detail, "head/cookie: never ran") {
		t.Errorf("a missing cookie check must fail, got %s: %s", got.Result, got.Detail)
	}
}
