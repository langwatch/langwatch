// Command chartpush pushes packaged prerelease charts to the artifacts ECR and
// writes each version and digest to the run summary, for the deploy to pin.
// helm must already be logged in to the registry. The copies are not signed:
// see prerelease-charts-oci.yml.
//
// Usage:
//
//	go run ./cmd/chartpush -registry <host> [-packages .oci-packages] <chart>...
//
// Spec: specs/ci/publish-prerelease-charts-to-ecr.feature
package main

import (
	"context"
	"flag"
	"fmt"
	"os"
	"os/exec"

	"github.com/langwatch/langwatch/tools/chartpush"
)

func main() {
	registry := flag.String("registry", "", "registry host, without a scheme")
	packages := flag.String("packages", ".oci-packages", "directory holding <chart>-<version>.tgz")
	flag.Parse()
	if *registry == "" || flag.NArg() == 0 {
		fmt.Fprintln(os.Stderr, "usage: chartpush -registry <host> [-packages dir] <chart>...")
		os.Exit(2)
	}

	results, err := chartpush.Push(context.Background(), chartpush.Options{
		Registry:    *registry,
		Charts:      flag.Args(),
		PackagesDir: *packages,
		Push:        helmPush,
	})
	for _, r := range results {
		fmt.Print(r.Output)
	}
	if writeErr := writeSummary(results); writeErr != nil {
		fmt.Fprintf(os.Stderr, "::error::could not write the run summary: %v\n", writeErr)
		os.Exit(1)
	}
	if err != nil {
		fmt.Printf("::error::%v\n", err)
		os.Exit(1)
	}
}

func helmPush(ctx context.Context, packagePath, ref string) (string, error) {
	out, err := exec.CommandContext(ctx, "helm", "push", packagePath, ref).CombinedOutput()
	return string(out), err
}

func writeSummary(results []chartpush.Result) error {
	path := os.Getenv("GITHUB_STEP_SUMMARY")
	if path == "" || len(results) == 0 {
		return nil
	}
	f, err := os.OpenFile(path, os.O_APPEND|os.O_CREATE|os.O_WRONLY, 0o600) //nolint:gosec // G703: the runner's own GITHUB_STEP_SUMMARY path
	if err != nil {
		return err
	}
	for _, r := range results {
		if _, err := fmt.Fprintln(f, r.SummaryLine()); err != nil {
			f.Close()
			return err
		}
	}
	return f.Close()
}
