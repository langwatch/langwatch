// Package chartnumbers checks that the langyagent chart renders a whole number
// from a values file as its digits. Helm loads a values-file number as float64,
// and Go prints 1e6 or more as "1.8e+07", which the agent refuses to parse at
// boot (issue #9906). `--set` parses numbers as int64, so every check goes
// through a values file, the chart's own values.yaml included.
package chartnumbers

import (
	"bytes"
	"context"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"strings"
)

// Render renders the chart with the given values files.
type Render func(valuesFiles ...string) (string, error)

// Check is one case: the values it renders with and the lines the render must hold.
type Check struct {
	Name   string
	Values string
	Want   []string
}

// large sets every numeric value the chart quotes to one million or more.
const large = `manager:
  maxWorkers: 1000000
  workerIdleMs: 3600000
  workerMaxAgeMs: 86400000
  readinessTimeoutMs: 1000000
extraConfig:
  LANGY_REAPER_INTERVAL_MS: 1000000
  LANGY_RATIO: 0.5
  LOG_FORMAT: json
service:
  annotations:
    example.com/budget: 2000000
    example.com/huge: 100000000000000000000
podLabels:
  generation: 3000000
`

// Checks are the cases cmd/chartnumbers and the tests run.
var Checks = []Check{
	{
		Name: "the chart defaults render as digits",
		Want: []string{
			`LANGY_WORKER_MAX_AGE_MS: "18000000"`,
			`LANGY_WORKER_IDLE_MS: "600000"`,
			`LANGY_READINESS_TIMEOUT_MS: "60000"`,
			`PORT: "8080"`,
		},
	},
	{
		Name:   "large values from a values file render as digits",
		Values: large,
		Want: []string{
			`LANGY_MAX_WORKERS: "1000000"`,
			`LANGY_WORKER_IDLE_MS: "3600000"`,
			`LANGY_WORKER_MAX_AGE_MS: "86400000"`,
			`LANGY_READINESS_TIMEOUT_MS: "1000000"`,
			`LANGY_REAPER_INTERVAL_MS: "1000000"`,
			`LANGY_RATIO: "0.5"`,
			`LOG_FORMAT: "json"`,
			`example.com/budget: "2000000"`,
			`example.com/huge: "100000000000000000000"`,
			`generation: "3000000"`,
		},
	},
	{
		Name:   "a string value renders unchanged",
		Values: "manager:\n  workerMaxAgeMs: \"18000000\"\n",
		Want:   []string{`LANGY_WORKER_MAX_AGE_MS: "18000000"`},
	},
}

var scientific = regexp.MustCompile(`"[0-9.]+e[+-][0-9]+"`)

// Run renders the check's values from a file under dir and reports every missing line.
func (c Check) Run(render Render, dir string) error {
	var files []string
	if c.Values != "" {
		path := filepath.Join(dir, "values.yaml")
		if err := os.WriteFile(path, []byte(c.Values), 0o600); err != nil {
			return err
		}
		files = append(files, path)
	}
	manifest, err := render(files...)
	if err != nil {
		return fmt.Errorf("render: %w", err)
	}
	return Verify(manifest, c.Want)
}

// Verify reports every wanted line the manifest lacks and any number in scientific notation.
func Verify(manifest string, want []string) error {
	lines := map[string]bool{}
	for _, line := range strings.Split(manifest, "\n") {
		lines[strings.TrimSpace(line)] = true
	}
	var problems []string
	for _, line := range want {
		if !lines[line] {
			problems = append(problems, "missing "+line)
		}
	}
	if found := scientific.FindAllString(manifest, -1); len(found) > 0 {
		problems = append(problems, "scientific notation "+strings.Join(found, ", "))
	}
	if len(problems) > 0 {
		return fmt.Errorf("%s", strings.Join(problems, "; "))
	}
	return nil
}

// HelmRender renders the chart at chartDir with helm on PATH.
func HelmRender(chartDir string) Render {
	return func(valuesFiles ...string) (string, error) {
		args := []string{"template", "numbers", chartDir}
		for _, file := range valuesFiles {
			args = append(args, "-f", file)
		}
		var stderr bytes.Buffer
		cmd := exec.CommandContext(context.Background(), "helm", args...)
		cmd.Stderr = &stderr
		out, err := cmd.Output()
		if err != nil {
			return "", fmt.Errorf("helm template: %w: %s", err, stderr.String())
		}
		return string(out), nil
	}
}
