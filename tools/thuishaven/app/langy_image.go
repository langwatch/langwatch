// Content-addressed langy images (ADR-064): the image tag is derived from a
// hash of its build inputs — the Dockerfile plus every file under its COPY
// sources — so `up` reuses the image byte-for-byte when nothing changed,
// rebuilds exactly when something did, and can pull a CI-published build for
// the same inputs instead of building locally. This replaces the old
// HAVEN_LANGY_REBUILD default of rebuilding on every up.
package app

import (
	"crypto/sha256"
	"fmt"
	"io/fs"
	"os"
	"path/filepath"
	"sort"
	"strings"
)

// langyDockerfile is the build definition, relative to the repo root.
const langyDockerfile = "Dockerfile.langyagent"

// langyImageTag derives the content-addressed tag for the langy worker image:
// langyagent:dev-<12 hex chars>. The hash covers the Dockerfile bytes and, for
// every file under its COPY sources, the path, size, and mtime — mtime rather
// than content so the walk stays sub-second on big trees; a false-positive
// rebuild (touch without change) only costs docker's own layer cache a pass.
func langyImageTag(repoRoot string) (string, error) {
	dockerfile := filepath.Join(repoRoot, langyDockerfile)
	b, err := os.ReadFile(dockerfile)
	if err != nil {
		return "", fmt.Errorf("reading %s: %w", langyDockerfile, err)
	}
	h := sha256.New()
	h.Write(b)
	for _, src := range dockerfileCopySources(string(b)) {
		if err := hashPath(h, repoRoot, src); err != nil {
			return "", fmt.Errorf("hashing build input %q: %w", src, err)
		}
	}
	return fmt.Sprintf("langyagent:dev-%x", h.Sum(nil)[:6]), nil
}

// dockerfileCopySources extracts the repo-relative COPY sources from a
// Dockerfile, skipping stage copies (--from=…) — those reference build stages,
// not the working tree.
func dockerfileCopySources(dockerfile string) []string {
	var out []string
	seen := map[string]bool{}
	for _, line := range strings.Split(dockerfile, "\n") {
		fields := strings.Fields(strings.TrimSpace(line))
		if len(fields) < 3 || !strings.EqualFold(fields[0], "COPY") {
			continue
		}
		args := fields[1:]
		fromStage := false
		for len(args) > 0 && strings.HasPrefix(args[0], "--") {
			if strings.HasPrefix(args[0], "--from=") {
				fromStage = true
			}
			args = args[1:]
		}
		if fromStage || len(args) < 2 {
			continue
		}
		for _, src := range args[:len(args)-1] {
			if !seen[src] {
				seen[src] = true
				out = append(out, src)
			}
		}
	}
	sort.Strings(out)
	return out
}

// hashPath folds one COPY source (file or directory tree) into the hash. A
// missing source is folded in as such rather than failing: the docker build
// will surface the real error with a far better message.
func hashPath(h interface{ Write(p []byte) (int, error) }, repoRoot, src string) error {
	root := filepath.Join(repoRoot, src)
	info, err := os.Stat(root)
	if err != nil {
		fmt.Fprintf(h, "missing %s\n", src)
		return nil
	}
	hashFile := func(rel string, info fs.FileInfo) {
		fmt.Fprintf(h, "%s %d %d\n", rel, info.Size(), info.ModTime().UnixNano())
	}
	if !info.IsDir() {
		hashFile(src, info)
		return nil
	}
	return filepath.WalkDir(root, func(path string, d fs.DirEntry, err error) error {
		if err != nil {
			return err
		}
		name := d.Name()
		if d.IsDir() && (name == "node_modules" || name == ".git" || name == "dist" || name == ".next") {
			return filepath.SkipDir
		}
		if d.IsDir() || !d.Type().IsRegular() {
			return nil
		}
		info, err := d.Info()
		if err != nil {
			return err
		}
		rel, _ := filepath.Rel(repoRoot, path)
		hashFile(rel, info)
		return nil
	})
}

// langyImagePullRef is the CI-published image for a content tag, when a
// registry is configured (HAVEN_LANGY_IMAGE_REGISTRY, e.g.
// ghcr.io/langwatch/langyagent). Empty means no pull is attempted.
func langyImagePullRef(image string) string {
	registry := os.Getenv("HAVEN_LANGY_IMAGE_REGISTRY")
	if registry == "" {
		return ""
	}
	_, tag, ok := strings.Cut(image, ":")
	if !ok {
		return ""
	}
	return registry + ":" + tag
}
