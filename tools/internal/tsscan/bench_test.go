package tsscan

import (
	"io/fs"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// BenchmarkScanFile scans a pinned corpus: every .ts/.tsx under modules/, read once.
func BenchmarkScanFile(b *testing.B) {
	root, _ := filepath.Abs("../../../modules")
	var corpus []string
	var names []string
	_ = filepath.WalkDir(root, func(path string, d fs.DirEntry, err error) error {
		if err != nil || (d.IsDir() && (d.Name() == "node_modules" || d.Name() == "dist")) {
			return filepath.SkipDir
		}
		if strings.HasSuffix(path, ".ts") || strings.HasSuffix(path, ".tsx") {
			names = append(names, path)
		}
		return nil
	})
	for _, path := range names {
		src, err := os.ReadFile(path)
		if err != nil {
			b.Fatal(err)
		}
		corpus = append(corpus, string(src))
	}
	if len(corpus) == 0 {
		b.Skip("no corpus")
	}
	bytes := 0
	for _, src := range corpus {
		bytes += len(src)
	}
	b.SetBytes(int64(bytes))
	b.ReportAllocs()
	for b.Loop() {
		for i, src := range corpus {
			Scan(src, JSXFor(names[i]))
		}
	}
}
