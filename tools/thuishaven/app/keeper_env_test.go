package app

import (
	"encoding/json"
	"os"
	"os/exec"
	"path/filepath"
	"slices"
	"testing"
)

const (
	envHelperPlan = "HAVEN_ENVTEST_PLAN"
	envHelperOut  = "HAVEN_ENVTEST_OUT"
)

// TestApplyPlanEnvHelper is the keeper process of the tests below: it applies
// the plan it is handed and writes the environment it ends up with.
func TestApplyPlanEnvHelper(t *testing.T) {
	raw, out := os.Getenv(envHelperPlan), os.Getenv(envHelperOut)
	if raw == "" || out == "" {
		t.Skip("helper process for TestKeeperEnvironmentComesFromTheUpCaller")
	}
	var plan KeeperPlan
	if err := json.Unmarshal([]byte(raw), &plan); err != nil {
		t.Fatal(err)
	}
	ApplyPlanEnv(plan)
	data, _ := json.Marshal(os.Environ())
	if err := os.WriteFile(out, data, 0o600); err != nil {
		t.Fatal(err)
	}
}

// keeperEnv runs a keeper helper started by a daemon whose environment is
// daemonEnv, handed planEnv, and returns the environment it ended up with.
func keeperEnv(t *testing.T, daemonEnv, planEnv []string) []string {
	t.Helper()
	raw, _ := json.Marshal(KeeperPlan{Env: planEnv})
	out := filepath.Join(t.TempDir(), "env.json")
	cmd := exec.Command(os.Args[0], "-test.run=^TestApplyPlanEnvHelper$")
	cmd.Env = append(slices.Clone(daemonEnv), envHelperPlan+"="+string(raw), envHelperOut+"="+out)
	if b, err := cmd.CombinedOutput(); err != nil {
		t.Fatalf("keeper helper: %v\n%s", err, b)
	}
	data, err := os.ReadFile(out)
	if err != nil {
		t.Fatal(err)
	}
	var env []string
	if err := json.Unmarshal(data, &env); err != nil {
		t.Fatal(err)
	}
	return env
}

// @scenario "A stack's environment is the one haven up was run with, not the daemon's"
func TestKeeperEnvironmentComesFromTheUpCaller(t *testing.T) {
	daemon := []string{"PATH=" + os.Getenv("PATH"), "HOME=/daemon-home", "IS_SAAS=false", "LANGWATCH_LICENSE_KEY=daemon-key"}

	withKey := keeperEnv(t, daemon, []string{"PATH=/up/bin", "LANGWATCH_LICENSE_KEY=caller-key", "RUM_ENABLED=false"})
	for _, want := range []string{"LANGWATCH_LICENSE_KEY=caller-key", "RUM_ENABLED=false", "PATH=/up/bin"} {
		if !slices.Contains(withKey, want) {
			t.Errorf("an exported key must reach the keeper: missing %s", want)
		}
	}
	if slices.Contains(withKey, "LANGWATCH_LICENSE_KEY=daemon-key") || slices.Contains(withKey, "IS_SAAS=false") {
		t.Errorf("the daemon's own variables leaked into a stack whose up set them differently: %v", withKey)
	}

	other := keeperEnv(t, daemon, []string{"PATH=/up/bin"})
	for _, leaked := range []string{"IS_SAAS=false", "LANGWATCH_LICENSE_KEY=daemon-key", "LANGWATCH_LICENSE_KEY=caller-key", "RUM_ENABLED=false"} {
		if slices.Contains(other, leaked) {
			t.Errorf("another stack's keeper must not see %s", leaked)
		}
	}
	if !slices.Contains(other, "HOME=/daemon-home") {
		t.Errorf("a basic the up did not carry (HOME) is kept so the lanes can run: %v", other)
	}
}
