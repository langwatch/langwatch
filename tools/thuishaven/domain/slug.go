package domain

import (
	"crypto/sha1"
	"fmt"
	"regexp"
)

// SlugPattern accepts two or three lowercase words joined by "-".
var SlugPattern = regexp.MustCompile(`^[a-z0-9]+(?:-[a-z0-9]+){1,2}$`)

// DeriveSlug maps a worktree path to a stable, friendly slug. sha1(path) indexes
// the wordlists so one worktree always gets the same slug (hostnames never move)
// and two worktrees get different slugs (collisions are structurally impossible).
// On the rare collision with a slug already in use, a place word is appended.
func DeriveSlug(worktreeDir string, taken map[string]bool) string {
	h := sha1.Sum([]byte(worktreeDir))
	slug := adjectives[int(h[0])%len(adjectives)] + "-" + animals[int(h[1])%len(animals)]
	if taken[slug] {
		slug += "-" + places[int(h[2])%len(places)]
	}
	return slug
}

// ValidSlug reports whether s is a well-formed slug.
func ValidSlug(s string) bool { return SlugPattern.MatchString(s) }

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
	return fmt.Errorf("%q is not a valid slug (want two or three lowercase words joined by -)", s)
}
