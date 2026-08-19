package assets

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// AgentsTemplate returns the embedded system prompt, keeping the literal
// ${LANGWATCH_ENDPOINT} placeholder the manager substitutes per worker.
func TestAgentsTemplate_CarriesPlaceholder(t *testing.T) {
	tmpl, err := AgentsTemplate()
	if err != nil {
		t.Fatalf("AgentsTemplate: %v", err)
	}
	if len(tmpl) == 0 {
		t.Fatal("AgentsTemplate is empty")
	}
	if !strings.Contains(tmpl, "${LANGWATCH_ENDPOINT}") {
		t.Error("AgentsTemplate must keep the literal ${LANGWATCH_ENDPOINT} placeholder for per-worker substitution")
	}
}

// The prompt has a byte budget so it cannot silently grow back into a rule
// pile. It once reached 52,795 bytes by accreting one rule per observed
// failure; the rewrite brought it to ~13KB of role, interface contract and
// principles. A fix that needs the ceiling raised is a fix at the wrong layer:
// fix the class of failure in one principle, in the harness config, or in the
// product, and see the Improving your Agent guide
// (https://scenario.langwatch.ai/best-practices/improving-your-agent).
//
// @scenario "The prompt fits its size budget"
func TestAgentsTemplate_FitsSizeBudget(t *testing.T) {
	const maxPromptBytes = 16 * 1024

	tmpl, err := AgentsTemplate()
	if err != nil {
		t.Fatalf("AgentsTemplate: %v", err)
	}
	if got := len(tmpl); got > maxPromptBytes {
		t.Errorf("AGENTS.md is %d bytes, over the %d-byte budget — shrink it (merge overlapping rules, state the class, or move the constraint into the harness config) instead of raising the ceiling", got, maxPromptBytes)
	}
}

// MaterializeSkills writes the embedded skills tree to disk (a subprocess cannot
// read embed.FS), preserving the <name>/SKILL.md layout opencode discovers.
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
