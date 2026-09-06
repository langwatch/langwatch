package cmd

import (
	"bufio"
	"context"
	"fmt"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
	"syscall"
	"time"

	"github.com/langwatch/langwatch/tools/thuishaven/app"
)

// runPlay is `haven play [pr]`: run a PR in a throwaway sandbox with its own
// checkout, its own databases, and its own hostname - and destroy all of it
// when the user quits. The opposite contract to `haven up`, where quitting
// detaches. The flow: resolve the PR (picker when no argument), pass the
// trust gate, disclose the destruction contract, check out, record the
// sandbox, launch, attach the log view, tear down. Teardown is deferred so
// SIGINT/SIGTERM (the root signal context) and panics still run it; a hard
// kill leaves the record behind for `haven clean` to finish the job.
func runPlay(ctx context.Context, d deps, inv invocation) error {
	if _, err := exec.LookPath("gh"); err != nil {
		return fmt.Errorf("the GitHub CLI `gh` is required - install it (https://cli.github.com) and run `gh auth login`")
	}
	// The preset is checked before the PR is even resolved: a typo should cost a
	// line of output, not a checkout, a container set, and a trust prompt.
	preset := inv.value("--seed")
	if err := app.ValidateSeedPreset(preset); err != nil {
		return err
	}
	ref := ""
	if len(inv.args) > 0 {
		ref = inv.args[0]
	}
	if ref == "" {
		if d.isAgent || !stdoutIsTTY() {
			return fmt.Errorf("haven play needs a PR in agent mode: pass a number or URL (the picker needs a terminal)")
		}
		number, picked, err := pickOpenPR(ctx, d.worktree)
		if err != nil {
			return err
		}
		if !picked {
			return nil
		}
		ref = strconv.Itoa(number)
	}

	pr, err := app.ResolvePlayPR(ctx, d.worktree, ref)
	if err != nil {
		return err
	}

	// The trust gate runs BEFORE anything is checked out. On a same-repo PR every
	// commit author and committer must have write access; on a fork, where commit
	// attribution is chosen by the PR author and proves nothing, only commits
	// carrying a GitHub-verified signature from someone with write access count.
	// Otherwise the user must accept the risk explicitly - interactively in a
	// terminal, via --allow-untrusted in agent mode (no prompt to answer there).
	untrusted, err := app.CollectUntrustedPlayAuthors(ctx, d.worktree, pr.Number, pr.IsCrossRepository)
	if err != nil {
		return err
	}
	switch app.DecidePlayTrust(len(untrusted), d.isAgent, inv.has("--allow-untrusted")) {
	case app.PlayFail:
		return app.PlayTrustError(untrusted)
	case app.PlayPrompt:
		if !confirmUntrustedPlay(untrusted, pr.Number) {
			fmt.Println("aborted - nothing was checked out")
			return nil
		}
	case app.PlayProceed:
		// The flag skips the two interactive steps, but not the disclosure they
		// carry: whoever passed it should still see what it bought, and an agent
		// driving haven leaves that line in its log for a human to read later.
		if len(untrusted) > 0 {
			fmt.Printf("⚠ --allow-untrusted: running code from authors without write access: %s\n",
				strings.Join(untrusted, ", "))
			fmt.Print(app.PlayUntrustedExposure())
		}
	}

	fmt.Print(app.PlayDisclosure(pr.Number))

	checkout := app.PlayCheckoutDir(havenHome(), pr.Number)
	// Record the sandbox BEFORE creating anything, so a death at any later
	// point leaves it discoverable and reapable by `haven clean`.
	rec := app.PlayRecord{
		Number:    pr.Number,
		Slug:      app.PlaySlug(pr.Number),
		PID:       os.Getpid(),
		Checkout:  checkout,
		RepoRoot:  gitMainWorktree(d.worktree),
		CreatedAt: time.Now(),
	}
	if err := app.WritePlayRecord(havenHome(), rec); err != nil {
		return fmt.Errorf("recording the sandbox: %w", err)
	}

	// Teardown always runs - on quit, on error, on panic, on signal. The
	// context is detached from the (likely already cancelled) root context so
	// a Ctrl-C cannot cancel its own cleanup; the deadline bounds a wedged
	// docker/git so the terminal comes back.
	tornDown := false
	teardown := func() error {
		if tornDown {
			return nil
		}
		tornDown = true
		fmt.Printf("play over: destroying the pr-%d sandbox (its contract: nothing survives)\n", pr.Number)
		tctx, cancel := context.WithTimeout(context.WithoutCancel(ctx), 2*time.Minute)
		defer cancel()
		return d.orch.PlayTeardown(tctx, rec)
	}
	defer func() { _ = teardown() }()

	if err := app.EnsurePlayCheckout(ctx, d.worktree, pr.Number, checkout); err != nil {
		return err
	}

	// A human terminal gets the same attached log view as `haven up`, over a
	// backgrounded launcher. Agents and pipes run the launcher in-process with
	// plain streaming; Ctrl-C (or the driver killing us) ends it and the
	// deferred teardown still destroys everything.
	if d.isAgent || !stdoutIsTTY() {
		sandbox := app.PlaySandbox{
			Number: pr.Number, Checkout: checkout,
			LwDir: filepath.Join(checkout, "platform", "app"), Preset: preset,
		}
		if err := d.orch.PlayLaunch(ctx, sandbox); err != nil && ctx.Err() == nil {
			return err
		}
		return teardown()
	}
	child, err := startPlayLaunch(rec, preset)
	if err != nil {
		return err
	}
	// The launcher child now owns the sandbox's processes: point the record at
	// it so `haven clean` can stop the right process group after a hard death
	// of this parent.
	rec.PID = child.pid
	if err := app.WritePlayRecord(havenHome(), rec); err != nil {
		return fmt.Errorf("recording the sandbox launcher: %w", err)
	}
	if err := runPlayViewer(ctx, rec.Slug, d.sessionActions(rec.Slug)); err != nil {
		return err
	}
	return teardown()
}

