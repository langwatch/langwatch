package main

import (
	"fmt"
	"os"

	"go.uber.org/zap"

	"github.com/langwatch/langwatch/clickhouse-serverless/internal/config"
	"github.com/langwatch/langwatch/clickhouse-serverless/internal/render"
)

func main() {
	if len(os.Args) < 3 || os.Args[1] != "generate" {
		fmt.Fprintf(os.Stderr, "Usage: ch-config generate <output-dir>\n")
		os.Exit(1)
	}
	outputDir := os.Args[2]

	log, err := zap.NewProduction()
	if err != nil {
		fmt.Fprintf(os.Stderr, "failed to create logger: %v\n", err)
		os.Exit(1)
	}
	defer log.Sync()

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
