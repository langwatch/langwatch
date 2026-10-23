package main

import (
	"context"
	"errors"
	"flag"
	"fmt"
	"io"
	"os"
	"os/signal"
	"syscall"
	"text/tabwriter"
	"time"

	"go.uber.org/zap"

	"github.com/langwatch/langwatch/infra/clickhouse-serverless/internal/backup"
	"github.com/langwatch/langwatch/infra/clickhouse-serverless/internal/chclient"
)

const backupUsage = `Usage:
  ch-config backup run [--mode full|incremental]       take one backup (BACKUP_MODE)
  ch-config backup restore --name <backup> --confirm   restore one (BACKUP_NAME, CONFIRM_RESTORE=yes)
  ch-config backup list [--limit N]                    list completed backups, newest first
`

// backupCommand runs a one-shot backup subcommand and returns the exit code.
func backupCommand(log *zap.Logger, args []string, stdout io.Writer) int {
	log = log.WithOptions(zap.AddStacktrace(zap.FatalLevel))
	if len(args) == 0 {
		fmt.Fprint(os.Stderr, backupUsage)
		return 2
	}
	fs := flag.NewFlagSet("backup "+args[0], flag.ContinueOnError)
	var act func(context.Context, *backup.Engine, *chclient.Client) int
	switch args[0] {
	case "run":
		modeFlag := fs.String("mode", envOr("BACKUP_MODE", string(backup.Full)), "full or incremental")
		if fs.Parse(args[1:]) != nil {
			return 2
		}
		mode, err := backup.ParseMode(*modeFlag)
		if err != nil {
			log.Error("invalid mode", zap.Error(err))
			return 1
		}
		act = func(ctx context.Context, e *backup.Engine, c *chclient.Client) int {
			if err := waitReady(ctx, log, c); err != nil {
				log.Error("ClickHouse not reachable", zap.String("url", c.BaseURL), zap.Error(err))
				return 1
			}
			return report(log, e.Run(ctx, mode, backup.RunOptions{}))
		}
	case "restore":
		name := fs.String("name", os.Getenv("BACKUP_NAME"), "exact backup name, as `backup list` prints it")
		confirm := fs.Bool("confirm", os.Getenv("CONFIRM_RESTORE") == "yes", "confirm the restore, which overwrites data")
		if fs.Parse(args[1:]) != nil {
			return 2
		}
		if err := backup.CheckRestore(*name, *confirm); err != nil {
			log.Error("restore refused", zap.Error(err))
			return 1
		}
		act = func(ctx context.Context, e *backup.Engine, c *chclient.Client) int {
			if err := waitReady(ctx, log, c); err != nil {
				log.Error("ClickHouse not reachable", zap.String("url", c.BaseURL), zap.Error(err))
				return 1
			}
			return report(log, e.Restore(ctx, *name, *confirm))
		}
	case "list":
		limit := fs.Int("limit", 100, "how many to list")
		if fs.Parse(args[1:]) != nil {
			return 2
		}
		act = func(ctx context.Context, e *backup.Engine, _ *chclient.Client) int {
			return list(ctx, log, e, *limit, stdout)
		}
	default:
		fmt.Fprint(os.Stderr, backupUsage)
		return 2
	}

	cfg, err := backup.LoadConfig(os.Getenv)
	if err != nil {
		log.Error("invalid backup configuration", zap.Error(err))
		return 1
	}
	creds, err := cfg.Credentials(true)
	if err != nil {
		log.Error("no ClickHouse login for backups", zap.Error(err))
		return 1
	}
	ctx, stop := signal.NotifyContext(context.Background(), syscall.SIGTERM, syscall.SIGINT)
	defer stop()
	client := &chclient.Client{BaseURL: cfg.BaseURL(), Creds: creds}
	engine := &backup.Engine{
		Store:        &backup.SQLStore{Client: client, Database: cfg.Database, Tables: backup.Tables{Cluster: cfg.Cluster}},
		Policy:       cfg.Policy(),
		MaxBandwidth: cfg.MaxBandwidth,
		Log:          log,
		Now:          time.Now,
	}
	return act(ctx, engine, client)
}

func list(ctx context.Context, log *zap.Logger, e *backup.Engine, limit int, stdout io.Writer) int {
	backups, err := e.Store.List(ctx, limit)
	if err != nil {
		log.Error("listing backups failed", zap.Error(err))
		return 1
	}
	tw := tabwriter.NewWriter(stdout, 0, 4, 2, ' ', 0)
	fmt.Fprintln(tw, "NAME\tMODE\tCOMPLETED\tSIZE_BYTES\tHOST")
	for _, b := range backups {
		mode := string(b.Mode)
		if mode == "" {
			mode = "-"
		}
		fmt.Fprintf(tw, "%s\t%s\t%s\t%d\t%s\n", b.Path, mode, b.End.Format(time.RFC3339), b.Bytes, b.Host)
	}
	_ = tw.Flush()
	return 0
}

// report logs a run and maps it to an exit code: only a written backup or
// a deliberate stand-down exits 0.
func report(log *zap.Logger, res backup.Result) int {
	fields := []zap.Field{zap.String("mode", string(res.Mode)), zap.String("outcome", string(res.Outcome)), zap.String("backup", res.Backup.Path)}
	switch res.Outcome {
	case backup.Succeeded:
		log.Info("completed", append(fields, zap.Duration("duration", res.Duration()), zap.Uint64("size_bytes", res.Backup.Bytes))...)
		return 0
	case backup.StoodDown:
		log.Info("nothing to do", append(fields, zap.String("reason", res.Decision.Reason))...)
		return 0
	case backup.Interrupted:
		log.Error("interrupted while waiting; the operation carries on on the server", append(fields, zap.Error(res.Err))...)
		return 1
	}
	log.Error("failed", append(fields, zap.Error(res.Err))...)
	return 1
}

// waitReady gives a server that is still starting 30 tries 5s apart, as
// the scripts did, so a CronJob that fires during a roll still runs.
func waitReady(ctx context.Context, log *zap.Logger, c *chclient.Client) error {
	var err error
	for attempt := 1; attempt <= 30; attempt++ {
		if err = c.Exec(ctx, "SELECT 1"); err == nil {
			return nil
		}
		var chErr *chclient.Error
		if errors.As(err, &chErr) {
			return err // it answered: a login or grant problem, not a start-up
		}
		log.Info("waiting for ClickHouse", zap.Int("attempt", attempt), zap.Error(err))
		select {
		case <-ctx.Done():
			return ctx.Err()
		case <-time.After(5 * time.Second):
		}
	}
	return err
}

func envOr(name, def string) string {
	if v := os.Getenv(name); v != "" {
		return v
	}
	return def
}
