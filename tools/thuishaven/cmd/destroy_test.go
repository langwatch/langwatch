package cmd

import (
	"strings"
	"testing"
)

// The ceremony is the whole safety of `haven destroy`: a person answers a
// prompt, a script passes --yes, and an agent gets the flag or nothing.
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
	}{
		{name: "a person answering yes proceeds", slug: "apidiff-run1-branch", answer: "y\n", proceed: true},
		{name: "a person answering nothing aborts", slug: "apidiff-run1-branch", answer: "\n", wantSaid: "aborted"},
		{name: "a person answering no aborts", slug: "apidiff-run1-branch", answer: "n\n", wantSaid: "aborted"},
		{name: "--yes proceeds without a prompt", slug: "apidiff-run1-branch", yes: true, proceed: true},
		{name: "an agent without --yes is refused", slug: "apidiff-run1-branch", isAgent: true, wantErr: true},
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
			if proceed != testCase.proceed {
				t.Errorf("proceed = %v, want %v", proceed, testCase.proceed)
			}
			if testCase.wantSaid != "" && !strings.Contains(out.String(), testCase.wantSaid) {
				t.Errorf("output %q must say %q", out.String(), testCase.wantSaid)
			}
		})
	}
}

// destroy is dispatchable and declares exactly the flag its ceremony reads.
func TestDestroyIsOnTheCommandTable(t *testing.T) {
	var spec commandSpec
	for _, candidate := range table {
		if candidate.name == "destroy" {
			spec = candidate
		}
	}
	if spec.name == "" {
		t.Fatal("destroy must be on the command table, or nothing documents or dispatches it")
	}
	if spec.maxArgs != 1 || spec.args == "" {
		t.Errorf("destroy takes exactly one positional slug, got args=%q maxArgs=%d", spec.args, spec.maxArgs)
	}
	if !strings.Contains(strings.ToLower(spec.summary), "drop") {
		t.Errorf("destroy's summary %q must disclose that the databases go", spec.summary)
	}
	if _, err := parse(spec, []string{"apidiff-run1-branch", "--yes"}); err != nil {
		t.Errorf("destroy must accept a slug and --yes: %v", err)
	}
	if _, err := parse(spec, []string{"apidiff-run1-branch", "--force"}); err == nil {
		t.Error("destroy must not accept an undeclared flag")
	}
}
