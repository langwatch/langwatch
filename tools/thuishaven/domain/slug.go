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

// RedisDBCount is how many databases a stock Redis serves (0-15).
const RedisDBCount = 16

// RedisDBForSlug maps a slug to a PREFERRED Redis DB (0-15). It is only a
// starting point: with 16 databases and a plain hash, distinct slugs collide
// often — three concurrent worktrees landing on the same index is ordinary,
// not unlucky. Use AllocateRedisDB, which probes from here for a free one.
func RedisDBForSlug(slug string) int {
	var h uint32
	for _, c := range slug {
		h = h*31 + uint32(c)
	}
	return int(h % RedisDBCount)
}

// AllocateRedisDB picks the Redis DB a stack should use, given the databases
// other live stacks already hold.
//
// Sharing one is not a mild inconvenience: Redis is where the GroupQueue
// lives, so two stacks on the same index share a job queue while writing to
// SEPARATE ClickHouse databases. Whichever worker claims a job projects it
// into its own database, and because every stack seeds the same fixed local
// identity the tenant ids match perfectly — so the work lands in the wrong
// stack and nothing looks wrong.
//
// Probing starts at the slug's preferred index so a stack keeps the same
// database whenever it can, and the caller persists the result so it survives
// restarts even if the neighbors change.
//
// With all 16 held it returns the preferred index and reports false: a
// collision is then unavoidable, and the caller should say so rather than
// pretend the stack is isolated.
func AllocateRedisDB(slug string, taken map[int]bool) (db int, exclusive bool) {
	preferred := RedisDBForSlug(slug)
	for offset := range RedisDBCount {
		candidate := (preferred + offset) % RedisDBCount
		if !taken[candidate] {
			return candidate, true
		}
	}
	return preferred, false
}

// ErrInvalidSlug is returned when an explicit LANGWATCH_SLUG is malformed.
func ErrInvalidSlug(s string) error {
	return fmt.Errorf("%q is not a valid slug (want lowercase words joined by -)", s)
}