// confirmUntrustedPlay is the interactive half of the trust gate.
func confirmUntrustedPlay(untrusted []string, number int) bool {
	return confirmUntrustedPlayVia(os.Stdin, os.Stdout, untrusted, number)
}

// confirmUntrustedPlayVia is that gate over explicit streams, so the two-step
// shape is testable without a terminal.
//
// Two steps, because they answer different questions and only the second one
// is expensive to answer by accident. The first names who wrote the code and
// takes a y/N, defaulting to no. The second discloses what running it grants —
// the developer's own account and shell environment, which no amount of
// container isolation around the PR's data takes back — and accepts only the
// PR's number typed out. A stranger's code should never be one keystroke away.
//
// Both steps read from one buffered reader: a second reader over the same
// stdin would discard whatever the first had already buffered, and the answer
// to step two is usually sitting in that buffer.
func confirmUntrustedPlayVia(r io.Reader, w io.Writer, untrusted []string, number int) bool {
	in := bufio.NewReader(r)

	fmt.Fprintf(w, "\n⚠ PR #%d has commits from authors WITHOUT write access to this repo:\n", number)
	for _, name := range untrusted {
		fmt.Fprintf(w, "    %s\n", name)
	}
	fmt.Fprintln(w, "  haven play will run their code on this machine (install, migrations, services).")
	fmt.Fprint(w, "  Run it anyway? [y/N] ")
	line, err := in.ReadString('\n')
	if err != nil && line == "" {
		return false
	}
	switch strings.ToLower(strings.TrimSpace(line)) {
	case "y", "yes":
	default:
		return false
	}

	fmt.Fprintf(w, "\n%s", app.PlayUntrustedExposure())
	fmt.Fprint(w, app.PlayConfirmationPrompt(number))
	typed, err := in.ReadString('\n')
	if err != nil && typed == "" {
		return false
	}
	return app.PlayConfirmationAccepted(typed, number)
}

// playChild describes the backgrounded sandbox launcher.
type playChild struct {
	pid int
}

// startPlayLaunch backgrounds the hidden `haven play-launch <n> [preset]` in
// the play checkout, streaming its combined output to the slug's log file - the
// same launcher shape as `haven up`'s detached mode, so the attached viewer and
// `haven logs` read it identically. It takes the sandbox record rather than its
// fields so the child can never be pointed at a different sandbox than the one
// teardown will destroy.
func startPlayLaunch(rec app.PlayRecord, preset string) (playChild, error) {
	logPath := stackLogPath(rec.Slug)
	if err := os.MkdirAll(filepath.Dir(logPath), 0o755); err != nil {
		return playChild{}, err
	}
	// haven's own source comes from the trusted checkout, never from the
	// sandbox's: that is the PR's tree, and it contains a cmd/haven of its own.
	root := trustedRepoRoot()
	argv := append(selfArgv(root, "play-launch"), playLaunchArgs(rec.Number, preset)...)
	cmd := exec.Command(argv[0], argv[1:]...)
	cmd.Dir = rec.Checkout
	cmd.Env = childEnvWithTrustedRoot(root)
	// Owner-only: the combined log captures seed output (admin password, tokens).
	f, ferr := os.OpenFile(logPath, os.O_CREATE|os.O_APPEND|os.O_WRONLY, 0o600)
	if ferr != nil {
		return playChild{}, fmt.Errorf("opening log file %s: %w", logPath, ferr)
	}
	if err := f.Chmod(0o600); err != nil {
		_ = f.Close()
		return playChild{}, fmt.Errorf("securing log file %s: %w", logPath, err)
	}
	cmd.Stdout, cmd.Stderr = f, f
	cmd.SysProcAttr = &syscall.SysProcAttr{Setsid: true}
	if err := cmd.Start(); err != nil {
		_ = f.Close()
		return playChild{}, err
	}
	_ = f.Close()
	go func() { _ = cmd.Wait() }() // reap if it exits while we are attached
	return playChild{pid: cmd.Process.Pid}, nil
}

// playLaunchArgs is the launcher's argument list. An empty preset is left off
// entirely rather than passed as "", so the launcher's own parse sees exactly
// what `haven play` was given.
func playLaunchArgs(number int, preset string) []string {
	argv := []string{strconv.Itoa(number)}
	if preset != "" {
		argv = append(argv, preset)
	}
	return argv
}

// runPlayLaunchCmd is the hidden `haven play-launch <n> [preset]`: the
// sandbox's backgrounded launcher process, spawned by `haven play` with cwd set
// to the play checkout. Internal - it is dispatchable but absent from help,
// like `daemon`.
func runPlayLaunchCmd(ctx context.Context, d deps, inv invocation) error {
	// The parser enforces a maximum number of positionals, never a minimum, and
	// this command is dispatchable by hand — so a bare `haven play-launch` would
	// index into an empty slice.
	if len(inv.args) == 0 {
		return fmt.Errorf("haven play-launch: a PR number is required")
	}
	number, err := strconv.Atoi(inv.args[0])
	if err != nil || number <= 0 {
		return fmt.Errorf("haven play-launch: %q is not a PR number", inv.args[0])
	}
	preset := ""
	if len(inv.args) > 1 {
		preset = inv.args[1]
	}
	return d.orch.PlayLaunch(ctx, app.PlaySandbox{
		Number: number, Checkout: d.worktree, LwDir: d.lwDir, Preset: preset,
	})
}
