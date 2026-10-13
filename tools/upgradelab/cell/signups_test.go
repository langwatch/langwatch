package cell

import (
	"errors"
	"strings"
	"testing"
)

func TestJudgeSignups(t *testing.T) {
	first, second := signupResult{Email: "a", SignedUp: true}, signupResult{Email: "b", SignedUp: true}
	operator := first
	operator.Operator = true
	notLanded := second
	notLanded.SignedUp = false
	cases := []struct {
		name  string
		input signupInput
		want  string
	}{
		{"empty self-hosted: first operates, second not", signupInput{SelfHosted: true, Results: []signupResult{operator, second}}, "pass"},
		{"empty self-hosted: first refused", signupInput{SelfHosted: true, Results: []signupResult{first, second}}, "fail"},
		{"second operates", signupInput{SelfHosted: true, Results: []signupResult{operator, operator}}, "fail"},
		{"cloud never operates", signupInput{Results: []signupResult{operator, second}}, "fail"},
		{"cloud refuses both", signupInput{Results: []signupResult{first, second}}, "pass"},
		{"upgraded install with users: nobody new", signupInput{SelfHosted: true, UsersBefore: 3, Results: []signupResult{first, second}}, "pass"},
		{"upgraded install with users: first operates", signupInput{SelfHosted: true, UsersBefore: 3, Results: []signupResult{operator, second}}, "fail"},
		{"a sign-up did not land", signupInput{SelfHosted: true, Results: []signupResult{operator, notLanded}}, "fail"},
		{"user count unknown", signupInput{SelfHosted: true, UsersErr: errors.New("psql"), Results: []signupResult{operator, second}}, "inconclusive"},
	}
	for _, each := range cases {
		got := judgeSignups(each.input)
		if got.Result != each.want || got.ID != "P1" {
			t.Errorf("%s: %s %s (%s), want %s", each.name, got.ID, got.Result, got.Detail, each.want)
		}
	}
}

func TestSignupEmailsDiffer(t *testing.T) {
	if one, two := signupEmail(1, 1), signupEmail(1, 2); one == two || !strings.HasSuffix(one, "@snapshot.test") {
		t.Errorf("sign-up emails %q %q", one, two)
	}
}
