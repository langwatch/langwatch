package app

import (
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/langwatch/langwatch/tools/thuishaven/domain"
)

// @scenario "Go bin dir missing from PATH, user accepts"
func TestAddHavenPathAppendsTheLineToTheShellConfig(t *testing.T) {
	rc := filepath.Join(t.TempDir(), ".zshrc")
	if err := os.WriteFile(rc, []byte("# the developer's own config\nalias k=kubectl\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	line := `export PATH="/go/bin:$PATH"`
	o := &Orchestrator{}

	if err := o.AddHavenPath(HavenPath{RCPath: rc, Line: line}); err != nil {
		t.Fatalf("AddHavenPath: %v", err)
	}

	after, err := os.ReadFile(rc)
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(after), line) {
		t.Errorf("the line is not in the file:\n%s", after)
	}
	// Appended, never rewritten: this is the developer's file and haven's
	// business with it begins and ends at one line.
	if !strings.Contains(string(after), "alias k=kubectl") {
		t.Errorf("the developer's own content is gone:\n%s", after)
	}
}

// The guard against a duplicate is not in the append — it is that a file
// which already carries the line is never offered again.
// @scenario "Accepting twice does not duplicate the PATH line"
func TestASecondRunSeesTheLineAndStopsOffering(t *testing.T) {
	rc := filepath.Join(t.TempDir(), ".zshrc")
	line := `export PATH="/go/bin:$PATH"`
	o := &Orchestrator{}
	if err := o.AddHavenPath(HavenPath{RCPath: rc, Line: line}); err != nil {
		t.Fatalf("AddHavenPath: %v", err)
	}

	if !rcContainsLine(rc, line) {
		t.Fatal("the line just written must be found by the next run's probe")
	}
	state := domain.PlanHavenPath(domain.HavenPathFacts{
		BinDir: "/go/bin", PathEnv: "/bin", RCPath: rc, RCHasLine: rcContainsLine(rc, line),
	})
	if state != domain.HavenPathPending {
		t.Errorf("state = %v, want pending — offering again is how a file ends up with the line twice", state)
	}
}

// @scenario "Accepting twice does not duplicate the PATH line"
func TestRCContainsLineIgnoresTrailingWhitespaceAndMissingFiles(t *testing.T) {
	dir := t.TempDir()
	rc := filepath.Join(dir, ".bashrc")
	line := `export PATH="/go/bin:$PATH"`

	if rcContainsLine(rc, line) {
		t.Error("a file that does not exist carries nothing")
	}
	if err := os.WriteFile(rc, []byte(line+"   \n"), 0o644); err != nil {
		t.Fatal(err)
	}
	if !rcContainsLine(rc, line) {
		t.Error("a trailing space is not a different line")
	}
	if rcContainsLine(rc, `export PATH="/other/bin:$PATH"`) {
		t.Error("a different directory is a different line")
	}
	if rcContainsLine("", line) {
		t.Error("no file means no line")
	}
}

// @scenario "Non-interactive install never edits the rc file"
func TestAddHavenPathRefusesWithNothingToWriteTo(t *testing.T) {
	o := &Orchestrator{}
	if err := o.AddHavenPath(HavenPath{Line: `export PATH="/go/bin:$PATH"`}); err == nil {
		t.Error("with no shell config resolved there is nothing to append to — that must be an error, not a guess")
	}
}
