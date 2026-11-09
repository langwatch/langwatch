package ecrtag

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"regexp"
	"slices"
	"strings"
)

// LwqlAccessTagPrefix starts the tag that records an app image's LangWatchQL
// access-model fingerprint: lwql-access-<fingerprint>-<tag>. Cloud's render
// Job re-runs only when it changes (langwatch-saas infrastructure/lwql.tf).
const LwqlAccessTagPrefix = "lwql-access-"

var lwqlAccessTag = regexp.MustCompile(`^` + LwqlAccessTagPrefix + `([0-9a-f]{32})-`)

// lwqlAccessFiles are the two files the render writes, as `find .` names them.
var lwqlAccessFiles = []string{"./config.d/lwql-named-collection.yaml", "./users.d/lwql-access.yaml"}

// lwqlRender renders in the image and prints "<sha256>  ./<path>" per file;
// the task's own log lines go to stderr.
const lwqlRender = `set -eu
cd /app/apps/tasks
pnpm --silent task lwql-render-access-config 1>&2
cd "$LWQL_RENDER_OUT_DIR"
find . -type f | LC_ALL=C sort | xargs sha256sum`

// lwqlPlaceholders are two input sets that differ in every value the render
// reads, so code that treats one input differently changes the sums.
var lwqlPlaceholders = [][]string{
	{
		"CLICKHOUSE_URL=http://default:a@clickhouse.fingerprint.internal:8123/langwatch",
		"DATABASE_URL=postgresql://langwatch_db:a@postgres.fingerprint.internal:5432/langwatch_db?schema=langwatch_db",
		"LWQL_CLICKHOUSE_USER=langwatch_lwql", "LWQL_DATABASE=langwatch", "LWQL_TENANT_SETTING=custom_api_key_hash",
		"LWQL_CLICKHOUSE_PASSWORD=fingerprint-clickhouse-a", "LWQL_POSTGRES_READER_PASSWORD=fingerprint-postgres-a",
	},
	{
		"CLICKHOUSE_URL=https://admin:b@ch-b.fingerprint.internal:18443/lwql_fingerprint_db",
		"DATABASE_URL=postgresql://reader:b@pg-b.fingerprint.internal:6543/lwql_fingerprint_pg?schema=lwql_fingerprint_pg",
		"LWQL_CLICKHOUSE_USER=lwql_fingerprint_user", "LWQL_DATABASE=lwql_fingerprint_db",
		"LWQL_TENANT_SETTING=custom_lwql_fingerprint_tenant",
		"LWQL_CLICKHOUSE_PASSWORD=fingerprint-clickhouse-b", "LWQL_POSTGRES_READER_PASSWORD=fingerprint-postgres-b",
	},
}

// LwqlAccessFingerprint renders the access model inside image, offline, from
// each placeholder set, and returns 32 hex characters of a sha256 over the
// file sums. Two images return the same value when they render the same files.
func LwqlAccessFingerprint(ctx context.Context, run Exec, image string) (string, error) {
	h := sha256.New()
	for _, set := range lwqlPlaceholders {
		args := []string{"run", "--rm", "--network", "none", "--entrypoint", "/bin/sh",
			"-e", "HOME=/tmp", "-e", "LWQL_RENDER_OUT_DIR=/tmp/lwql-render"}
		for _, env := range set {
			args = append(args, "-e", env)
		}
		out, err := run(ctx, Command{Name: "docker", Args: append(args, image, "-c", lwqlRender)})
		if err != nil {
			return "", fmt.Errorf("render the access model in %s: %w", image, err)
		}
		sums, err := lwqlSums(out)
		if err != nil {
			return "", fmt.Errorf("render the access model in %s: %w", image, err)
		}
		h.Write([]byte(sums))
	}

	return hex.EncodeToString(h.Sum(nil))[:32], nil
}

// lwqlSums checks the render wrote exactly the two files, each with a sha256.
func lwqlSums(out string) (string, error) {
	var paths []string
	lines := strings.Split(strings.TrimSpace(out), "\n")
	for _, line := range lines {
		fields := strings.Fields(line)
		if len(fields) != 2 || len(fields[0]) != 64 || strings.Trim(fields[0], "0123456789abcdef") != "" {
			return "", fmt.Errorf("unexpected sum line %q", line)
		}
		paths = append(paths, fields[1])
	}
	if !slices.Equal(paths, lwqlAccessFiles) {
		return "", fmt.Errorf("the render wrote %v, not %v", paths, lwqlAccessFiles)
	}

	return strings.Join(lines, "\n") + "\n", nil
}

// LwqlAccessFingerprintOf reads the fingerprint from an image's tags. ok is
// false when there is none, or more than one distinct one.
func LwqlAccessFingerprintOf(tags []string) (fingerprint string, ok bool) {
	var found []string
	for _, tag := range tags {
		if m := lwqlAccessTag.FindStringSubmatch(tag); len(m) == 2 && !slices.Contains(found, m[1]) {
			found = append(found, m[1])
		}
	}
	if len(found) != 1 {
		return "", false
	}

	return found[0], true
}

// ErrNoLwqlFingerprint is a tag with no fingerprint to copy from any source.
var ErrNoLwqlFingerprint = errors.New("no access-model fingerprint to record")

// LwqlAccessTag gives Ref its lwql-access-<fingerprint>-<tag> tag, from
// Render, or else the one a Sources tag's image carries (a per-arch manifest
// this run built, or the image a re-tag copied). Render runs only when Ref
// has no fingerprint yet.
type LwqlAccessTag struct {
	Registry Registry
	Ref      Ref
	Render   func(ctx context.Context) (string, error)
	Sources  []string
}

// Write returns the fingerprint it recorded. A Ref that already carries one
// is left alone.
func (l LwqlAccessTag) Write(ctx context.Context) (string, error) {
	own, err := l.Registry.ImageTags(ctx, l.Ref)
	if err != nil {
		return "", err
	}
	if fingerprint, ok := LwqlAccessFingerprintOf(own); ok {
		return fingerprint, nil
	}
	fingerprint, err := l.fingerprint(ctx)
	if err != nil {
		return "", err
	}
	m, err := l.Registry.Manifest(ctx, l.Ref)
	if err != nil {
		return "", err
	}
	tag := Ref{Repository: l.Ref.Repository, Tag: LwqlAccessTagPrefix + fingerprint + "-" + l.Ref.Tag}

	return fingerprint, l.Registry.Put(ctx, tag, m)
}

func (l LwqlAccessTag) fingerprint(ctx context.Context) (string, error) {
	if l.Render != nil {
		return l.rendered(ctx)
	}
	for _, source := range l.Sources {
		tags, err := l.Registry.ImageTags(ctx, Ref{Repository: l.Ref.Repository, Tag: source})
		if errors.Is(err, ErrNotFound) {
			continue
		}
		if err != nil {
			return "", err
		}
		if fingerprint, ok := LwqlAccessFingerprintOf(tags); ok {
			return fingerprint, nil
		}
	}

	return "", fmt.Errorf("%w: %s, from %v", ErrNoLwqlFingerprint, l.Ref, l.Sources)
}

func (l LwqlAccessTag) rendered(ctx context.Context) (string, error) {
	fingerprint, err := l.Render(ctx)
	if err != nil {
		return "", err
	}
	if !lwqlAccessTag.MatchString(LwqlAccessTagPrefix + fingerprint + "-") {
		return "", fmt.Errorf("%q is not a 32-character hex fingerprint", fingerprint)
	}

	return fingerprint, nil
}
