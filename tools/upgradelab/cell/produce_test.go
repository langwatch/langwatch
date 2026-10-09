package cell

import (
	"bytes"
	"context"
	"os"
	"os/exec"
	"path/filepath"
	"slices"
	"strings"
	"testing"

	"github.com/langwatch/langwatch/tools/upgradelab/snapshot"
)

// @scenario "A cell runs built code on both sides and never spawns a dev command"
func TestCellRunsBuiltCodeOnBothSides(t *testing.T) {
	argvs := [][]string{FromAppArgs, FromWorkerArgs, HeadStartArgs, FromBuild("/main").Args, HeadBuild("/head").Args}
	for _, argv := range argvs {
		line := strings.Join(argv, " ")
		for _, banned := range []string{"tsx", "vite dev", "--watch", ":dev"} {
			if strings.Contains(line, banned) {
				t.Errorf("%q holds %q", line, banned)
			}
		}
	}
	env, err := BuildEnv(EnvInput{Profile: Profiles["cloud"], Stores: Stores{Name: "upgradelab_x", RedisPort: "1"}, APIPort: 7100})
	if err != nil || env["NODE_ENV"] != "production" {
		t.Fatalf("NODE_ENV %q, err %v", env["NODE_ENV"], err)
	}
}

// @scenario "A build is skipped when its stamp records the same commit and the output exists"
func TestBuildIsSkippedWhileItsStampRecordsTheCommit(t *testing.T) {
	root := t.TempDir()
	build := Build{Root: root, Output: "out.txt", Args: []string{"sh", "-c", "echo built >> runs.txt; touch out.txt"}}
	if err := os.MkdirAll(filepath.Join(root, "node_modules"), 0o750); err != nil {
		t.Fatal(err)
	}
	for _, args := range [][]string{{"init", "-q"}, {"-c", "user.email=t@t", "-c", "user.name=t", "commit", "-q", "--allow-empty", "-m", "x"}} {
		if out, err := gitIn(root, args...); err != nil {
			t.Skipf("git unavailable: %v %s", err, out)
		}
	}
	log := filepath.Join(t.TempDir(), "build.log")
	for range 2 {
		if err := build.Ensure(context.Background(), log); err != nil {
			t.Fatal(err)
		}
	}
	runs, _ := os.ReadFile(filepath.Join(root, "runs.txt"))
	if got := strings.Count(string(runs), "built"); got != 1 {
		t.Fatalf("built %d times, want 1 (second skipped by the stamp)", got)
	}
	_ = os.Remove(filepath.Join(root, "out.txt"))
	if err := build.Ensure(context.Background(), log); err != nil {
		t.Fatal(err)
	}
	if runs, _ = os.ReadFile(filepath.Join(root, "runs.txt")); strings.Count(string(runs), "built") != 2 {
		t.Fatal("a missing output did not rebuild")
	}
	if build.Fresh("another-commit") {
		t.Fatal("a stamp of another commit counts as fresh")
	}
}

// @scenario "produce skips a cached key unless forced"
func TestProduceSkipsACachedKeyUnlessForced(t *testing.T) {
	t.Setenv("XDG_CACHE_HOME", t.TempDir())
	options := Options{Deployment: "cloud", Tier: "S", Shape: "typical", Seed: 1, Release: "main@abc"}
	key := CacheKey(options)
	if !slices.Contains(strings.Split(key, "-"), "main") || !strings.Contains(key, "abc") || !strings.Contains(key, "cloud-S-typical-seed1") {
		t.Fatalf("key %q misses a part", key)
	}
	dir := filepath.Join(CacheRoot(), key)
	if err := os.MkdirAll(filepath.Join(dir, entrySnapshot), 0o750); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(dir, entrySnapshot, snapshot.ManifestFile), []byte("{}"), 0o600); err != nil {
		t.Fatal(err)
	}
	var out bytes.Buffer
	got, err := Produce(context.Background(), ProduceOptions{Options: withStdout(options, &out)})
	if err != nil || got != dir || !strings.Contains(out.String(), "cached") {
		t.Fatalf("got %q, %v, %q", got, err, out.String())
	}
	if ResolveSnapshot(key) != dir {
		t.Fatal("a cache key does not resolve to its entry")
	}
	// -force goes past the cache: with no checkout it stops at prepare, so it did not skip.
	if _, err := Produce(context.Background(), ProduceOptions{Options: options, Force: true}); err == nil {
		t.Fatal("-force reused the cached entry")
	}
}

func withStdout(options Options, out *bytes.Buffer) Options {
	options.Stdout = out
	return options
}

func gitIn(dir string, args ...string) ([]byte, error) {
	return exec.CommandContext(context.Background(), "git", append([]string{"-C", dir}, args...)...).CombinedOutput() // #nosec G204 -- test argv.
}
