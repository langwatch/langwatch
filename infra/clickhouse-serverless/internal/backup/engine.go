package backup

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"time"

	"go.uber.org/zap"
)

// Engine runs decisions against a Store.
type Engine struct {
	Store        Store
	Policy       Policy
	MaxBandwidth int64
	Log          *zap.Logger
	Now          func() time.Time
	// PollInterval is how often a backup in flight is checked.
	PollInterval time.Duration
	// PollErrorBudget is how long polling may fail in a row before the run
	// is given up as failed. The backup itself carries on on the server.
	PollErrorBudget time.Duration
}

// Outcome is how a run ended.
type Outcome string

const (
	Succeeded   Outcome = "succeeded"
	StoodDown   Outcome = "stood-down"
	Failed      Outcome = "failed"
	WouldRun    Outcome = "dry-run" // observe mode: decided, nothing done
	Interrupted Outcome = "interrupted"
)

// Result is one run.
type Result struct {
	Mode     Mode
	Decision Decision
	Outcome  Outcome
	Backup   Backup // the backup written or adopted, when there was one
	Started  time.Time
	Err      error
}

// Duration of the backup itself, as the server timed it.
func (r Result) Duration() time.Duration {
	if r.Backup.Start.IsZero() || r.Backup.End.IsZero() {
		return 0
	}
	return r.Backup.End.Sub(r.Backup.Start)
}

// RunOptions shape one run.
type RunOptions struct {
	Adopt  bool // wait for a same-mode backup in flight instead of failing
	DryRun bool // decide only
}

// Gather reads the State Decide needs. A failed read is an error, never an
// absent conflict: that is how an unreachable server becomes a green run.
func (e *Engine) Gather(ctx context.Context, now time.Time) (State, error) {
	if err := e.Store.FlushLogs(ctx); err != nil {
		e.Log.Warn("SYSTEM FLUSH LOGS failed; the base lookup may miss a backup that just completed", zap.Error(err))
	}
	var st State
	var err error
	if st.InFlight, err = e.Store.InFlight(ctx); err != nil {
		return st, err
	}
	if st.Created, err = e.Store.Created(ctx, now.Add(-e.Policy.BaseMaxAge())); err != nil {
		return st, err
	}
	if st.FullsEver, _, err = e.Store.Summary(ctx, Full); err != nil {
		return st, err
	}
	return st, nil
}

// Run takes one backup of mode, or decides not to.
func (e *Engine) Run(ctx context.Context, mode Mode, opts RunOptions) Result {
	now := e.Now()
	res := Result{Mode: mode, Started: now}
	st, err := e.Gather(ctx, now)
	if err != nil {
		res.Outcome, res.Err = Failed, err
		return res
	}
	d := Decide(mode, st, e.Policy, now, opts.Adopt)
	res.Decision = d
	if opts.DryRun {
		res.Outcome = WouldRun
		e.Log.Info("observe mode: decided, not acting", zap.String("mode", string(mode)), zap.String("action", string(d.Action)), zap.String("path", d.Path), zap.String("reason", d.Reason))
		return res
	}
	switch d.Action {
	case Fail:
		res.Outcome, res.Err = Failed, errors.New(d.Reason)
		return res
	case StandDown:
		res.Outcome = StoodDown
		e.Log.Info(d.Reason, zap.String("mode", string(mode)))
		return res
	case Adopt:
		e.Log.Info(d.Reason, zap.String("mode", string(mode)))
		return e.wait(ctx, res, d.Adopt.ID)
	}

	base := ""
	if d.Base != nil {
		base = d.Base.Path
	}
	stmt, err := BackupSQL(e.Policy.Database, d.Path, base, e.MaxBandwidth)
	if err != nil {
		res.Outcome, res.Err = Failed, err
		return res
	}
	fields := []zap.Field{zap.String("mode", string(mode)), zap.String("backup", d.Path), zap.Int64("max_backup_bandwidth", e.MaxBandwidth)}
	if d.Base != nil {
		fields = append(fields, zap.String("base", d.Base.Path), zap.String("chain_root", d.Root.Path))
	}
	e.Log.Info("starting backup", fields...)
	if err := e.Store.Exec(ctx, stmt); err != nil {
		res.Outcome, res.Err = Failed, fmt.Errorf("starting backup %s: %w", d.Path, err)
		return res
	}
	return e.wait(ctx, res, d.Path)
}

