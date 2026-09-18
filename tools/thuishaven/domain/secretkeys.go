package domain

import (
	"bytes"
	"io/fs"
	"net/url"
	"os"
	"path/filepath"
	"regexp"
	"strings"
)

// A key's classification used to be data in packages/secrets/keys.json, one
// file both languages read. The decentralized wall (ARCHITECTURE.md §6,
// commit eea150100e) deleted that file: a secret is now declared where it is
// used, as a `Secret.load("ID")` handle in a module contract or a framework
// package. haven has no TypeScript compiler, so it reads the same source the
// same way a person would — by finding every such call — rather than trusting
// a second, hand-maintained list that would drift the moment a handle moved.

// SecretClass is the class one environment variable falls into.
type SecretClass string

const (
	// ClassSecret is a credential: masked, never printed without --reveal.
	// Whether the printed form keeps its shape (a connection string keeps
	// scheme/host/port/path) or is blanked outright is decided from the
	// VALUE at mask time, not the declaration — see MaskEnvValue.
	ClassSecret SecretClass = "secret"
	// ClassConfig is everything else and prints verbatim.
	ClassConfig SecretClass = "config"
)

// MaskedSecret is what a secret's value reads as without --reveal.
const MaskedSecret = "<secret:masked>"

// secretLoadPattern finds a declared handle's id: every call in the tree today
// is `Secret.load("ID", …)` or `Secret.load('ID', …)`, one id per call, on one
// line. A future multi-line call would simply not match this layer — the
// name-shape layer (NameLooksSecret) is the backstop for exactly that miss.
var secretLoadPattern = regexp.MustCompile(`Secret\.load\(\s*["']([A-Za-z0-9_]+)["']`)

// secretSourceDirs are where a `Secret.load` call can legally live: modules'
// contract/process halves, framework packages, and the two apps (tasks,
// worker) that still declare a slice of their own. Scoping the walk here
// keeps it to source, never node_modules or a build output.
var secretSourceDirs = []string{"packages", "modules", "enterprise", "apps"}

// havenSeedCredentialKeys are dev credentials haven itself mints and injects
// (the Default* constants in overlay.go) — read directly as a plain
// process.env var by a seed script, never through a Secret.load handle, so a
// source scan can never find them. haven is the one owner who knows these
// exist, so it declares them here rather than leaving them to the name-shape
// fallback alone.
var havenSeedCredentialKeys = []string{
	"HAVEN_SEED_LANGWATCH_API_KEY",
	"LANGWATCH_ADMIN_PASSWORD",
	"LANGWATCH_PRIVATE_ACCESS_TOKEN",
	"LANGWATCH_PUBLIC_ACCESS_TOKEN",
}

// SecretClasses scans the checkout at repoRoot for every declared secret and
// answers with a classification map — always non-nil, since the haven-seeded
// keys are always present even when nothing in the tree scans (e.g. a test's
// empty temp dir). A file this cannot read is skipped, not fatal: masking the
// rest of the tree's declarations is better than masking none of them.
func SecretClasses(repoRoot string) map[string]SecretClass {
	classes := make(map[string]SecretClass, len(havenSeedCredentialKeys))
	for _, key := range havenSeedCredentialKeys {
		classes[key] = ClassSecret
	}
	for _, dir := range secretSourceDirs {
		scanDeclaredSecrets(filepath.Join(repoRoot, dir), classes)
	}
	return classes
}

// scanDeclaredSecrets walks one top-level directory looking for `Secret.load`
// calls in TypeScript source, adding every id it finds to classes.
func scanDeclaredSecrets(root string, classes map[string]SecretClass) {
	_ = filepath.WalkDir(root, func(path string, entry fs.DirEntry, err error) error {
		if err != nil {
			return nil //nolint:nilerr // an unreadable path must not stop the rest of the walk
		}
		if entry.IsDir() {
			return skipVendorDir(entry)
		}
		recordDeclaredSecrets(path, classes)
		return nil
	})
}

// skipVendorDir tells WalkDir to descend into an ordinary directory and skip
// the ones that never hold first-party source.
func skipVendorDir(entry fs.DirEntry) error {
	switch entry.Name() {
	case "node_modules", "dist", ".git":
		return filepath.SkipDir
	default:
		return nil
	}
}

// recordDeclaredSecrets reads one file and adds every `Secret.load` id it
// declares to classes. Silent on anything that is not a readable, matching
// TypeScript file — a scan finding fewer handles than expected must not stop
// the walk, only leave the name-shape layer to cover the gap.
func recordDeclaredSecrets(path string, classes map[string]SecretClass) {
	if !strings.HasSuffix(path, ".ts") {
		return
	}
	raw, err := os.ReadFile(path)
	if err != nil {
		return
	}
	if !bytes.Contains(raw, []byte("Secret.load(")) {
		return
	}
	for _, match := range secretLoadPattern.FindAllSubmatch(raw, -1) {
		classes[string(match[1])] = ClassSecret
	}
}

// NameLooksSecret is the SECOND layer, never the only one: the key-name
// shapes that are a credential in every deployment we have ever shipped.
// It catches what a scan cannot — a variable a script reads straight off
// process.env with no declaration anywhere, the way havenSeedCredentialKeys
// above catches the ones this package already knows by name.
func NameLooksSecret(key string) bool {
	suffixes := []string{"_SECRET", "_API_KEY", "_PASSWORD", "_TOKEN", "_PRIVATE_KEY", "_PEPPER"}
	for _, suffix := range suffixes {
		if strings.HasSuffix(key, suffix) {
			return true
		}
	}
	return false
}

// ClassOf answers the class of one key: declared (scanned or haven-seeded)
// first, the name-shape heuristic second, config otherwise. Both layers are
// always live — the declared list is not allowed to be the only one, and
// nor is the heuristic (that pairing is what let DATABASE_URL and
// CLICKHOUSE_URL print in clear once the shared keys.json was deleted: they
// are declared, but their names don't end in any of NameLooksSecret's
// suffixes).
func ClassOf(classes map[string]SecretClass, key string) SecretClass {
	if classes != nil {
		if class, ok := classes[key]; ok {
			return class
		}
	}
	if NameLooksSecret(key) {
		return ClassSecret
	}
	return ClassConfig
}

// MaskEnvValue renders one value for an ordinary reader. Config passes
// through. A secret is masked from its VALUE's own shape: a connection
// string (has a host) keeps scheme, host, port and path and loses its
// userinfo and query — the fact a deployment reads Postgres at db.internal
// is not itself the credential — anything else is blanked outright.
func MaskEnvValue(classes map[string]SecretClass, key, value string) string {
	if ClassOf(classes, key) != ClassSecret {
		return value
	}
	if masked, isConnectionString := maskIfConnectionString(value); isConnectionString {
		return masked
	}
	return MaskedSecret
}

// maskIfConnectionString strips the credential out of a URL-shaped secret
// (`scheme://user:pass@host:port/path?query`) and keeps the rest, so a log
// line can still say which server was unreachable. A value with no host
// is not a connection string — GOOGLE_APPLICATION_CREDENTIALS or a bare API
// key both parse "successfully" as a relative net/url.URL with no host, and
// both fall through to a full blank in MaskEnvValue.
func maskIfConnectionString(value string) (masked string, ok bool) {
	trimmed := strings.TrimSpace(value)
	if trimmed == "" {
		return trimmed, true
	}
	parsed, err := url.Parse(trimmed)
	if err != nil || parsed.Host == "" {
		return "", false
	}
	parsed.User = nil
	parsed.RawQuery = ""
	parsed.Fragment = ""
	return parsed.String(), true
}
