package domain

import (
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"path/filepath"
	"regexp"
	"strings"
)

// SlugPattern accepts one or more lowercase words joined by "-" — the shape a
// sanitised worktree name takes (e.g. "portless", "adr-domain-errors").
var SlugPattern = regexp.MustCompile(`^[a-z0-9]+(?:-[a-z0-9]+)*$`)

// DeriveSlug turns a worktree path into a stable, human-meaningful slug: the
// worktree's own directory name, sanitised. So a checkout at .../worktrees/portless
// is reachable at app.portless.langwatch.localhost — predictable, not a random
// "happy-tiger". Same worktree → same slug (hostnames never move); different
// worktrees → different slugs. On the rare collision (two worktrees with the same
// basename), a short, stable hash of the full path is appended.
func DeriveSlug(worktreeDir string, taken map[string]bool) string {
	base := SanitizeSlug(filepath.Base(worktreeDir))
	if base == "" {
		base = "stack"
	}
	if !taken[base] {
		return base
	}
	h := sha256.Sum256([]byte(worktreeDir))
	return base + "-" + hex.EncodeToString(h[:2])
}

// SlugFromBranch derives a slug from a git branch name, sanitised the same way
// as a directory name (feat/langy-rework -> feat-langy-rework). Used for the
// primary checkout, whose directory name is the repo name itself and would
// otherwise collide with the project label (app.langwatch.langwatch.localhost).
// Returns "" for a detached HEAD or an otherwise unusable branch.
func SlugFromBranch(branch string) string {
	branch = strings.TrimSpace(branch)
	if branch == "" || branch == "HEAD" {
		return ""
	}
	return SanitizeSlug(branch)
}

// SanitizeSlug lowercases name and reduces it to [a-z0-9-] with single dashes and
// no leading/trailing dash — a valid hostname label and, after the "lw_" prefix
// with dashes swapped for underscores, a valid ClickHouse identifier.
func SanitizeSlug(name string) string {
	name = strings.ToLower(name)
	var b strings.Builder
	dash := true // start "dashed" so leading junk is trimmed
	for _, r := range name {
		switch {
		case (r >= 'a' && r <= 'z') || (r >= '0' && r <= '9'):
			b.WriteRune(r)
			dash = false
		case !dash:
			b.WriteByte('-')
			dash = true
		}
	}
	return strings.Trim(b.String(), "-")
}

// ValidSlug reports whether s is a well-formed slug.
func ValidSlug(s string) bool { return SlugPattern.MatchString(s) }

// SlugOrBase is a worktree's display name: its slug when known, else the basename
// of its directory. Shared so the picker and the report name a worktree the same.
func SlugOrBase(slug, dir string) string {
	if slug != "" {
		return slug
	}
	return filepath.Base(dir)
}

// RedisDBForSlug maps a slug to a stable Redis DB (0-15) so BullMQ queues,
// GroupQueue streams, and fold caches stay isolated across concurrent worktrees —
// the job the old PORT-slot derivation did, now keyed on the slug.
func RedisDBForSlug(slug string) int {
	var h uint32
	for _, c := range slug {
		h = h*31 + uint32(c)
	}
	return int(h % 16)
}

// ErrInvalidSlug is returned when an explicit LANGWATCH_SLUG is malformed.
func ErrInvalidSlug(s string) error {
	return fmt.Errorf("%q is not a valid slug (want lowercase words joined by -)", s)
}
