package domain

import (
	"fmt"
	"net/url"
	"strings"
)

// MainDatabase is the standing shared database (the primary checkout on the
// main branch resolves to it via DatabaseForSlug("main")). It is the fallback
// you use when a worktree doesn't need its own data, so bulk cleanup — prune,
// drop --all — must never take it. An explicit single-database drop still can.
const MainDatabase = "lw_main"

// IsProtectedDatabase reports whether bulk cleanup must leave db alone.
func IsProtectedDatabase(db string) bool {
	return db == MainDatabase
}

// GuardLocalDatabaseURL rejects a database URL that a destructive local-dev
// operation (seed, reset, drop) must never touch: anything not on loopback,
// not authenticated as the expected local dev user, or that smells like
// production. Empty rawURL passes — the operation will fail on its own terms
// rather than on a guess.
func GuardLocalDatabaseURL(rawURL, wantUser string) error {
	if rawURL == "" {
		return nil
	}
	// The parse error itself is discarded: url.Parse echoes the full URL,
	// credentials included, and this message must not.
	u, err := url.Parse(rawURL)
	if err != nil {
		return fmt.Errorf("unparseable database URL %s — refusing a destructive operation", redact(rawURL))
	}

	host := strings.ToLower(u.Hostname())
	if host != "localhost" && host != "127.0.0.1" && host != "::1" && !strings.HasSuffix(host, ".localhost") {
		return fmt.Errorf("database host %q is not local — refusing a destructive operation against it", host)
	}

	if wantUser != "" && u.User != nil {
		if user := u.User.Username(); user != wantUser {
			return fmt.Errorf("database user %q is not the local dev user %q — refusing a destructive operation", user, wantUser)
		}
	}

	// Whole tokens only, so "reproduction" or "oliver" never trip the guard —
	// but lw_main_prod or app-staging does.
	for _, token := range strings.FieldsFunc(strings.ToLower(rawURL), func(r rune) bool {
		return !('a' <= r && r <= 'z') && !('0' <= r && r <= '9')
	}) {
		switch token {
		case "prod", "production", "staging", "live":
			return fmt.Errorf("database URL contains %q — refusing a destructive operation against what looks like a real environment", token)
		}
	}
	return nil
}

// redact hides everything after the scheme so an error message never echoes
// credentials embedded in a URL.
func redact(rawURL string) string {
	if i := strings.Index(rawURL, "://"); i >= 0 {
		return rawURL[:i+3] + "…"
	}
	return "…"
}
