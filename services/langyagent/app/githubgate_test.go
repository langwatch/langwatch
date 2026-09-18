package app

import (
	"encoding/json"
	"testing"

	"github.com/langwatch/langwatch/services/langyagent/internal/frames"
)

func toolEndFrame(t *testing.T, command string, isError bool, output string) frames.Frame {
	t.Helper()
	input, err := json.Marshal(map[string]string{"command": command})
	if err != nil {
		t.Fatal(err)
	}
	f, err := frames.ToolEnd("call-1", "bash", input, isError, output, 0)
	if err != nil {
		t.Fatal(err)
	}
	return f
}

func toolStartFrameFor(t *testing.T, command string) frames.Frame {
	t.Helper()
	input, err := json.Marshal(map[string]string{"command": command})
	if err != nil {
		t.Fatal(err)
	}
	f, err := frames.ToolStart("call-1", "bash", "", "", input)
	if err != nil {
		t.Fatal(err)
	}
	return f
}

// A settled GitHub-reaching command on a turn with NO credential trips the gate
// with the vetted not-connected code and cancels the stream — that is the
// entire promise the worker skill and the client connect card are built on.
func TestGithubGate_NoCredential(t *testing.T) {
	t.Run("when a settled tool command reaches for GitHub", func(t *testing.T) {
		cancelled := false
		gate := newGithubGate(false, func() { cancelled = true })

		gate.Observe(toolEndFrame(t, "gh repo clone acme/service-x -- --depth 1", true,
			"gh: To use GitHub CLI in automation, set GH_TOKEN"))

		message, code, tripped := gate.Tripped()
		if !tripped {
			t.Fatal("gate must trip on a GitHub-reaching command without a credential")
		}
		if code != "langy_github_not_connected" {
			t.Errorf("code = %q, want langy_github_not_connected", code)
		}
		if message == "" {
			t.Error("tripped gate must carry a message")
		}
		if !cancelled {
			t.Error("trip must cancel the stream")
		}
	})

	t.Run("when network git is buried in a compound command", func(t *testing.T) {
		gate := newGithubGate(false, func() {})
		gate.Observe(toolEndFrame(t, "git add -A && git push -u origin HEAD", true, "auth failed"))
		if _, _, tripped := gate.Tripped(); !tripped {
			t.Error("compound command hiding a push must trip")
		}
	})

	t.Run("when the command is only local git", func(t *testing.T) {
		gate := newGithubGate(false, func() {})
		gate.Observe(toolEndFrame(t, "git add -A && git commit -m 'msg'", false, ""))
		if _, _, tripped := gate.Tripped(); tripped {
			t.Error("local-only git must NOT trip — a turn that only commits locally is fine")
		}
	})

	t.Run("when the frame is a tool start, not a settle", func(t *testing.T) {
		gate := newGithubGate(false, func() {})
		gate.Observe(toolStartFrameFor(t, "gh repo clone acme/service-x"))
		if _, _, tripped := gate.Tripped(); tripped {
			t.Error("only SETTLED commands trip the gate")
		}
	})

	t.Run("when the frame is not a tool frame", func(t *testing.T) {
		gate := newGithubGate(false, func() {})
		f, err := frames.Delta("let me run gh repo clone for you")
		if err != nil {
			t.Fatal(err)
		}
		gate.Observe(f)
		if _, _, tripped := gate.Tripped(); tripped {
			t.Error("prose mentioning gh must never trip — the gate reads commands, not text")
		}
	})
}

// With a credential present the gate stays quiet for ordinary GitHub work, and
// only classifies a FAILED call whose output says the repo isn't reachable.
func TestGithubGate_WithCredential(t *testing.T) {
	t.Run("when the GitHub command succeeds", func(t *testing.T) {
		gate := newGithubGate(true, func() {})
		gate.Observe(toolEndFrame(t, "gh repo clone acme/service-x", false, "Cloned."))
		if _, _, tripped := gate.Tripped(); tripped {
			t.Error("a credentialed, successful call must not trip")
		}
	})

	t.Run("when the clone 404s on a repo outside the installation", func(t *testing.T) {
		cancelled := false
		gate := newGithubGate(true, func() { cancelled = true })
		gate.Observe(toolEndFrame(t, "gh repo clone acme/other-repo", true,
			"GraphQL: Could not resolve to a Repository with the name 'acme/other-repo'."))

		_, code, tripped := gate.Tripped()
		if !tripped {
			t.Fatal("a credentialed 404 on a GitHub-reaching command must trip")
		}
		if code != "langy_github_repo_not_accessible" {
			t.Errorf("code = %q, want langy_github_repo_not_accessible", code)
		}
		if !cancelled {
			t.Error("trip must cancel the stream")
		}
	})

	t.Run("when a GitHub command fails for an unrelated reason", func(t *testing.T) {
		gate := newGithubGate(true, func() {})
		gate.Observe(toolEndFrame(t, "git push -u origin HEAD", true,
			"error: failed to push some refs (non-fast-forward)"))
		if _, _, tripped := gate.Tripped(); tripped {
			t.Error("a non-404 failure is the agent's problem to handle, not a gate trip")
		}
	})
}

// The gate trips at most once — the first trip wins and later frames are ignored.
func TestGithubGate_TripsOnce(t *testing.T) {
	cancels := 0
	gate := newGithubGate(false, func() { cancels++ })
	gate.Observe(toolEndFrame(t, "gh pr create --fill", true, "no token"))
	gate.Observe(toolEndFrame(t, "gh pr list", true, "no token"))
	if cancels != 1 {
		t.Errorf("cancel called %d times, want exactly 1", cancels)
	}
}

// The command grammar mirrors githubCommand.ts — pin the load-bearing shapes.
func TestCommandNeedsGithubAuth(t *testing.T) {
	needs := []string{
		"gh repo clone acme/x",
		"gh pr create --title t --body b",
		"gh api user --jq .id",
		"GH_USER_ID=$(gh api user --jq .id)",
		"git clone https://github.com/acme/x.git",
		"git push -u origin HEAD",
		"git fetch origin",
		"git pull",
		"git ls-remote origin",
		`git -C "$HOME/work/x" push`,
		"git -c core.pager=cat fetch origin",
		"cd repo; gh pr create --fill",
		"gh pr list | head -5",
		"cd repo\ngit push",
		"GIT_TERMINAL_PROMPT=0 git push",
	}
	for _, cmd := range needs {
		if !commandNeedsGithubAuth(cmd) {
			t.Errorf("commandNeedsGithubAuth(%q) = false, want true", cmd)
		}
	}
	noNeed := []string{
		"git add -A",
		"git commit -m 'fix'",
		"git checkout -b langy/fix",
		"git config --global user.name bot",
		"git status",
		"ls -la",
		"echo gh is a cli", // `gh` must be argv0, not a word in prose args
		"",
		"   ",
	}
	for _, cmd := range noNeed {
		if commandNeedsGithubAuth(cmd) {
			t.Errorf("commandNeedsGithubAuth(%q) = true, want false", cmd)
		}
	}
}
