package app

import (
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"

	"github.com/langwatch/langwatch/tools/thuishaven/domain"
)

// @scenario "Simulator lanes run Haven's bundled code in every checkout"
func TestSimulatorLanesUseTheHavenExecutable(t *testing.T) {
	repo := t.TempDir()
	home := t.TempDir()
	executable := filepath.Join(t.TempDir(), "haven's binary $(exit 1)")
	if err := os.Symlink("/usr/bin/printf", executable); err != nil {
		t.Fatal(err)
	}
	o := &Orchestrator{cfg: Config{Home: home, SimulatorArgv: []string{executable, "%s/%s", "simulator"}}, proxy: stubProxy{}}
	st := domain.Stack{Slug: "old-branch", Services: []domain.Service{
		{Name: "idp", Port: 45570, DNSPort: 45571, URL: "https://idp.old-branch.langwatch.localhost:1355"},
		{Name: "mail", Port: 45580, SMTPPort: 45581, URL: "https://mail.old-branch.langwatch.localhost:1355"},
	}}
	for _, watch := range []bool{false, true} {
		children := o.planChildren(st, PlanOptions{Selection: domain.DefaultSelection(), RepoRoot: repo, ShouldGoWatch: watch}, repo, "")
		for _, name := range []string{"mail", "idp"} {
			child, ok := findChild(children, name)
			if !ok {
				t.Fatalf("missing %s child with watch=%v", name, watch)
			}
			command := exec.CommandContext(t.Context(), "/bin/sh")
			command.Stdin = strings.NewReader(child.Shell)
			command.Dir = child.Dir
			command.Env = []string{"PATH=" + t.TempDir()}
			output, err := command.CombinedOutput()
			if err != nil || string(output) != "simulator/"+name {
				t.Fatalf("%s child with watch=%v: %q, %v", name, watch, output, err)
			}
			if child.LogPath != filepath.Join(home, "logs", st.Slug, name+".log") {
				t.Errorf("%s log capture is %q", name, child.LogPath)
			}
			if name == "mail" && valueOf(child.Env, "MAILSIM_DATA_DIR") != filepath.Join(home, "mail", st.Slug) {
				t.Errorf("mail lost its stack's persistent inbox")
			}
		}
	}
}
