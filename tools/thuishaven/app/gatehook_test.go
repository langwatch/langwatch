package app

import (
	"strings"
	"testing"
)

type hookSettingsRecorder struct {
	roots    []string
	commands []string
}

func (r *hookSettingsRecorder) EnsureHook(root, command string) (bool, error) {
	r.roots = append(r.roots, root)
	r.commands = append(r.commands, command)
	return true, nil
}

func TestGateSetupSelectsOnlyTheRequestedAgent(t *testing.T) {
	claude := &hookSettingsRecorder{}
	codex := &hookSettingsRecorder{}
	root := t.TempDir()
	o := New(Deps{Cfg: Config{RepoRoot: root}, Claude: claude, Codex: codex})
	if _, err := o.InstallFeature("codex-gate-hook"); err != nil {
		t.Fatal(err)
	}
	if len(claude.commands) != 0 || len(codex.commands) != 1 || codex.roots[0] != root || !strings.HasSuffix(codex.commands[0], " gate --client codex") {
		t.Fatalf("wrong writer selected: claude=%+v codex=%+v", claude, codex)
	}
	if _, err := o.InstallFeature("gate-hook"); err != nil {
		t.Fatal(err)
	}
	if len(claude.commands) != 1 || len(codex.commands) != 1 || claude.commands[0] != strings.TrimSuffix(codex.commands[0], " --client codex") {
		t.Fatalf("agent clients did not receive the same gate: claude=%+v codex=%+v", claude, codex)
	}
}

func TestGateSetupRequiresAWriterAndRepository(t *testing.T) {
	for _, cfg := range []Deps{{}, {Cfg: Config{RepoRoot: t.TempDir()}}} {
		changed, err := New(cfg).InstallFeature("codex-gate-hook")
		if err == nil || changed {
			t.Fatalf("incomplete setup accepted: changed=%v err=%v", changed, err)
		}
	}
}
