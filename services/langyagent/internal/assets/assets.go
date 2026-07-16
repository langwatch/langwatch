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

// Embedded fs paths (always forward-slashed). These mirror the //go:embed
// directives above — the directives need string literals, so the consts document
// them rather than drive them.
const (
	agentsFile = "AGENTS.md"
	skillsRoot = "skills"
)

// Skill-tree permissions. World-readable + root-owned so every per-conversation
// worker UID can open(2) a skill for read while none can modify it — the posture
// the old entrypoint.sh chmod set. Explicit (not umask-derived) so the guarantee
// holds regardless of the container's umask.
const (
	dirPerm  = 0o755
	filePerm = 0o644
)

// AgentsTemplate returns the AGENTS.md system-prompt template verbatim. It keeps
// the literal ${LANGWATCH_ENDPOINT} placeholder — the manager substitutes it
// per-worker at spawn. Read from the binary, so it never depends on a mounted
// /workspace.
func AgentsTemplate() (string, error) {
	raw, err := embedded.ReadFile(agentsFile)
	if err != nil {
		return "", fmt.Errorf("assets: read embedded %s: %w", agentsFile, err)
	}
	return string(raw), nil
}

// MaterializeSkills writes the embedded skills/ tree to destDir on disk so the
// per-worker opencode subprocess can discover it (a subprocess cannot read the
// embedded FS). Idempotent — it overwrites, so a restart re-lays the tree cleanly.
// Call once at pool startup; each worker home then symlinks to destDir.
func MaterializeSkills(destDir string) error {
	return fs.WalkDir(embedded, skillsRoot, func(path string, d fs.DirEntry, err error) error {
		if err != nil {
			return err
		}
		// Re-root the embedded "skills/..." path under destDir (destDir IS the
		// skills dir). WalkDir visits a directory before its entries, so a file's
		// parent already exists by the time we reach it — no per-file MkdirAll.
		rel, err := filepath.Rel(skillsRoot, path)
		if err != nil {
			return err
		}
		target := filepath.Join(destDir, rel)
		if d.IsDir() {
			return os.MkdirAll(target, dirPerm)
		}
		data, err := embedded.ReadFile(path)
		if err != nil {
			return fmt.Errorf("assets: read embedded %s: %w", path, err)
		}
		return os.WriteFile(target, data, filePerm)
	})
}
