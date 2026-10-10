package visualdiff

import (
	"bytes"
	"context"
	"errors"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func twoReadyStacks() *fakeHavenRunner {
	return &fakeHavenRunner{readyStacks: map[string]string{
		HavenSlug(testRunID, "base"):      "https://app.visualdiff-" + testRunID + "-base.langwatch.localhost",
		HavenSlug(testRunID, "candidate"): "https://app.visualdiff-" + testRunID + "-candidate.langwatch.localhost",
	}}
}

// commandIndex is where the first recorded command matching want sits, or -1.
func commandIndex(commands []commandSpec, want func(commandSpec) bool) int {
	for index, spec := range commands {
		if want(spec) {
			return index
		}
	}
	return -1
}

// @scenario "The base boots the moment it is prepared, while the candidate prepares"
func TestTheBaseBootsTheMomentItIsPrepared(t *testing.T) {
	t.Run("given both sides boot live on haven", func(t *testing.T) {
		fake := twoReadyStacks()
		run := havenTestSession(fake, time.Minute)
		run.request.Deps.Layout = func(string) (Layout, error) { return LayoutModular, nil }
		var built []string
		run.request.Deps.BuildUI = func(_ context.Context, request UIBuildRequest) (UIBuild, error) {
			built = append(built, request.Stack.Name)
			return UIBuild{Dir: filepath.Join(request.Stack.Dir, "apps", "ui", "dist", "client")}, nil
		}
		if err := run.bringUpHaven(context.Background()); err != nil {
			t.Fatalf("bringUpHaven: %v", err)
		}
		baseDir, candidateDir := run.plan.Base.Dir, run.plan.Candidate.Dir

		t.Run("then the base's haven up runs before the candidate's worktree is even added", func(t *testing.T) {
			baseUp := commandIndex(fake.commands, func(spec commandSpec) bool {
				return spec.name == "haven" && spec.dir == baseDir && len(spec.args) > 0 && spec.args[0] == "up"
			})
			candidateAdd := commandIndex(fake.commands, func(spec commandSpec) bool {
				return strings.Contains(argv(spec), "worktree add") && strings.Contains(argv(spec), candidateDir)
			})
			if baseUp < 0 || candidateAdd < 0 || baseUp > candidateAdd {
				t.Fatalf("base haven up at %d, candidate worktree add at %d:\n%s", baseUp, candidateAdd, strings.Join(argvList(fake.commands), "\n"))
			}
		})

		t.Run("and each side's UI is built and handed to the runner", func(t *testing.T) {
			if strings.Join(built, ",") != "base,candidate" {
				t.Fatalf("built %v, want base then candidate", built)
			}
			if run.staticDirs["candidate"] == "" || run.staticDirs["base"] == "" {
				t.Fatalf("staticDirs = %v", run.staticDirs)
			}
		})
	})
}

// @scenario "Each side is captured from a production build of its UI, or from its dev server when that fails"
func TestASideWhoseBuildFailsStaysOnItsDevServer(t *testing.T) {
	t.Run("given the base's UI build fails", func(t *testing.T) {
		fake := twoReadyStacks()
		run := havenTestSession(fake, time.Minute)
		run.request.Deps.Layout = func(string) (Layout, error) { return LayoutMonolith, nil }
		run.request.Deps.BuildUI = func(_ context.Context, request UIBuildRequest) (UIBuild, error) {
			if request.Stack.Name == "base" {
				return UIBuild{}, errors.New("vite build exited 1")
			}
			return UIBuild{Dir: "/built/candidate"}, nil
		}
		var log bytes.Buffer
		run.streams.Err = &log
		if err := run.bringUpHaven(context.Background()); err != nil {
			t.Fatalf("bringUpHaven: %v", err)
		}

		t.Run("then the base stays on its dev server and the run log says so", func(t *testing.T) {
			if run.staticDirs["base"] != "" {
				t.Fatalf("base static dir = %q, want none", run.staticDirs["base"])
			}
			if !strings.Contains(log.String(), "base: ui build failed, this side is captured from its dev server") {
				t.Fatalf("log lacks the fallback line:\n%s", log.String())
			}
		})

		t.Run("and a base captured from its dev server is never cached as a built baseline", func(t *testing.T) {
			var out bytes.Buffer
			run.streams.Err = &out
			run.cacheBaseline(Baseline{Dir: t.TempDir()}, RunnerStream{})
			if !strings.Contains(out.String(), "not cached, the base was captured from its dev server") {
				t.Fatalf("cacheBaseline said %q", out.String())
			}
		})
	})

	t.Run("given -dev-ui", func(t *testing.T) {
		fake := twoReadyStacks()
		run := havenTestSession(fake, time.Minute)
		run.request.Options.DevUI = true
		run.request.Deps.Layout = func(string) (Layout, error) { return LayoutModular, nil }
		calls := 0
		run.request.Deps.BuildUI = func(context.Context, UIBuildRequest) (UIBuild, error) {
			calls++
			return UIBuild{Dir: "/x"}, nil
		}
		if err := run.bringUpHaven(context.Background()); err != nil {
			t.Fatalf("bringUpHaven: %v", err)
		}
		t.Run("then nothing is built and the baseline key says so", func(t *testing.T) {
			if calls != 0 {
				t.Fatalf("BuildUI called %d times", calls)
			}
			if uiMode(run.request.Options) != "dev" || uiMode(Options{}) != "built" {
				t.Fatal("uiMode does not name the serving mode")
			}
		})
	})

	t.Run("given each layout", func(t *testing.T) {
		t.Run("then the build is apps/ui's on a modular tree and platform/app's client on a monolith", func(t *testing.T) {
			modular, modularDir := UIBuildCommand(LayoutModular)
			monolith, monolithDir := UIBuildCommand(LayoutMonolith)
			if argv(modular) != "env -u CI pnpm --dir apps/ui run build" || modularDir != filepath.Join("apps", "ui", "dist", "client") {
				t.Fatalf("modular: %s -> %s", argv(modular), modularDir)
			}
			if argv(monolith) != "env -u CI pnpm --dir platform/app run build:client" || monolithDir != filepath.Join("platform", "app", "dist", "client") {
				t.Fatalf("monolith: %s -> %s", argv(monolith), monolithDir)
			}
		})
	})
}

// @scenario "Every run.log line carries its time, and a machine that may sleep is warned about"
func TestEveryRunLogLineCarriesItsTime(t *testing.T) {
	t.Run("given lines written in pieces", func(t *testing.T) {
		var out bytes.Buffer
		clock := time.Date(2026, 9, 28, 13, 31, 43, 250_000_000, time.UTC)
		writer := newStampedWriter(&out, func() time.Time { return clock })
		for _, piece := range []string{"base: prepare", ": ok\ncandidate: ", "ready\n"} {
			if _, err := writer.Write([]byte(piece)); err != nil {
				t.Fatal(err)
			}
		}
		t.Run("then each line opens with one timestamp", func(t *testing.T) {
			want := "13:31:43.250 base: prepare: ok\n13:31:43.250 candidate: ready\n"
			if out.String() != want {
				t.Fatalf("got %q, want %q", out.String(), want)
			}
		})
	})

	t.Run("given a machine on battery in Low Power Mode", func(t *testing.T) {
		battery := "Now drawing from 'Battery Power'\n -InternalBattery-0 48%; discharging\n"
		settings := "System-wide power settings:\nCurrently in use:\n lowpowermode         1\n sleep                1\n"
		t.Run("then both are warned about", func(t *testing.T) {
			warnings := PowerWarnings(battery, settings)
			if len(warnings) != 2 {
				t.Fatalf("warnings = %v", warnings)
			}
		})
		t.Run("and a machine on AC power with Low Power Mode off is not", func(t *testing.T) {
			if warnings := PowerWarnings("Now drawing from 'AC Power'\n", " lowpowermode         0\n"); len(warnings) != 0 {
				t.Fatalf("warnings = %v", warnings)
			}
		})
	})
}
