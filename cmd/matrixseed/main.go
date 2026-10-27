// Command matrixseed seeds the control plane a gateway-matrix run booted and
// appends LW_PROJECT_API_KEY and one TEST_VK_<PROVIDER> per provider with
// credentials to $GITHUB_ENV, and sets the step output bootstrapped=true once
// LW_PROJECT_API_KEY is seeded. A provider with no credentials is skipped; a
// refusal from the control plane fails the step after the rest are seeded.
//
// Usage:
//
//	LANGWATCH_INSTANCE_ADMIN_API_KEY=... go run ./cmd/matrixseed [-base-url http://localhost:5560]
//
// Spec: specs/ci/gateway-matrix-seed.feature
package main

import (
	"context"
	"flag"
	"fmt"
	"os"

	"github.com/langwatch/langwatch/tools/matrixseed"
)

func main() {
	baseURL := flag.String("base-url", envOr("LW_BASE_URL", "http://localhost:5560"), "the control plane")
	envFile := flag.String("env-file", os.Getenv("GITHUB_ENV"), "the file the exports are appended to")
	outputFile := flag.String("output-file", os.Getenv("GITHUB_OUTPUT"), "the file the bootstrapped step output is appended to")
	flag.Parse()
	if *envFile == "" {
		fmt.Fprintln(os.Stderr, "matrixseed: no -env-file and no GITHUB_ENV to append the exports to")
		os.Exit(2)
	}

	result, err := matrixseed.Run(context.Background(), matrixseed.Options{
		BaseURL:          *baseURL,
		InstanceAdminKey: os.Getenv("LANGWATCH_INSTANCE_ADMIN_API_KEY"),
		Env:              os.Getenv,
	})
	if err != nil {
		fmt.Printf("::error::the gateway-matrix seed could not provision its project: %v\n", err)
		os.Exit(1)
	}
	if err := writeExports(*envFile, result.Exports); err != nil {
		fmt.Printf("::error::could not export the seeded keys: %v\n", err)
		os.Exit(1)
	}
	if err := writeBootstrapped(*outputFile); err != nil {
		fmt.Printf("::error::could not set the bootstrapped step output: %v\n", err)
		os.Exit(1)
	}
	matrixseed.Report(os.Stdout, result)
	if result.Err() != nil {
		os.Exit(1)
	}
}

func writeExports(path string, exports []matrixseed.Export) error {
	f, err := os.OpenFile(path, os.O_APPEND|os.O_CREATE|os.O_WRONLY, 0o600) //nolint:gosec // G304: the runner's own GITHUB_ENV path
	if err != nil {
		return err
	}
	if err := matrixseed.WriteExports(os.Stdout, f, exports); err != nil {
		_ = f.Close()
		return err
	}
	return f.Close()
}

// writeBootstrapped tells the job the project and its key exist, so the
// gateway and matrix steps have something to run against. No path, no output.
func writeBootstrapped(path string) error {
	if path == "" {
		return nil
	}
	f, err := os.OpenFile(path, os.O_APPEND|os.O_CREATE|os.O_WRONLY, 0o600) //nolint:gosec // G304: the runner's own GITHUB_OUTPUT path
	if err != nil {
		return err
	}
	if _, err := fmt.Fprintln(f, "bootstrapped=true"); err != nil {
		_ = f.Close()
		return err
	}
	return f.Close()
}

func envOr(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}
