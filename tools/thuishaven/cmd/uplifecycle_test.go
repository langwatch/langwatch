package cmd

import (
	"os"
	"slices"
	"testing"
)

// `haven up` has three presentations and one stack. The attached viewer takes
// the alt-screen, so it is only ever right for a human terminal: rendering it
// into `pnpm dev:haven | tee` would write escape codes into the pipe, and into
// an agent's stdout would bury the output it is reading.
//
// @scenario "A piped up streams in the foreground"
func TestAPipedUpStreamsInTheForeground(t *testing.T) {
	t.Run("given output piped rather than a terminal", func(t *testing.T) {
		r, w, err := os.Pipe()
		if err != nil {
			t.Fatalf("os.Pipe: %v", err)
		}
		defer func() { _ = r.Close(); _ = w.Close() }()

		saved := os.Stdout
		os.Stdout = w
		defer func() { os.Stdout = saved }()

		t.Run("when up decides how to present itself", func(t *testing.T) {
			if stdoutIsTTY() {
				t.Fatal("a pipe was reported as a terminal; the rest of this cannot mean anything")
			}
			if upRunsAttached(false, stdoutIsTTY()) {
				t.Error("a piped up took the attached viewer — the alt-screen would land in the pipe")
			}
		})
	})

	t.Run("given a human terminal", func(t *testing.T) {
		t.Run("when up decides how to present itself", func(t *testing.T) {
			if !upRunsAttached(false, true) {
				t.Error("a terminal must get the attached view, so quitting it detaches instead of stopping the stack")
			}
		})
	})

	// An agent reads stdout. It gets the plain foreground stream even on a
	// terminal, because a terminal is not what makes the viewer wrong for it.
	t.Run("given agent mode on a terminal", func(t *testing.T) {
		t.Run("when up decides how to present itself", func(t *testing.T) {
			if upRunsAttached(true, true) {
				t.Error("agent mode took the attached viewer; it streams plainly")
			}
		})
	})
}

// Attached and detached are the same stack: `haven up` backgrounds the identical
// child that `haven up -d` does and merely attaches a viewer on top. That is
// what makes `haven logs` unable to tell them apart — there is no second
// logging path that could drift out of step with the first.
//
// @scenario "A detached up logs the same as an attached one"
func TestDetachedAndAttachedUpRunTheIdenticalChild(t *testing.T) {
	const root = "/home/dev/langwatch"

	t.Run("given a detached up carrying selection deltas", func(t *testing.T) {
		t.Run("when the child's argv is built", func(t *testing.T) {
			argv := detachedUpArgv(root, []string{"-d", "+langy", "--watch"})

			// Passing the detach flag on would have the child background itself,
			// and that child background itself, without end.
			if slices.Contains(argv, "-d") || slices.Contains(argv, "--detach") {
				t.Errorf("argv = %q, want the detach flag consumed here rather than handed to the child", argv)
			}
			for _, want := range []string{"+langy", "--watch"} {
				if !slices.Contains(argv, want) {
					t.Errorf("argv = %q, want it to carry %q through to the child", argv, want)
				}
			}
			if !slices.Contains(argv, "up") {
				t.Errorf("argv = %q, want the child to run up", argv)
			}
		})
	})

	t.Run("given the same up run attached and detached", func(t *testing.T) {
		t.Run("when both children's argv are built", func(t *testing.T) {
			attached := detachedUpArgv(root, []string{"+langy"})
			detached := detachedUpArgv(root, []string{"-d", "+langy"})

			if !slices.Equal(attached, detached) {
				t.Errorf("attached child %q and detached child %q differ; their captures could too", attached, detached)
			}
		})
	})

	t.Run("given a detached up with nothing but the flag", func(t *testing.T) {
		t.Run("when the child's argv is built", func(t *testing.T) {
			argv := detachedUpArgv(root, []string{"--detach"})
			plain := detachedUpArgv(root, nil)

			if !slices.Equal(argv, plain) {
				t.Errorf("argv = %q, want it identical to a plain up %q", argv, plain)
			}
		})
	})
}
