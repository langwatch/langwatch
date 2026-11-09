package main

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"os"
	"os/signal"
	"path/filepath"
	"sync"
	"syscall"
	"time"

	"go.uber.org/zap"

	"github.com/langwatch/langwatch/infra/clickhouse-serverless/internal/access"
	"github.com/langwatch/langwatch/infra/clickhouse-serverless/internal/backup"
	"github.com/langwatch/langwatch/infra/clickhouse-serverless/internal/bootstrap"
	"github.com/langwatch/langwatch/infra/clickhouse-serverless/internal/config"
	"github.com/langwatch/langwatch/infra/clickhouse-serverless/internal/render"
)

const usage = `Usage:
  ch-config generate <output-dir>   render config.d and users.d from env
  ch-config sidecar <output-dir>    keep the access users current (CLICKHOUSE_ACCESS_FILE)
                                    and run scheduled backups (BACKUP_SIDECAR)
  ch-config backup <run|restore|list> [flags]   one-shot backup commands
`

func main() {
	if len(os.Args) < 3 {
		fmt.Fprint(os.Stderr, usage)
		os.Exit(1)
	}

	log, err := zap.NewProduction()
	if err != nil {
		fmt.Fprintf(os.Stderr, "failed to create logger: %v\n", err)
		os.Exit(1)
	}
	defer log.Sync()

	switch os.Args[1] {
	case "generate":
		generate(log, os.Args[2])
	case "sidecar":
		sidecar(log, os.Args[2])
	case "backup":
		code := backupCommand(log, os.Args[2:], os.Stdout)
		_ = log.Sync()
		os.Exit(code)
	default:
		fmt.Fprint(os.Stderr, usage)
		os.Exit(1)
	}
}

func generate(log *zap.Logger, outputDir string) {
	input, err := config.Load()
	if err != nil {
		log.Fatal("failed to load configuration", zap.Error(err))
	}

	if err := input.Validate(); err != nil {
		log.Fatal("configuration validation failed", zap.Error(err))
	}

	computed := config.ComputeFromResources(input.CPU, input.RAMBytes, input)

	log.Info("generating ClickHouse configuration",
		zap.Int("cpu", input.CPU),
		zap.Int64("ram_bytes", input.RAMBytes),
		zap.String("output_dir", outputDir),
	)

	if err := render.RenderAll(log, input, computed, outputDir); err != nil {
		log.Fatal("failed to render configuration", zap.Error(err))
	}
}

// sidecar runs whichever of its jobs is configured: the access users
// (CLICKHOUSE_ACCESS_FILE) and scheduled backups (BACKUP_SIDECAR). Backups
// never end the process, which shares the pod with ClickHouse.
func sidecar(log *zap.Logger, outputDir string) {
	accessFile := os.Getenv("CLICKHOUSE_ACCESS_FILE")
	backupCfg, backupErr := backup.LoadConfig(os.Getenv)
	backups := backupCfg.Sidecar != backup.SidecarOff
	if accessFile == "" && !backups {
		log.Fatal("sidecar mode needs CLICKHOUSE_ACCESS_FILE or BACKUP_SIDECAR=run|observe")
	}

	ctx, stop := signal.NotifyContext(context.Background(), syscall.SIGTERM, syscall.SIGINT)
	defer stop()

	var wg sync.WaitGroup
	if backups {
		wg.Add(1)
		go func() {
			defer wg.Done()
			backup.RunSidecar(ctx, backupCfg, backupErr, log)
		}()
	}
	if accessFile != "" {
		runAccess(ctx, log, accessFile, outputDir)
	}
	wg.Wait()
}

// runAccess needs only the access file and the users.d it shares with the
// server: it never sees the default password or the server's sizing.
func runAccess(ctx context.Context, log *zap.Logger, accessFile, outputDir string) {
	listen := os.Getenv("CLICKHOUSE_ACCESS_LISTEN")
	if listen == "" {
		listen = "127.0.0.1:8124"
	}
	if err := access.ValidateListen(listen); err != nil {
		log.Fatal("invalid listen address", zap.Error(err))
	}

	verifier := &access.Verifier{Now: time.Now, Log: log}
	syncer := &access.Syncer{
		AccessFile: accessFile,
		UsersD:     filepath.Join(outputDir, "users.d"),
		Log:        log,
		Now:        time.Now,
		OnLoad:     func(f *access.File) { verifier.SetFile(ctx, f) },
	}

	server := &http.Server{
		Addr:              listen,
		Handler:           verifier.Handler(),
		ReadHeaderTimeout: 5 * time.Second,
		ReadTimeout:       10 * time.Second,
		WriteTimeout:      10 * time.Second,
		MaxHeaderBytes:    64 << 10,
	}
	go func() {
		if err := server.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
			log.Fatal("token verifier stopped", zap.Error(err))
		}
	}()
	// Dynamic-only: audit the server for password logins as the local admin.
	bootstrapDir := os.Getenv("CLICKHOUSE_ACCESS_BOOTSTRAP_DIR")
	if bootstrapDir == "" {
		bootstrapDir = bootstrap.DefaultDir
	}
	auditor := &access.Auditor{Q: &bootstrap.Client{Dir: bootstrapDir}, Log: log}
	go auditor.Run(ctx, access.AuditInterval, func() bool {
		_, err := os.Stat(filepath.Join(syncer.UsersD, bootstrap.UsersFileName))
		return err == nil
	})

	log.Info("access sidecar started", zap.String("access_file", accessFile), zap.String("listen", listen))
	syncer.Run(ctx)

	shutdown, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	_ = server.Shutdown(shutdown)
}
