package app

import (
	"os"
	"path/filepath"
	"slices"
	"strings"
	"testing"

	"github.com/langwatch/langwatch/tools/thuishaven/domain"
)

func TestSecretsExecEnvCarriesEachKeyOnce(t *testing.T) {
	op := stubOnePassword(t)
	op.holds(t, map[string]string{"OPENAI_API_KEY": "fromitem"})
	t.Setenv(domain.OnePasswordAccountKey, "acme")
	t.Setenv("OPENAI_API_KEY", "")

	env := SecretsExecEnv(t.TempDir())
	seen := map[string]int{}
	for _, kv := range env {
		key, _, _ := strings.Cut(kv, "=")
		seen[key]++
	}
	if seen[domain.OnePasswordAccountKey] != 1 || seen["OPENAI_API_KEY"] != 1 { // the account passes through
		t.Errorf("keys repeat: account %d, OPENAI_API_KEY %d", seen[domain.OnePasswordAccountKey], seen["OPENAI_API_KEY"])
	}
	if !slices.Contains(env, "OPENAI_API_KEY=fromitem") || !slices.Contains(env, SecretsExecMarker+"=1") {
		t.Error("the exec env lacks the item's field or the marker")
	}
}

// @scenario "No 1Password value is written to disk"
func TestHavenUpUnderSecretsExecKeepsItemValuesOutOfThePlan(t *testing.T) {
	op := stubOnePassword(t)
	op.holds(t, map[string]string{"OPENAI_API_KEY": "fromitem-exec-must-not-persist"})
	t.Setenv(domain.OnePasswordAccountKey, "acme")
	t.Setenv("OPENAI_API_KEY", "")
	t.Setenv("BASE_HOST", "http://mine")

	env := SecretsExecEnv(t.TempDir()) // what `haven secrets exec -- haven up` hands haven
	path := filepath.Join(t.TempDir(), "plan.json")
	if err := writeKeeperPlan(path, KeeperPlan{Env: env}); err != nil {
		t.Fatal(err)
	}
	raw, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(string(raw), "fromitem-exec-must-not-persist") {
		t.Fatal("the keeper plan holds a value the exec took from the item")
	}
	if !strings.Contains(string(raw), "BASE_HOST=http://mine") {
		t.Error("the plan lost the shell's own env")
	}
}

// @scenario "haven env never prints a 1Password value"
func TestHavenEnvNeverPrintsAnItemValue(t *testing.T) {
	op := stubOnePassword(t)
	op.holds(t, map[string]string{"OPENAI_API_KEY": "fromitem"})
	t.Setenv("OPENAI_API_KEY", "")
	repo := checkoutWithDotenv(t, "LANGWATCH_OP_ACCOUNT=acme\n")

	for _, kv := range (&Orchestrator{}).toolEnv(domain.Stack{WorktreeDir: repo}) {
		if strings.Contains(kv, "fromitem") {
			t.Fatalf("haven env carries an item value under %s", strings.SplitN(kv, "=", 2)[0])
		}
	}
	if calls := op.calls(t); calls != nil {
		t.Errorf("haven env called op: %v", calls)
	}
}

func TestSecretsExecKeepsTheShellThenDotenvThenTheItem(t *testing.T) {
	op := stubOnePassword(t)
	op.holds(t, map[string]string{"A_TOKEN": "item", "B_TOKEN": "item", "C_TOKEN": "item"})
	t.Setenv("A_TOKEN", "shell")
	t.Setenv("B_TOKEN", "")
	t.Setenv("C_TOKEN", "")
	repo := checkoutWithDotenv(t, "LANGWATCH_OP_ACCOUNT=acme\nA_TOKEN=dotenv\nB_TOKEN=dotenv\n")

	env := SecretsExecEnv(repo)
	for _, want := range []string{"A_TOKEN=shell", "B_TOKEN=dotenv", "C_TOKEN=item", SecretsExecItemKeys + "=C_TOKEN"} {
		if !slices.Contains(env, want) {
			t.Errorf("the exec env lacks %s", strings.SplitN(want, "=", 2)[0]+" from its source")
		}
	}
}