// wait polls id until it leaves CREATING_BACKUP. Ending ctx stops the
// wait only: the server goes on, and the next start adopts it.
func (e *Engine) wait(ctx context.Context, res Result, id string) Result {
	interval := e.PollInterval
	if interval == 0 {
		interval = 5 * time.Second
	}
	budget := e.PollErrorBudget
	if budget == 0 {
		budget = 5 * time.Minute
	}
	var failingSince time.Time
	for {
		b, found, err := e.Store.Status(ctx, id)
		now := e.Now()
		switch {
		case err != nil:
			if ctx.Err() != nil {
				break
			}
			if failingSince.IsZero() {
				failingSince = now
			}
			if now.Sub(failingSince) >= budget {
				res.Outcome, res.Err = Failed, fmt.Errorf("lost track of backup %s for %s: %w", id, budget, err)
				return res
			}
			e.Log.Warn("polling backup failed, retrying", zap.String("id", id), zap.Error(err))
		case !found:
			res.Outcome, res.Err = Failed, fmt.Errorf("backup %s is in neither system.backups nor system.backup_log; the server may have restarted mid-backup", id)
			return res
		default:
			failingSince = time.Time{}
			res.Backup = b
			switch b.Status {
			case "BACKUP_CREATED", "RESTORED":
				res.Outcome = Succeeded
				return res
			case "CREATING_BACKUP", "RESTORING":
				if now.Sub(b.Start) > time.Duration(e.Policy.StaleHours)*time.Hour {
					res.Outcome, res.Err = Failed, fmt.Errorf("backup %s still %s after %dh, past STALE_BACKUP_HOURS", id, b.Status, e.Policy.StaleHours)
					return res
				}
			default:
				res.Outcome, res.Err = Failed, fmt.Errorf("%s %s: %s", id, b.Status, firstLine(b.Error))
				return res
			}
		}
		select {
		case <-ctx.Done():
			res.Outcome, res.Err = Interrupted, ctx.Err()
			return res
		case <-time.After(interval):
		}
	}
}

func firstLine(s string) string {
	s, _, _ = strings.Cut(strings.TrimSpace(s), "\n")
	if s == "" {
		return "no error reported"
	}
	return s
}

// CheckRestore refuses a restore without confirmation or an exact name;
// "latest" is not one: a restore always names the backup it means.
func CheckRestore(path string, confirm bool) error {
	switch {
	case !confirm:
		return errors.New("restore overwrites data: pass --confirm (or CONFIRM_RESTORE=yes) to proceed")
	case path == "":
		return errors.New("name the backup to restore (--name or BACKUP_NAME); list them with `ch-config backup list`")
	case strings.EqualFold(strings.TrimRight(path, "/"), "latest"):
		return errors.New("explicit backup name required, 'latest' is not allowed; list them with `ch-config backup list`")
	}
	return ValidPath(path)
}

// Restore restores db from path, after CheckRestore.
func (e *Engine) Restore(ctx context.Context, path string, confirm bool) Result {
	res := Result{Started: e.Now()}
	if err := CheckRestore(path, confirm); err != nil {
		res.Outcome, res.Err = Failed, err
		return res
	}
	id := "restore_" + strings.NewReplacer("/", "_", ".", "_").Replace(strings.TrimRight(path, "/")) + "_" + res.Started.UTC().Format(nameTimeLayout)
	stmt, err := RestoreSQL(e.Policy.Database, path, id)
	if err != nil {
		res.Outcome, res.Err = Failed, err
		return res
	}
	e.Log.Info("starting restore", zap.String("backup", path), zap.String("database", e.Policy.Database))
	if err := e.Store.Exec(ctx, stmt); err != nil {
		res.Outcome, res.Err = Failed, fmt.Errorf("starting restore of %s: %w", path, err)
		return res
	}
	// A restore may take longer than any backup; poll without a stale cutoff.
	p := e.Policy
	e2 := *e
	e2.Policy.StaleHours = max(p.StaleHours, 24*365)
	return e2.wait(ctx, res, id)
}
