package readmegen

import (
	"fmt"
	"slices"
	"strings"
	"testing"
)

func TestEachPartRunsUnderItsOwnHeapCap(t *testing.T) {
	for _, part := range extractorParts {
		heap, ok := extractorHeapMB[part]
		if !ok {
			t.Fatalf("part %q has no heap cap", part)
		}
		args, env := extractorInvocation("/repo", part, []string{"PATH=/bin", "NODE_OPTIONS=--enable-source-maps"})

		limit := fmt.Sprintf("--max-old-space-size=%d", heap)
		capAt := slices.Index(args, limit)
		script := slices.Index(args, "main.mts")
		if capAt < 0 || script < 0 || capAt > script {
			t.Fatalf("%s: want %s before main.mts, got %q", part, limit, args)
		}
		if !slices.Equal(args[script:], []string{"main.mts", part + ".json", "/repo", part}) {
			t.Fatalf("%s: want the script's own arguments after it, got %q", part, args[script:])
		}
		if !slices.Contains(env, "NODE_OPTIONS=--enable-source-maps") {
			t.Fatalf("%s: want the caller's NODE_OPTIONS kept, got %q", part, env)
		}
	}
}

func TestACallerHeapLimitReplacesTheCap(t *testing.T) {
	for _, options := range []string{"--max-old-space-size=8192", "--trace-gc --max_old_space_size=8192"} {
		args, env := extractorInvocation("/repo", "routes", []string{"NODE_OPTIONS=" + options})

		for _, arg := range args {
			if strings.HasPrefix(arg, "--max-old-space-size") {
				t.Fatalf("NODE_OPTIONS=%q: a command-line cap would override the caller's, got %q", options, args)
			}
		}
		if !slices.Contains(env, "NODE_OPTIONS="+options) {
			t.Fatalf("want the caller's NODE_OPTIONS kept, got %q", env)
		}
	}
}

func TestTheCompileCacheDefaultsUnderNodeModules(t *testing.T) {
	_, env := extractorInvocation("/repo", "facts", nil)
	if !slices.Contains(env, "NODE_COMPILE_CACHE=/repo/node_modules/.cache/readmegen/facts") {
		t.Fatalf("want the default compile cache, got %q", env)
	}

	_, env = extractorInvocation("/repo", "facts", []string{"NODE_COMPILE_CACHE=/elsewhere"})
	if !slices.Equal(env, []string{"NODE_COMPILE_CACHE=/elsewhere"}) {
		t.Fatalf("want the caller's compile cache alone, got %q", env)
	}
}
