package main

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"os"
	"os/signal"
	"path/filepath"
	"syscall"
	"time"

	"go.uber.org/zap"

	"github.com/langwatch/langwatch/infra/clickhouse-serverless/internal/access"
	"github.com/langwatch/langwatch/infra/clickhouse-serverless/internal/config"
	"github.com/langwatch/langwatch/infra/clickhouse-serverless/internal/render"
)

const usage = `Usage:
  ch-config generate <output-dir>   render config.d and users.d from env
  ch-config sidecar <output-dir>    keep the access users current (CLICKHOUSE_ACCESS_FILE)
`

func main() {
	if len(os.Args) < 3 {
		fmt.Fprint(os.Stderr, usage)
		os.Exit(1)
	}
	outputDir := os.Args[2]

	log, err := zap.NewProduction()
	if err != nil {
		fmt.Fprintf(os.Stderr, "failed to create logger: %v\n", err)
		os.Exit(1)
	}
	defer log.Sync()

	switch os.Args[1] {
	case "generate":
		generate(log, outputDir)
	case "sidecar":
		sidecar(log, outputDir)
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

// sidecar needs only the access file and the users.d it shares with the
// server: it never sees the default password or the server's sizing.
func sidecar(log *zap.Logger, outputDir string) {
	accessFile := os.Getenv("CLICKHOUSE_ACCESS_FILE")
	if accessFile == "" {
		log.Fatal("CLICKHOUSE_ACCESS_FILE is required in sidecar mode")
	}
	listen := os.Getenv("CLICKHOUSE_ACCESS_LISTEN")
	if listen == "" {
		listen = "127.0.0.1:8124"
	}
	if err := access.ValidateListen(listen); err != nil {
		log.Fatal("invalid listen address", zap.Error(err))
	}

	ctx, stop := signal.NotifyContext(context.Background(), syscall.SIGTERM, syscall.SIGINT)
	defer stop()

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
	log.Info("access sidecar started", zap.String("access_file", accessFile), zap.String("listen", listen))
	syncer.Run(ctx)

	shutdown, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	_ = server.Shutdown(shutdown)
}
