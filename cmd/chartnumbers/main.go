// Command chartnumbers asserts the langyagent chart renders whole numbers from
// a values file as digits, never "1.8e+07" (issue #9906).
//
// Usage (helm on PATH):
//
//	go run ./cmd/chartnumbers [-chart charts/langyagent]
package main

import (
	"flag"
	"fmt"
	"os"
	"path/filepath"

	"github.com/langwatch/langwatch/tools/chartnumbers"
)

// no-test: a thin loop over chartnumbers.Checks; tools/chartnumbers tests every check and the chart workflow runs this.
func main() {
	chart := flag.String("chart", "charts/langyagent", "path to the langyagent chart")
	flag.Parse()

	chartDir, err := filepath.Abs(*chart)
	if err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
	render := chartnumbers.HelmRender(chartDir)
	failures := 0
	for _, check := range chartnumbers.Checks {
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

func runCheck(check chartnumbers.Check, render chartnumbers.Render) error {
	dir, err := os.MkdirTemp("", "chartnumbers")
	if err != nil {
		return err
	}
	defer os.RemoveAll(dir)
	return check.Run(render, dir)
}
