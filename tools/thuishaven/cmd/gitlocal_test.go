package cmd

import (
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
)

// gitOut runs git in dir and returns its trimmed output, failing the test on error.
func gitOut(t *testing.T, dir string, args ...string) string {
	t.Helper()
	out, err := exec.Command("git", append([]string{"-C", dir}, args...)...).CombinedOutput() //nolint:gosec // the test passes fixed git arguments
	if err != nil {
		t.Fatalf("git %v: %v: %s", args, err, out)
	}
	return strings.TrimSpace(string(out))
}

// newRepo makes a repository with one commit on main and a linked worktree.
func newRepo(t *testing.T) (primary, linked string) {
	t.Helper()
	if _, err := exec.LookPath("git"); err != nil {
		t.Skip("git is not installed")
	}
	root, err := filepath.EvalSymlinks(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	primary = filepath.Join(root, "repo")
	if err := os.MkdirAll(filepath.Join(primary, "sub", "deeper"), 0o750); err != nil {
		t.Fatal(err)
	}
	gitOut(t, primary, "init", "-q", "-b", "main")
	gitOut(t, primary, "-c", "user.email=a@b", "-c", "user.name=a", "commit", "-q", "--allow-empty", "-m", "x")
	linked = filepath.Join(root, "linked")
	gitOut(t, primary, "worktree", "add", "-q", "-b", "feat/slash", linked)
	return primary, linked
}

func TestReadGitCheckoutMatchesGit(t *testing.T) {
	primary, linked := newRepo(t)
	for _, dir := range []string{primary, filepath.Join(primary, "sub", "deeper"), linked} {
		t.Run(dir, func(t *testing.T) {
			if got, want := gitTopLevel(dir), gitOut(t, dir, "rev-parse", "--show-toplevel"); got != want {
				t.Errorf("gitTopLevel = %q, git says %q", got, want)
			}
			if got, want := gitBranch(dir), gitOut(t, dir, "rev-parse", "--abbrev-ref", "HEAD"); got != want {
				t.Errorf("gitBranch = %q, git says %q", got, want)
			}
		})
	}
	if gitIsLinkedWorktree(primary) {
		t.Error("the primary checkout read as a linked worktree")
	}
	if !gitIsLinkedWorktree(linked) {
		t.Error("the linked worktree did not read as one")
	}
}

func TestGitBranchWhenDetached(t *testing.T) {
	primary, _ := newRepo(t)
	gitOut(t, primary, "checkout", "-q", "--detach")
	if got := gitBranch(primary); got != "HEAD" {
		t.Errorf("gitBranch on a detached HEAD = %q, want HEAD", got)
	}
}

func TestStripProfileFlags(t *testing.T) {
	args, flags := stripProfileFlags([]string{"--cpuprofile=/c", "--memprofile=/m", "--trace=/t", "gate", "--cpuprofile=/x"})
	if flags.cpu != "/c" || flags.mem != "/m" || flags.trace != "/t" {
		t.Errorf("flags = %+v, want cpu /c, mem /m and trace /t", flags)
	}
	if len(args) != 2 || args[0] != "gate" || args[1] != "--cpuprofile=/x" {
		t.Errorf("args = %q, want the command and its own flags untouched", args)
	}
}

// BenchmarkGitCheckout is what every haven command pays to learn its checkout.
func BenchmarkGitCheckout(b *testing.B) {
	cwd, err := os.Getwd()
	if err != nil {
		b.Fatal(err)
	}
	b.ReportAllocs()
	for b.Loop() {
		_ = gitTopLevel(cwd)
		_ = gitBranch(cwd)
		_ = gitIsLinkedWorktree(cwd)
	}
}
