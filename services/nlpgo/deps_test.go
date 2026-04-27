package nlpgo

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// TestSplitArgs_EntrypointDefaultParsesAsArgv pins the contract between
// langwatch_nlp/scripts/entrypoint.sh and services/nlpgo/deps.go's
// splitArgs.
//
// The lambda image's entrypoint exports NLPGO_CHILD_ARGS as a single
// env string that splitArgs(...) tokenizes for exec.Command. The split
// is whitespace-only — commas are NOT separators. The original
// entrypoint shipped commas and the uvicorn child failed to start on
// every cold container (caught smoke-testing the lambda image during
// PR #3483 deploy pre-flight: `error: unexpected argument
// '--no-cache,run,--no-sync,…'`).
//
// This test reads entrypoint.sh, extracts the default value of
// NLPGO_CHILD_ARGS, runs splitArgs on it, and asserts:
//
//   - the result is multi-token (>1) — guards against any future
//     "concat with commas" mistake silently shipping
//   - it includes 'uvicorn' and the module path 'langwatch_nlp.main:app'
//     — sanity-checks the entrypoint hasn't been gutted to something
//     unrelated
//   - it includes the host/port pair — guards against truncation
//
// We deliberately do NOT pin the exact argv length; the entrypoint's
// keep-alive flag is templated and operators may add flags via env
// override. The shape checks are the load-bearing ones.
func TestSplitArgs_EntrypointDefaultParsesAsArgv(t *testing.T) {
	// entrypoint.sh lives at the repo root under langwatch_nlp/scripts.
	// services/nlpgo/ is two levels deep; walk up.
	root := findRepoRoot(t)
	path := filepath.Join(root, "langwatch_nlp", "scripts", "entrypoint.sh")
	raw, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("read entrypoint: %v", err)
	}

	defaultArgs := extractDefaultEnvVar(t, string(raw), "NLPGO_CHILD_ARGS")
	tokens := splitArgs(defaultArgs)
	if len(tokens) <= 1 {
		t.Fatalf("entrypoint NLPGO_CHILD_ARGS default tokenized to %d arg(s) — looks comma-joined again. raw=%q tokens=%v",
			len(tokens), defaultArgs, tokens)
	}
	mustContain := []string{
		"uvicorn",
		"langwatch_nlp.main:app",
		"127.0.0.1",
		"5561",
	}
	joined := strings.Join(tokens, " ")
	for _, want := range mustContain {
		if !strings.Contains(joined, want) {
			t.Errorf("entrypoint default NLPGO_CHILD_ARGS missing %q (parsed argv: %v)", want, tokens)
		}
	}
}

// findRepoRoot walks up from the test's working dir until it finds
// go.mod (the repo root), so the test is location-independent.
func findRepoRoot(t *testing.T) string {
	t.Helper()
	dir, err := os.Getwd()
	if err != nil {
		t.Fatalf("getwd: %v", err)
	}
	for {
		if _, err := os.Stat(filepath.Join(dir, "go.mod")); err == nil {
			return dir
		}
		parent := filepath.Dir(dir)
		if parent == dir {
			t.Fatalf("could not find go.mod walking up from %q", dir)
		}
		dir = parent
	}
}

// extractDefaultEnvVar finds `export NAME="${NAME:-DEFAULT}"` in a
// shell script and returns DEFAULT. Tolerates the trailing $KEEP_ALIVE
// templating in the entrypoint by leaving the literal `$KEEP_ALIVE` in
// place — splitArgs will tokenize it as a final positional arg, which
// is fine for the shape checks above.
func extractDefaultEnvVar(t *testing.T, script, name string) string {
	t.Helper()
	prefix := `export ` + name + `="${` + name + `:-`
	idx := strings.Index(script, prefix)
	if idx < 0 {
		t.Fatalf("entrypoint missing `%s` default-value export — entrypoint shape changed; update this test or the entrypoint", prefix)
	}
	rest := script[idx+len(prefix):]
	end := strings.Index(rest, `}"`)
	if end < 0 {
		t.Fatalf("entrypoint export for %s did not close with `}\"`", name)
	}
	return rest[:end]
}
