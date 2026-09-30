package visualdiff

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/langwatch/langwatch/tools/diffkit"
	"github.com/langwatch/langwatch/tools/havenrun"
)

// CheckSlug is the haven stack `visualdiff check` boots from the working tree itself.
// gc never takes it as an orphan; `visualdiff check -down` destroys it.
const CheckSlug = havenSlugPrefix + "-check"

// CheckDir is check's run directory: the runner's output, the seed marker, the UI build key.
func CheckDir(root string) string { return filepath.Join(root, ".visualdiff", "check") }

// checkStackRequest is how check brings its own stack up.
type checkStackRequest struct {
	root, slug    string
	devUI, shared bool
	adoptOnly     bool
	stderr        io.Writer
}

// checkTimes are where check's time went before its flows ran, for the timing block.
type checkTimes struct {
	boot, build, seed time.Duration
	// seedParts are the seed's own parts, when this check seeded.
	seedParts []SeedTiming
}

// checkStack boots the working tree's own stack (or adopts it when haven already runs
// it), builds its UI and seeds it once per boot, and returns it as the runner's side.
func checkStack(ctx context.Context, request checkStackRequest, times *checkTimes) (RunnerSide, error) {
	if err := checkoutUnprepared(request.root, checkoutPrepares); err != nil {
		return RunnerSide{}, err
	}
	dir := CheckDir(request.root)
	run := &session{
		request: Request{Options: Options{Root: request.root, RunDir: dir, BootTimeout: 20 * time.Minute, Stall: 90 * time.Second}},
		streams: Streams{Out: request.stderr, Err: request.stderr},
		phases:  &phaseClock{stderr: request.stderr},
	}
	run.request.Deps.Environ = func() []string { return append(os.Environ(), checkWatchOff) }
	run.request.Deps.fill()
	layout, err := DetectLayout(request.root)
	if err != nil {
		return RunnerSide{}, err
	}
	stack := Stack{Name: "check", Dir: request.root, HavenSlug: request.slug, Layout: layout}
	if request.shared {
		unlock, err := lockCheckStack(dir, request.stderr)
		if err != nil {
			return RunnerSide{}, err
		}
		defer unlock()
	}
	started := time.Now()
	code := workingTreeKey(ctx, request.root)
	booted, err := run.upCheckStack(ctx, &stack, request.adoptOnly)
	if err == nil && !booted && !request.shared {
		err = run.restartChangedBackend(ctx, &stack, code)
	}
	if err != nil {
		return RunnerSide{}, err
	}
	if !request.shared {
		recordKey(filepath.Join(dir, "backend"), code)
	}
	times.boot = time.Since(started)
	fmt.Fprintf(request.stderr, "check: phase boot %s\n", times.boot.Round(time.Second))
	started = time.Now()
	fixtures, err := seedCheckStack(ctx, stack, booted, times, request.stderr)
	if err != nil {
		return RunnerSide{}, err
	}
	times.seed = time.Since(started)
	side := RunnerSide{Name: "candidate", BaseURL: stack.URL(), MailURL: stack.MailURL(), Fixtures: fixtures}
	if !request.devUI {
		started = time.Now()
		side.StaticDir = buildCheckUI(ctx, stack, code, request.stderr)
		times.build = time.Since(started)
	}
	return side, nil
}

// upCheckStack reuses the stack when its lanes listen, waits for one still booting,
// and otherwise runs `haven up` from the working tree. It reports a fresh boot.
func (run *session) upCheckStack(ctx context.Context, stack *Stack, adoptOnly bool) (bool, error) {
	status, err := run.havenStatus(ctx, *stack)
	if err != nil {
		return false, fmt.Errorf("check: haven status: %w", err)
	}
	if url, ready := havenStackURL(status, stack.HavenSlug); ready {
		stack.HavenURL = url
		fmt.Fprintf(run.streams.Err, "check: reusing haven stack %s at %s\n", stack.HavenSlug, url)
		return false, nil
	}
	booted := !stackLive(status, stack.HavenSlug)
	if booted && adoptOnly {
		return false, fmt.Errorf("check: haven stack %s is not up, and diffsuite owns the stacks", stack.HavenSlug)
	}
	if booted {
		if err := run.havenUp(ctx, *stack); err != nil {
			return false, err
		}
	}
	return booted, run.awaitStack(ctx, stack)
}

