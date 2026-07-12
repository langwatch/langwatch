// Package assets embeds the manager's static worker templates — the AGENTS.md
// system prompt and the skills/ tree opencode discovers — INTO the binary, so a
// worker spawn depends on nothing outside the process. This replaces the old
// entrypoint.sh dance that seeded /opt/langy-templates into the /workspace
// emptyDir at pod startup (a runtime dependency that failed silently when the
// mount or the seed step went wrong).
//
// What is checked in here is the DEV/TEST set: the real AGENTS.md plus a minimal
// skills/ (the langy-only github skill). The production image overlays the full
// compiled skill directory (skills/_compiled/native + services/langyagent/skills)
// into this directory BEFORE `go build`, so the shipped binary embeds the
// complete set — see Dockerfile.langyagent. `go:embed` can only reach files under
// this package dir, which is why the overlay copies them in rather than the
// directive reaching up to the repo-root skills tree.
package assets

import (
	"embed"
	"fmt"
	"io/fs"
	"os"
	"path/filepath"
)

// embedded holds AGENTS.md and the skills/ tree. The patterns are relative to
// this package directory; a build with an empty skills/ would fail the directive,
// so the checked-in github skill keeps local builds honest.
//
//go:embed AGENTS.md
//go:embed skills
var embedded embed.FS

// AgentsTemplate returns the AGENTS.md system-prompt template verbatim. It keeps
// the literal ${LANGWATCH_ENDPOINT} placeholder — the manager substitutes it
// per-worker at spawn. Read from the binary, so it never depends on a mounted
// /workspace.
func AgentsTemplate() (string, error) {
	raw, err := embedded.ReadFile("AGENTS.md")
	if err != nil {
		return "", fmt.Errorf("assets: read embedded AGENTS.md: %w", err)
	}
	return string(raw), nil
}

// MaterializeSkills writes the embedded skills/ tree to destDir on disk so the
// per-worker opencode subprocess can discover it (a subprocess cannot read the
// embedded FS). Files land world-readable + root-owned (dirs 0755, files 0644):
// every per-conversation worker UID must be able to open(2) them for read, and
// none may modify them — the same posture the old entrypoint.sh chmod set. Call
// once at pool startup; setupWorkerHome then symlinks each worker home at destDir.
func MaterializeSkills(destDir string) error {
	return fs.WalkDir(embedded, "skills", func(path string, d fs.DirEntry, err error) error {
		if err != nil {
			return err
		}
		// Re-root "skills/..." under destDir (destDir IS the skills dir).
		rel, err := filepath.Rel("skills", path)
		if err != nil {
			return err
		}
		target := filepath.Join(destDir, rel)
		if d.IsDir() {
			return os.MkdirAll(target, 0o755)
		}
		data, err := embedded.ReadFile(path)
		if err != nil {
			return fmt.Errorf("assets: read embedded %s: %w", path, err)
		}
		if err := os.MkdirAll(filepath.Dir(target), 0o755); err != nil {
			return err
		}
		return os.WriteFile(target, data, 0o644)
	})
}
