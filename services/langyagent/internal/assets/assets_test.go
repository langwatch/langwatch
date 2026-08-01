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
