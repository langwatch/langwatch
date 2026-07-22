package app

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func writeLangyFixture(t *testing.T) string {
	t.Helper()
	root := t.TempDir()
	dockerfile := "FROM node:20 AS deps\n" +
		"COPY package.json pnpm-lock.yaml ./\n" +
		"COPY services/langyagent services/langyagent\n" +
		"COPY --from=deps /app/node_modules ./node_modules\n"
	if err := os.WriteFile(filepath.Join(root, langyDockerfile), []byte(dockerfile), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := os.MkdirAll(filepath.Join(root, "services", "langyagent"), 0o755); err != nil {
		t.Fatal(err)
	}
	for _, f := range []string{"package.json", "pnpm-lock.yaml", "services/langyagent/main.go"} {
		if err := os.WriteFile(filepath.Join(root, f), []byte("v1"), 0o644); err != nil {
			t.Fatal(err)
		}
	}
	return root
}

// @scenario "The langy image is reused when its inputs are unchanged"
// @scenario "The langy image rebuilds only when its inputs change"
func TestLangyImageTagIsContentAddressed(t *testing.T) {
	root := writeLangyFixture(t)

	first, err := langyImageTag(root)
	if err != nil {
		t.Fatalf("langyImageTag: %v", err)
	}
	if !strings.HasPrefix(first, "langyagent:dev-") {
		t.Fatalf("tag = %q, want the langyagent:dev-<hash> shape", first)
	}

	t.Run("when nothing changed, the tag is stable", func(t *testing.T) {
		again, err := langyImageTag(root)
		if err != nil {
			t.Fatalf("langyImageTag: %v", err)
		}
		if again != first {
			t.Errorf("tag changed with no input change: %q vs %q", again, first)
		}
	})

	t.Run("when a copied source changes, the tag changes", func(t *testing.T) {
		target := filepath.Join(root, "services", "langyagent", "main.go")
		if err := os.WriteFile(target, []byte("v2 — longer"), 0o644); err != nil {
			t.Fatal(err)
		}
		// Belt and braces on coarse-mtime filesystems: the size change above is
		// already enough, but nudge the mtime explicitly too.
		_ = os.Chtimes(target, time.Now().Add(2*time.Second), time.Now().Add(2*time.Second))
		changed, err := langyImageTag(root)
		if err != nil {
			t.Fatalf("langyImageTag: %v", err)
		}
		if changed == first {
			t.Error("a source edit must change the tag")
		}
	})
}

func TestDockerfileCopySourcesSkipsStageCopies(t *testing.T) {
	srcs := dockerfileCopySources("COPY a b ./\nCOPY --from=build /x /y\nCOPY --chown=1:1 c ./c\n")
	joined := strings.Join(srcs, " ")
	if joined != "a b c" {
		t.Errorf("sources = %q, want %q (stage copies skipped, flags stripped)", joined, "a b c")
	}
}

// @scenario "A published prebuilt image is pulled instead of built"
func TestLangyImageEnsureShellPrefersLocalThenPullThenBuild(t *testing.T) {
	sh := langyImageEnsureShell("langyagent:dev-abc123", false, "ghcr.io/langwatch/langyagent:dev-abc123")
	inspect := strings.Index(sh, "docker image inspect")
	pull := strings.Index(sh, "docker pull")
	build := strings.Index(sh, "docker build")
	if inspect == -1 || pull == -1 || build == -1 || !(inspect < pull && pull < build) {
		t.Errorf("shell = %q, want inspect || pull || build in that order", sh)
	}
}

// @scenario "Rebuilding on demand is one flag"
func TestLangyImageEnsureShellForceSkipsStraightToBuild(t *testing.T) {
	sh := langyImageEnsureShell("langyagent:dev-abc123", true, "ghcr.io/langwatch/langyagent:dev-abc123")
	if strings.Contains(sh, "inspect") || strings.Contains(sh, "pull") {
		t.Errorf("forced rebuild must not consult local images or the registry, got %q", sh)
	}
}
