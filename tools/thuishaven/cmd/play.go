package cmd

import (
	"bufio"
	"context"
	"fmt"
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

	// The trust gate runs BEFORE anything is checked out: every commit author
	// and committer on the PR must have write access, or the user must accept
	// the risk explicitly - interactively in a terminal, via --allow-untrusted
	// in agent mode (there is no prompt to answer there).
	untrusted, err := app.CollectUntrustedPlayAuthors(ctx, d.worktree, pr.Number)
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
		if len(untrusted) > 0 {
			fmt.Printf("⚠ --allow-untrusted: running code from authors without write access: %s\n",
				strings.Join(untrusted, ", "))
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
		if err := d.orch.PlayLaunch(ctx, pr.Number, checkout, filepath.Join(checkout, "langwatch")); err != nil && ctx.Err() == nil {
			return err
		}
		return teardown()
	}
	child, err := startPlayLaunch(pr.Number, checkout, rec.Slug)
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
	if err := runPlayViewer(ctx, rec.Slug); err != nil {
		return err
	}
	return teardown()
}

// confirmUntrustedPlay is the interactive half of the trust gate: it names the
// untrusted authors and requires an explicit yes. Default is no - Enter aborts.
func confirmUntrustedPlay(untrusted []string, number int) bool {
	fmt.Printf("\n⚠ PR #%d has commits from authors WITHOUT write access to this repo:\n", number)
	for _, name := range untrusted {
		fmt.Printf("    %s\n", name)
	}
	fmt.Println("  haven play will run their code on this machine (install, migrations, services).")
	fmt.Print("  Run it anyway? [y/N] ")
	line, err := bufio.NewReader(os.Stdin).ReadString('\n')
	if err != nil {
		return false
	}
	switch strings.ToLower(strings.TrimSpace(line)) {
	case "y", "yes":
		return true
	}
	return false
}

// playChild describes the backgrounded sandbox launcher.
type playChild struct {
	pid int
}

// startPlayLaunch backgrounds the hidden `haven play-launch <n>` in the play
// checkout, streaming its combined output to the slug's log file - the same
// launcher shape as `haven up`'s detached mode, so the attached viewer and
// `haven logs` read it identically.
func startPlayLaunch(number int, checkout, slug string) (playChild, error) {
	logPath := stackLogPath(slug)
	if err := os.MkdirAll(filepath.Dir(logPath), 0o755); err != nil {
		return playChild{}, err
	}
	argv := selfArgv(checkout, "play-launch")
	argv = append(argv, strconv.Itoa(number))
	cmd := exec.Command(argv[0], argv[1:]...)
	cmd.Dir = checkout
	cmd.Env = os.Environ()
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

// runPlayLaunchCmd is the hidden `haven play-launch <n>`: the sandbox's
// backgrounded launcher process, spawned by `haven play` with cwd set to the
// play checkout. Internal - it is dispatchable but absent from help, like
// `daemon`.
func runPlayLaunchCmd(ctx context.Context, d deps, inv invocation) error {
	number, err := strconv.Atoi(inv.args[0])
	if err != nil || number <= 0 {
		return fmt.Errorf("haven play-launch: %q is not a PR number", inv.args[0])
	}
	return d.orch.PlayLaunch(ctx, number, d.worktree, d.lwDir)
}
