package assets

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// The prompt used to name the worker's own endpoint, as an example of an
// address the user must never be given. The manager substitutes that
// placeholder per worker at spawn, so the sentence warning against worker-side
// hosts arrived carrying one, and the agent read a real internal address in the
// one paragraph telling it not to repeat internal addresses. The rule survives;
// the example does not.
//
// @scenario "The system prompt names no address the user cannot reach"
func TestAgentsTemplate_NamesNoWorkerSideAddress(t *testing.T) {
	tmpl, err := AgentsTemplate()
	if err != nil {
		t.Fatalf("AgentsTemplate: %v", err)
	}
	if len(tmpl) == 0 {
		t.Fatal("AgentsTemplate is empty")
	}
	for _, banned := range []string{
		"${LANGWATCH_ENDPOINT}",
		"LANGWATCH_ENDPOINT",
		"localhost",
		"127.0.0.1",
	} {
		if strings.Contains(tmpl, banned) {
			t.Errorf("AGENTS.md names %q; the prompt reaches the user through the reply, so it must not carry an address or variable only the worker can use", banned)
		}
	}
}

// Counting is a normal thing to want, and the prompt told the agent to "get the
// total first with the cheapest count query" without ever saying what that was.
// So the agent guessed, twice: a filter the output did not answer and a flag
// the command did not take, then a Python one-liner whose traceback reached the
// user. The rule now names the flags.
//
// @scenario "The prompt says how to count"
func TestAgentsTemplate_SaysHowToCount(t *testing.T) {
	tmpl, err := AgentsTemplate()
	if err != nil {
		t.Fatalf("AgentsTemplate: %v", err)
	}
	for _, named := range []string{"--jq length", ".pagination.total"} {
		if !strings.Contains(tmpl, named) {
			t.Errorf("AGENTS.md tells the agent to get a total but never names %q, which is what leaves it guessing at a count", named)
		}
	}
}

// The prompt has a byte budget so it cannot silently grow back into a rule
// pile. It once reached 52,795 bytes by accreting one rule per observed
// failure. A fix that needs the ceiling raised is a fix at the wrong layer:
// state the class in one principle, or move the constraint into the harness
// config. See https://scenario.langwatch.ai/best-practices/improving-your-agent
//
// @scenario "The prompt fits its size budget"
func TestAgentsTemplate_FitsSizeBudget(t *testing.T) {
	const maxPromptBytes = 16 * 1024

	tmpl, err := AgentsTemplate()
	if err != nil {
		t.Fatalf("AgentsTemplate: %v", err)
	}
	// Reported on every run, not only on failure: a passing "under 16KB" says
	// nothing about which prompt is embedded, so it cannot confirm a rebuild
	// picked up an edit. The number can.
	t.Logf("AGENTS.md is %d bytes of the %d-byte budget", len(tmpl), maxPromptBytes)

	if got := len(tmpl); got > maxPromptBytes {
		t.Errorf("AGENTS.md is %d bytes, over the %d-byte budget: shrink it (merge overlapping rules, state the class, or move the constraint into the harness config) instead of raising the ceiling", got, maxPromptBytes)
	}
}

// MaterializeSkills writes the embedded skills tree to disk (a subprocess cannot
// read embed.FS), preserving the <name>/SKILL.md layout the worker discovers.
func TestMaterializeSkills_WritesTreeToDisk(t *testing.T) {
	dest := t.TempDir()
	if err := MaterializeSkills(dest); err != nil {
		t.Fatalf("MaterializeSkills: %v", err)
	}
	// The checked-in dev set includes the langy-only github skill.
	skill := filepath.Join(dest, "github", "SKILL.md")
	info, err := os.Stat(skill)
	if err != nil {
		t.Fatalf("expected %s materialized on disk: %v", skill, err)
	}
	if info.IsDir() || info.Size() == 0 {
		t.Errorf("%s is not a non-empty file", skill)
	}
}
