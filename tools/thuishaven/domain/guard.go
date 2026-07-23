package domain

import (
	"bufio"
	"fmt"
	"net/url"
	"os"
	"path/filepath"
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

// EnvLookup resolves an environment variable; os.Getenv satisfies it (and a fake
// does in tests). It lets the seed guard resolve URLs with process-environment
// precedence without hard-wiring os into the guard's own signature.
type EnvLookup func(string) string

// GuardSeedTargets refuses to seed when either database URL the seed child will
// actually connect to points anywhere but local dev. dotenv holds the merged
// .env + .env.portless values; getenv resolves the process environment, which
// wins — exactly the precedence the seed child sees (Prisma/tsx read the process
// environment over the dotenv file), so the env this guard validates and the env
// the seed connects to are provably the same.
func GuardSeedTargets(dotenv map[string]string, getenv EnvLookup) error {
	resolve := func(key string) string {
		if getenv != nil {
			if v := getenv(key); v != "" {
				return v
			}
		}
		return dotenv[key]
	}
	if err := GuardLocalDatabaseURL(resolve("DATABASE_URL"), PostgresRole); err != nil {
		return fmt.Errorf("refusing to seed: %w", err)
	}
	if err := GuardLocalDatabaseURL(resolve("CLICKHOUSE_URL"), ""); err != nil {
		return fmt.Errorf("refusing to seed: %w", err)
	}
	return nil
}

// LoadDotenv merges .env then .env.portless from lwDir into a single map (later
// files override earlier ones, matching the app's own load order). It is the
// shared entry point both cmd (the `haven seed` guard) and app (the always-seed
// on `haven up`) use so they validate one, identical view of the dotenv layers.
func LoadDotenv(lwDir string) map[string]string {
	env := map[string]string{}
	for _, name := range []string{".env", ".env.portless"} {
		ReadEnvFile(filepath.Join(lwDir, name), env)
	}
	return env
}

// ReadEnvFile merges KEY=VALUE lines from a dotenv file into env. Missing files
// are fine; this is a guard's reader, not a full loader.
func ReadEnvFile(path string, env map[string]string) {
	f, err := os.Open(path)
	if err != nil {
		return
	}
	defer f.Close()
	sc := bufio.NewScanner(f)
	for sc.Scan() {
		line := strings.TrimSpace(sc.Text())
		if line == "" || strings.HasPrefix(line, "#") {
			continue
		}
		line = strings.TrimPrefix(line, "export ")
		key, value, ok := strings.Cut(line, "=")
		if !ok {
			continue
		}
		value = strings.TrimSpace(value)
		// A quoted value keeps only what sits between the quotes, discarding
		// anything after the closing quote (including a trailing comment). An
		// unquoted value is cut at " #" so `DATABASE_URL=postgres://localhost/db
		// # note` does not parse the comment into the URL and refuse a perfectly
		// local target.
		if len(value) > 0 && (value[0] == '"' || value[0] == '\'') {
			if end := strings.IndexByte(value[1:], value[0]); end >= 0 {
				value = value[1 : end+1]
			} else {
				value = value[1:]
			}
		} else if i := strings.Index(value, " #"); i >= 0 {
			value = strings.TrimSpace(value[:i])
		}
		env[strings.TrimSpace(key)] = value
	}
}

// redact hides everything after the scheme so an error message never echoes
// credentials embedded in a URL.
func redact(rawURL string) string {
	if i := strings.Index(rawURL, "://"); i >= 0 {
		return rawURL[:i+3] + "…"
	}
	return "…"
}
