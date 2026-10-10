package cmd

import (
	"strings"
	"testing"
)

// The ceremony is the whole safety of `haven down --destroy`: a person types
// the slug, a script passes --yes, and an agent gets the flag or nothing.
//
// @scenario "In a terminal only the typed slug destroys"
// @scenario "An agent without --yes is refused"
func TestConfirmDestroy(t *testing.T) {
	cases := []struct {
		name     string
		slug     string
		yes      bool
		isAgent  bool
		answer   string
		proceed  bool
		wantErr  bool
		wantSaid string
		wantCode int
	}{
		{name: "a person typing the slug proceeds", slug: "apidiff-run1-branch", answer: "apidiff-run1-branch\n", proceed: true},
		{name: "a person answering y aborts: only the slug counts", slug: "apidiff-run1-branch", answer: "y\n", wantSaid: "aborted"},
		{name: "a person answering nothing aborts", slug: "apidiff-run1-branch", answer: "\n", wantSaid: "aborted"},
		{name: "a person answering no aborts", slug: "apidiff-run1-branch", answer: "n\n", wantSaid: "aborted"},
		{name: "--yes proceeds without a prompt", slug: "apidiff-run1-branch", yes: true, proceed: true},
		{name: "an agent without --yes is refused", slug: "apidiff-run1-branch", isAgent: true, wantErr: true, wantCode: exitUsage},
		{name: "an agent with --yes proceeds", slug: "apidiff-run1-branch", isAgent: true, yes: true, proceed: true},
		{name: "the shared main database is refused even with --yes", slug: "main", yes: true, wantErr: true},
		{name: "the shared main database is refused for an agent", slug: "main", isAgent: true, yes: true, wantErr: true},
	}
	for _, testCase := range cases {
		t.Run(testCase.name, func(t *testing.T) {
			out := &strings.Builder{}
			proceed, err := confirmDestroy(destroyConfirm{
				slug:    testCase.slug,
				db:      "lw_" + strings.ReplaceAll(testCase.slug, "-", "_"),
				isAgent: testCase.isAgent,
				yes:     testCase.yes,
				in:      strings.NewReader(testCase.answer),
				out:     out,
			})
			if (err != nil) != testCase.wantErr {
				t.Fatalf("err = %v, wantErr %v", err, testCase.wantErr)
			}
			if testCase.wantCode != 0 && ExitCode(err) != testCase.wantCode {
				t.Errorf("exit code = %d, want %d", ExitCode(err), testCase.wantCode)
			}
			if proceed != testCase.proceed {
				t.Errorf("proceed = %v, want %v", proceed, testCase.proceed)
			}
			if testCase.wantSaid != "" && !strings.Contains(out.String(), testCase.wantSaid) {
				t.Errorf("output %q must say %q", out.String(), testCase.wantSaid)
			}
		})
	}
}

// down declares the destroy ceremony's flags, and says the data goes.
func TestDownDeclaresDestroy(t *testing.T) {
	spec := specByName(t, "down")
	if !strings.Contains(strings.ToLower(spec.summary), "drop") {
		t.Errorf("down's summary %q must disclose that --destroy drops the databases", spec.summary)
	}
	if _, err := parse(spec, []string{"--destroy", "--yes"}); err != nil {
		t.Errorf("down must accept --destroy --yes: %v", err)
	}
	if _, err := parse(spec, []string{"apidiff-run1-branch"}); err == nil {
		t.Error("down takes no positional: the stack is named with --stack")
	}
}
