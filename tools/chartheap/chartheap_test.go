package chartheap

import (
	"os"
	"os/exec"
	"path/filepath"
	"testing"
)

// helmRender renders the real chart, skipping when helm or the chart's
// dependencies are not on this machine; the chart workflow runs cmd/chartheap
// with both.
func helmRender(t *testing.T) Render {
	t.Helper()
	if _, err := exec.LookPath("helm"); err != nil {
		t.Skip("helm is not installed")
	}
	chart, err := filepath.Abs("../../charts/langwatch")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(filepath.Join(chart, "charts")); err != nil {
		t.Skip("chart dependencies are not built (helm dependency build charts/langwatch)")
	}
	return HelmRender(chart)
}

func runScenario(t *testing.T, index int) {
	t.Helper()
	if err := Checks[index].Run(helmRender(t), t.TempDir()); err != nil {
		t.Fatal(err)
	}
}

// @scenario "A worker with a memory limit gets a heap of three quarters of it"
func TestLimitGivesThreeQuarterHeap(t *testing.T) { runScenario(t, 0) }

// @scenario "With no memory limit the worker keeps Node's own heap size"
func TestNoLimitMeansNoCeiling(t *testing.T) { runScenario(t, 1) }

// @scenario "The operator's own Node options win"
func TestOperatorNodeOptionsWin(t *testing.T) { runScenario(t, 2) }

func TestNodeOptionsReadsTheDeploymentInOrder(t *testing.T) {
	manifest := `---
kind: ConfigMap
---
kind: Deployment
spec:
  template:
    spec:
      containers:
        - name: workers
          env:
            - name: OTHER
              value: x
            - name: NODE_OPTIONS
              value: first
            - name: NODE_OPTIONS
              value: second
`
	got, err := NodeOptions(manifest)
	if err != nil {
		t.Fatal(err)
	}
	if len(got) != 2 || got[0] != "first" || got[1] != "second" {
		t.Fatalf("got %q", got)
	}
}

func TestNodeOptionsRefusesAManifestWithoutADeployment(t *testing.T) {
	if _, err := NodeOptions("kind: ConfigMap\n"); err == nil {
		t.Fatal("want an error")
	}
}

func TestAssertionsRejectTheWrongValue(t *testing.T) {
	if Checks[0].Assert([]string{"--max-old-space-size-percentage=50"}) == nil {
		t.Fatal("a 50 percent ceiling passed")
	}
	if Checks[1].Assert([]string{Ceiling}) == nil {
		t.Fatal("a ceiling passed where none belongs")
	}
	if Checks[2].Assert([]string{"--max-old-space-size=3000", Ceiling}) == nil {
		t.Fatal("the chart's value passed where the operator's must win")
	}
}
