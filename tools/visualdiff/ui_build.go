package visualdiff

import (
	"context"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"time"
)

// uiBuiltSuffix names the file beside a persistent worktree that records the
// key of the UI build it last finished, like worktreePreparedSuffix does for
// the prepare.
const uiBuiltSuffix = ".uibuilt"

// UIBuildRequest is one side's production UI build: its stack and the log
// the build writes to.
type UIBuildRequest struct {
	Stack Stack
	Log   string
}

// UIBuild is where a side's built UI lives, and whether an earlier run's
// build of the same tree was reused.
type UIBuild struct {
	Dir    string
	Cached bool
}

// UIBuildCommand is the production build of a side's UI and the directory,
// relative to the worktree, it writes: apps/ui on a modular tree, main's
// platform/app client on a monolith one.
func UIBuildCommand(layout Layout) (commandSpec, string) {
	if layout == LayoutMonolith {
		return commandSpec{name: "env", args: []string{"-u", "CI", "pnpm", "--dir", "platform/app", "run", "build:client"}},
			filepath.Join("platform", "app", "dist", "client")
	}
	return commandSpec{name: "env", args: []string{"-u", "CI", "pnpm", "--dir", "apps/ui", "run", "build"}},
		filepath.Join("apps", "ui", "dist", "client")
}

// BuildUIDist is Deps.BuildUI's real implementation: it builds the side's UI
// once per tree on a persistent worktree, keyed like its prepare, and every
// time on a worktree of the run's own.
func BuildUIDist(ctx context.Context, request UIBuildRequest) (UIBuild, error) {
	stack := request.Stack
	spec, relative := UIBuildCommand(stack.Layout)
	spec.dir = stack.Dir
	dir := filepath.Join(stack.Dir, relative)
	key, cached, err := uiBuildCached(ctx, stack, spec)
	if err != nil || cached {
		return UIBuild{Dir: dir, Cached: cached}, err
	}
	if err := runLogged(ctx, spec, request.Log); err != nil {
		return UIBuild{}, err
	}
	if !fileExists(filepath.Join(dir, "index.html")) {
		return UIBuild{}, fmt.Errorf("the build wrote no %s", filepath.Join(relative, "index.html"))
	}
	if key != "" {
		if err := recordBuilt(stack.Dir, key); err != nil {
			return UIBuild{}, err
		}
	}
	return UIBuild{Dir: dir}, nil
}

// uiBuildCached reports a persistent worktree whose last finished build had
// this code's key (reuse.go), and the key to record once this build finishes; a miss
// forgets the old key first.
func uiBuildCached(ctx context.Context, stack Stack, spec commandSpec) (string, bool, error) {
	if !stack.Persistent {
		return "", false, nil
	}
	_, relative := UIBuildCommand(stack.Layout)
	dir := filepath.Join(stack.Dir, relative)
	key := keyed(stack.Layout, spec, codeKey(ctx, execRunner, stack.Dir))
	if key != "" && builtKey(stack.Dir) == key && fileExists(filepath.Join(dir, "index.html")) {
		return key, true, nil
	}
	return key, false, recordBuilt(stack.Dir, "")
}

// runLogged runs spec with its output appended to log.
func runLogged(ctx context.Context, spec commandSpec, log string) error {
	if err := os.MkdirAll(filepath.Dir(log), 0o750); err != nil {
		return err
	}
	file, err := os.OpenFile(log, os.O_CREATE|os.O_WRONLY|os.O_APPEND, 0o600) // #nosec G304 -- the run's own log.
	if err != nil {
		return err
	}
	defer file.Close()
	if err := execRunner(ctx, spec, file); err != nil {
		return fmt.Errorf("%s %s: %w", spec.name, strings.Join(spec.args, " "), err)
	}
	return nil
}

// buildUI builds one live side's UI while its stack boots, so the runner can
// serve it instead of the dev server. A failed build leaves that side on its
// dev server, and says so.
func (run *session) buildUI(ctx context.Context, stack Stack) {
	build := run.request.Deps.BuildUI
	if build == nil || run.request.Options.DevUI {
		return
	}
	started := time.Now()
	log := filepath.Join(run.request.Options.RunDir, "logs", "ui-build-"+stack.Name+".log")
	built, err := build(ctx, UIBuildRequest{Stack: stack, Log: log})
	if err != nil {
		fmt.Fprintf(run.streams.Err, "%s: ui build failed, this side is captured from its dev server (log %s): %v\n", stack.Name, log, err)
		return
	}
	if run.staticDirs == nil {
		run.staticDirs = map[string]string{}
	}
	run.staticDirs[stack.Name] = built.Dir
	run.phases.since(stack.Name+" ui build", started)
	how := "built in " + time.Since(started).Round(time.Second).String()
	if built.Cached {
		how = "cached, this tree was built by an earlier run"
	}
	fmt.Fprintf(run.streams.Err, "%s: ui build: %s (%s)\n", stack.Name, how, built.Dir)
}

// uiMode names how the sides' UI is served, for the baseline key.
func uiMode(options Options) string {
	if options.DevUI {
		return "dev"
	}
	return "built"
}

// builtKey is the key a persistent worktree's last finished UI build recorded.
func builtKey(dir string) string {
	recorded, err := os.ReadFile(dir + uiBuiltSuffix) // #nosec G304 -- a file under the tool's own .visualdiff directory.
	if err != nil {
		return ""
	}
	return strings.TrimSpace(string(recorded))
}

// recordBuilt stores a finished build's key, or forgets it with "" so a build
// that fails half-way is never read as done.
func recordBuilt(dir, key string) error {
	if key == "" {
		if err := os.Remove(dir + uiBuiltSuffix); err != nil && !errors.Is(err, os.ErrNotExist) {
			return err
		}
		return nil
	}
	return os.WriteFile(dir+uiBuiltSuffix, []byte(key+"\n"), 0o600)
}

func fileExists(path string) bool {
	info, err := os.Stat(path)
	return err == nil && !info.IsDir()
}
