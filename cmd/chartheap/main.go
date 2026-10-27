// Command chartheap asserts the heap ceiling the langwatch chart gives its
// app and worker, rendering the chart once per scenario and naming every one that fails.
//
// Usage (helm on PATH, chart dependencies built):
//
//	go run ./cmd/chartheap [-chart charts/langwatch]
//
// Spec: specs/setup/helm-heap-ceiling.feature
package main

import (
	"flag"
	"fmt"
	"os"
	"path/filepath"

	"github.com/langwatch/langwatch/tools/chartheap"
)

// no-test: a thin loop over chartheap.Checks; tools/chartheap tests every check and the chart workflow runs this.
func main() {
	chart := flag.String("chart", "charts/langwatch", "path to the langwatch chart")
	flag.Parse()

	chartDir, err := filepath.Abs(*chart)
	if err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
	render := chartheap.HelmRender(chartDir)
	failures := 0
	for _, check := range chartheap.Checks {
		if err := runCheck(check, render); err != nil {
			fmt.Printf("FAIL %s: %v\n", check.Scenario, err)
			failures++
			continue
		}
		fmt.Printf("ok   %s\n", check.Scenario)
	}
	if failures > 0 {
		os.Exit(1)
	}
}

func runCheck(check chartheap.Check, render chartheap.Render) error {
	dir, err := os.MkdirTemp("", "chartheap")
	if err != nil {
		return err
	}
	defer os.RemoveAll(dir)
	return check.Run(render, dir)
}