func stackLive(status havenrun.Status, slug string) bool {
	for _, reported := range status.Stacks {
		if reported.Slug == slug && reported.Live {
			return true
		}
	}
	return false
}

// seedCheckStack seeds a freshly booted stack, or one whose seed record is for other
// seed code, and records the fixtures beside check's run so later checks reuse them.
func seedCheckStack(ctx context.Context, stack Stack, booted bool, times *checkTimes, stderr io.Writer) (map[string]string, error) {
	marker := filepath.Join(CheckDir(stack.Dir), "seeded")
	keyFile := marker + ".key"
	key := seedKey(stack)
	if recorded, err := os.ReadFile(marker); err == nil && !booted && key != "" && readKey(keyFile) == key { // #nosec G304 -- the tool's own run directory.
		fmt.Fprintf(stderr, "check: %s is already seeded\n", stack.HavenSlug)
		return ReadSeededMarker(recorded)["candidate"], nil
	}
	recordKey(keyFile, "")
	started := time.Now()
	result, err := Seed(ctx, SeedRequest{APIURL: stack.APIURL(), Identity: SeedIdentity{}.withSeededDefaults(), TraceCount: 6})
	if err != nil {
		return nil, fmt.Errorf("check: seed: %w", err)
	}
	for _, warning := range result.Warnings {
		fmt.Fprintf(stderr, "check: seed: %s\n", warning)
	}
	times.seedParts = result.Timings
	fmt.Fprintf(stderr, "check: seeded %s in %s\n", stack.HavenSlug, time.Since(started).Round(time.Second))
	encoded, err := json.Marshal(map[string]map[string]string{"candidate": result.Fixtures})
	if err == nil {
		err = os.MkdirAll(filepath.Dir(marker), 0o750)
	}
	if err == nil {
		err = os.WriteFile(marker, encoded, 0o600)
	}
	recordKey(keyFile, key)
	return result.Fixtures, err
}

// seedSources are the files whose change changes what a seed writes.
var seedSources = []string{"seed.go", "seed_flow.go", "seed_entities.go"}

// seedKey names a stack's database and the seed code that filled it, or "" when unreadable.
func seedKey(stack Stack) string {
	digest := sha256.New()
	fmt.Fprintf(digest, "%s\n", stack.HavenSlug)
	for _, source := range seedSources {
		content, err := os.ReadFile(filepath.Join(stack.Dir, "tools", "visualdiff", source)) // #nosec G304 -- the tool's own source.
		if err != nil {
			return ""
		}
		digest.Write(content)
	}
	return hex.EncodeToString(digest.Sum(nil))
}

// buildCheckUI builds the working tree's UI for production when its code changed
// since the last check's build, so pages load without the dev server compiling
// them. A failed build leaves the pages on the dev server, and says so.
func buildCheckUI(ctx context.Context, stack Stack, key string, stderr io.Writer) string {
	_, relative := UIBuildCommand(stack.Layout)
	built := filepath.Join(stack.Dir, relative)
	keyFile := filepath.Join(CheckDir(stack.Dir), "uibuilt")
	if key != "" && readKey(keyFile) == key && fileExists(filepath.Join(built, "index.html")) {
		fmt.Fprintf(stderr, "check: ui build cached (%s)\n", built)
		return built
	}
	recordKey(keyFile, "")
	started := time.Now()
	log := filepath.Join(CheckDir(stack.Dir), "logs", "ui-build.log")
	if _, err := BuildUIDist(ctx, UIBuildRequest{Stack: stack, Log: log}); err != nil {
		fmt.Fprintf(stderr, "check: ui build failed, pages come from the dev server (log %s): %v\n", log, err)
		return ""
	}
	recordKey(keyFile, key)
	fmt.Fprintf(stderr, "check: ui built in %s (%s)\n", time.Since(started).Round(time.Second), built)
	return built
}

