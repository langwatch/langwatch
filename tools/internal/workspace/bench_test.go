package workspace

import (
	"os"
	"path/filepath"
	"testing"
)

// repoRoot is the checkout the benchmarks read, found from the test's cwd.
func repoRoot(b *testing.B) string {
	b.Helper()
	dir, _ := os.Getwd()
	for ; dir != filepath.Dir(dir); dir = filepath.Dir(dir) {
		if Exists(filepath.Join(dir, "pnpm-workspace.yaml")) {
			return dir
		}
	}
	b.Skip("no workspace above the test directory")
	return ""
}

// BenchmarkSnapshot is discovery, the resolver and the source-root listings.
func BenchmarkSnapshot(b *testing.B) {
	root := repoRoot(b)
	b.ReportAllocs()
	for b.Loop() {
		s, err := Build(root)
		if err != nil {
			b.Fatal(err)
		}
		for _, source := range SourceRoots {
			s.Files(filepath.Join(root, source))
		}
	}
}
