// Command charts3region asserts the langwatch chart hands the awsS3 provider's
// region to every process carrying the S3 settings, and renders none when unset.
//
// Usage (helm on PATH, chart dependencies built):
//
//	go run ./cmd/charts3region [-chart charts/langwatch]
//
// Spec: specs/features/scenarios/externalize-event-byte-content.feature
package main

import (
	"flag"
	"fmt"
	"os"
	"path/filepath"

	"github.com/langwatch/langwatch/tools/charts3region"
)

// no-test: a thin loop over charts3region.Checks; tools/charts3region tests every check and the chart workflow runs this.
func main() {
	chart := flag.String("chart", "charts/langwatch", "path to the langwatch chart")
	flag.Parse()

	chartDir, err := filepath.Abs(*chart)
	if err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
	render := charts3region.HelmRender(chartDir)
	failures := 0
	for _, check := range charts3region.Checks {
		if err := runCheck(check, render); err != nil {
			fmt.Printf("FAIL %s: %v\n", check.Name, err)
			failures++
			continue
		}
		fmt.Printf("ok   %s\n", check.Name)
	}
	if failures > 0 {
		os.Exit(1)
	}
}

func runCheck(check charts3region.Check, render charts3region.Render) error {
	dir, err := os.MkdirTemp("", "charts3region")
	if err != nil {
		return err
	}
	defer os.RemoveAll(dir)
	return check.Run(render, dir)
}