// workingTreeKey is codeKey plus the uncommitted edits to code inputs (tracked diffs
// and untracked files), or "" when git cannot say.
func workingTreeKey(ctx context.Context, root string) string {
	head := codeKey(ctx, execRunner, root)
	if head == "" {
		return ""
	}
	pathspec := []string{"--", "."}
	for input := range notCodeInputs {
		pathspec = append(pathspec, ":(exclude)"+input)
	}
	pathspec = append(pathspec, ":(exclude)*.md")
	var diff, untracked bytes.Buffer
	if execRunner(ctx, commandSpec{name: "git", args: append([]string{"diff", "HEAD", "--binary"}, pathspec...), dir: root}, &diff) != nil {
		return ""
	}
	if execRunner(ctx, commandSpec{name: "git", args: append([]string{"ls-files", "-o", "--exclude-standard"}, pathspec...), dir: root}, &untracked) != nil {
		return ""
	}
	digest := sha256.New()
	fmt.Fprintf(digest, "%s\n", head)
	digest.Write(diff.Bytes())
	for _, path := range strings.Split(strings.TrimSpace(untracked.String()), "\n") {
		if content, err := os.ReadFile(filepath.Join(root, path)); err == nil && path != "" { // #nosec G304 -- a file git lists in the checkout.
			fmt.Fprintf(digest, "%s\n", path)
			digest.Write(content)
		}
	}
	return hex.EncodeToString(digest.Sum(nil))
}

// checkWatchOff stops the stack's API restarting on every file another lane saves in
// the shared checkout, which kept it from ever listening; check restarts it instead.
const checkWatchOff = "LANGWATCH_DEV_WATCH_DEBOUNCE_MS=86400000"

// restartChangedBackend bounces the API when the working tree's code changed since the
// stack last (re)started, so a fix reaches it; unchanged code keeps it warm.
func (run *session) restartChangedBackend(ctx context.Context, stack *Stack, code string) error {
	if code != "" && readKey(filepath.Join(run.request.Options.RunDir, "backend")) == code {
		return nil
	}
	fmt.Fprintf(run.streams.Err, "check: the code changed since %s started; haven restart api\n", stack.HavenSlug)
	spec := commandSpec{name: havenrun.Command, args: []string{"restart", havenrun.BackendLane}, dir: stack.Dir, env: havenEnv(run.request.Deps.Environ(), stack.HavenSlug)}
	if err := run.request.Deps.Run(ctx, spec, run.streams.Err); err != nil {
		return fmt.Errorf("haven restart api: %w", err)
	}
	return run.awaitStack(ctx, stack)
}

func readKey(path string) string {
	recorded, err := os.ReadFile(path) // #nosec G304 -- the tool's own run directory.
	if err != nil {
		return ""
	}
	return strings.TrimSpace(string(recorded))
}

// recordKey stores a key, or forgets it with "" so a half-done step is never read as done.
func recordKey(path, key string) {
	if key == "" {
		_ = os.Remove(path)
		return
	}
	_ = os.MkdirAll(filepath.Dir(path), 0o750)
	_ = os.WriteFile(path, []byte(key+"\n"), 0o600)
}

// downCheckStack destroys check's own stack and forgets its seed.
func downCheckStack(ctx context.Context, root string, stderr io.Writer) error {
	spec := commandSpec{name: havenrun.Command, args: havenrun.DestroyArgs(CheckSlug), dir: root, env: havenEnv(os.Environ(), CheckSlug)}
	fmt.Fprintf(stderr, "check: haven destroy %s\n", CheckSlug)
	if err := execRunner(ctx, spec, stderr); err != nil {
		return fmt.Errorf("haven destroy %s: %w", CheckSlug, err)
	}
	for _, name := range []string{"seeded", "backend"} {
		if err := os.Remove(filepath.Join(CheckDir(root), name)); err != nil && !errors.Is(err, os.ErrNotExist) {
			return err
		}
	}
	return nil
}

// lockCheckStack holds check's stack for one lane's boot and seed, so lanes sharing the
// stack never boot or seed it twice at once. The lock goes when the process does.
func lockCheckStack(dir string, stderr io.Writer) (func(), error) {
	return diffkit.Lock(dir, "stack.lock", "check: another lane is booting or seeding the shared stack; waiting",
		func(line string) { fmt.Fprintln(stderr, line) })
}
