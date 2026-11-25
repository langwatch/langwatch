package chartnumbers

import (
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
)

func helmRender(t *testing.T) Render {
	t.Helper()
	if _, err := exec.LookPath("helm"); err != nil {
		t.Skip("helm is not installed")
	}
	chart, err := filepath.Abs("../../charts/langyagent")
	if err != nil {
		t.Fatal(err)
	}
	return HelmRender(chart)
}

func TestTheChartRendersNumbersAsDigits(t *testing.T) {
	render := helmRender(t)
	for _, check := range Checks {
		t.Run(check.Name, func(t *testing.T) {
			if err := check.Run(render, t.TempDir()); err != nil {
				t.Fatal(err)
			}
		})
	}
}

func TestVerifyNamesScientificNotation(t *testing.T) {
	err := Verify(`LANGY_WORKER_MAX_AGE_MS: "1.8e+07"`, []string{`LANGY_WORKER_MAX_AGE_MS: "18000000"`})
	if err == nil {
		t.Fatal("want an error for a number in scientific notation")
	}
	for _, part := range []string{`missing LANGY_WORKER_MAX_AGE_MS: "18000000"`, `scientific notation "1.8e+07"`} {
		if !strings.Contains(err.Error(), part) {
			t.Errorf("error %q does not name %q", err, part)
		}
	}
}

func TestVerifyPassesAnIndentedLine(t *testing.T) {
	if err := Verify("data:\n  LANGY_WORKER_MAX_AGE_MS: \"18000000\"\n", []string{`LANGY_WORKER_MAX_AGE_MS: "18000000"`}); err != nil {
		t.Fatal(err)
	}
}

func TestVerifyRefusesAKeyThatOnlyEndsTheSame(t *testing.T) {
	manifest := "data:\n  OTHER_LANGY_WORKER_MAX_AGE_MS: \"18000000\"\n"
	if err := Verify(manifest, []string{`LANGY_WORKER_MAX_AGE_MS: "18000000"`}); err == nil {
		t.Fatal("a prefixed key must not satisfy the wanted line")
	}
}

func TestRunWritesTheValuesFile(t *testing.T) {
	var got []string
	render := func(files ...string) (string, error) {
		got = files
		return `LANGY_WORKER_MAX_AGE_MS: "18000000"`, nil
	}
	check := Check{Values: "manager: {}\n", Want: []string{`LANGY_WORKER_MAX_AGE_MS: "18000000"`}}
	if err := check.Run(render, t.TempDir()); err != nil {
		t.Fatal(err)
	}
	if len(got) != 1 || !strings.HasSuffix(got[0], "values.yaml") {
		t.Fatalf("render got files %v, want one values.yaml", got)
	}
}
