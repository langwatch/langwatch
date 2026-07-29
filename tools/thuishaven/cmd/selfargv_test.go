package cmd

import (
	"path/filepath"
	"strings"
	"testing"
)

// `haven play` and `haven pr` both re-invoke haven with the child's cwd set to an
// unreviewed PR checkout. That checkout is the same repository, so it contains a
// cmd/haven of its own — a relative "./cmd/haven" would compile and run the PR's
// orchestrator, which owns the docker socket, the overlay writer and teardown,
// and runs before any install-time guard could matter.
//
// @scenario "The sandbox launcher runs haven's own code, never the PR's"
func TestGoRunPackageResolvesAgainstTheTrustedRootNotTheChildsCwd(t *testing.T) {
	t.Run("given a known trusted repo root", func(t *testing.T) {
		t.Run("when building the go run package path", func(t *testing.T) {
			pkg := goRunPackage("/home/dev/langwatch")

			if !filepath.IsAbs(pkg) {
				t.Errorf("package = %q, want an absolute path so the child's cwd cannot redirect it", pkg)
			}
			if strings.HasPrefix(pkg, ".") {
				t.Errorf("package = %q, want it not to be cwd-relative", pkg)
			}
			if want := filepath.Join("/home/dev/langwatch", "cmd", "haven"); pkg != want {
				t.Errorf("package = %q, want %q", pkg, want)
			}
		})
	})

	t.Run("given a play sandbox checkout as the root", func(t *testing.T) {
		t.Run("when building the go run package path", func(t *testing.T) {
			trusted := goRunPackage("/home/dev/langwatch")
			sandbox := goRunPackage("/home/dev/.langwatch/portless/play/pr-42")

			// The two must be distinguishable: the whole defect was that both
			// collapsed to the same relative string and cwd picked the winner.
			if trusted == sandbox {
				t.Errorf("trusted and sandbox roots both resolved to %q", trusted)
			}
		})
	})

	t.Run("given no known root", func(t *testing.T) {
		t.Run("when building the go run package path", func(t *testing.T) {
			if got := goRunPackage(""); got != "./cmd/haven" {
				t.Errorf("package = %q, want the historical relative fallback", got)
			}
		})
	})
}

// A trusted child that re-derived the root from its own cwd would reintroduce the
// defect one level down — the daemon it spawns is built from the same value.
func TestChildEnvCarriesTheTrustedRootForward(t *testing.T) {
	t.Run("given a child that will run inside an untrusted checkout", func(t *testing.T) {
		t.Run("when building its environment", func(t *testing.T) {
			env := childEnvWithTrustedRoot("/home/dev/langwatch")

			if !containsEnv(env, "HAVEN_TRUSTED_REPO_ROOT=/home/dev/langwatch") {
				t.Errorf("env does not carry the trusted root forward")
			}
		})
	})
}

func containsEnv(env []string, want string) bool {
	for _, e := range env {
		if e == want {
			return true
		}
	}
	return false
}
