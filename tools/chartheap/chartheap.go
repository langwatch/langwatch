// Package chartheap checks the JavaScript heap ceiling the langwatch chart gives
// its worker: three quarters of the memory limit when there is one, nothing of
// the chart's when there is none, and an operator's NODE_OPTIONS winning over
// both.
//
// Spec: specs/setup/helm-worker-heap-ceiling.feature
package chartheap

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"io"
	"os"
	"os/exec"
	"path/filepath"

	"gopkg.in/yaml.v3"
)

// Ceiling is the NODE_OPTIONS value the chart renders for a worker with a memory limit.
const Ceiling = "--max-old-space-size-percentage=75"

// Render renders the chart's workers Deployment with the given values files.
type Render func(valuesFiles ...string) (string, error)

// Check is one scenario: its title, and the values it renders with and asserts.
type Check struct {
	Scenario string
	Values   string
	Assert   func(nodeOptions []string) error
}

// Checks are the spec's scenarios in its order; the operator's scenario is checked from both lists.
var Checks = []Check{
	{
		Scenario: "A worker with a memory limit gets a heap of three quarters of it",
		Values:   "workers:\n  resources:\n    limits: { memory: 4Gi }\n",
		Assert:   lastIs(Ceiling),
	},
	{
		Scenario: "With no memory limit the worker keeps Node's own heap size",
		Values:   "workers:\n  resources:\n    requests: { cpu: 250m, memory: 2Gi }\n    limits: null\n",
		Assert:   noneSet,
	},
	{
		Scenario: "The operator's own Node options win",
		Values:   "workers:\n  extraEnvs:\n    - name: NODE_OPTIONS\n      value: \"--max-old-space-size=3000\"\n",
		Assert:   onlyIs("--max-old-space-size=3000"),
	},
	{
		Scenario: "The operator's own Node options win",
		Values:   "app:\n  extraEnvs:\n    - name: NODE_OPTIONS\n      value: \"--max-old-space-size=2500\"\n",
		Assert:   onlyIs("--max-old-space-size=2500"),
	},
}

// Run renders the chart for one check, with its values written to a file under dir.
func (c Check) Run(render Render, dir string) error {
	path := filepath.Join(dir, "values.yaml")
	if err := os.WriteFile(path, []byte(c.Values), 0o600); err != nil {
		return err
	}
	manifest, err := render(path)
	if err != nil {
		return fmt.Errorf("render: %w", err)
	}
	options, err := NodeOptions(manifest)
	if err != nil {
		return err
	}
	return c.Assert(options)
}

// NodeOptions lists every NODE_OPTIONS value the workers container declares, in order;
// Kubernetes takes the last of duplicate names.
func NodeOptions(manifest string) ([]string, error) {
	decoder := yaml.NewDecoder(bytes.NewBufferString(manifest))
	for {
		var doc deployment
		err := decoder.Decode(&doc)
		if errors.Is(err, io.EOF) {
			return nil, errors.New("no Deployment in the rendered manifest")
		}
		if err != nil {
			return nil, fmt.Errorf("parse manifest: %w", err)
		}
		if doc.Kind == "Deployment" {
			return workerNodeOptions(doc), nil
		}
	}
}

type deployment struct {
	Kind string `yaml:"kind"`
	Spec struct {
		Template struct {
			Spec struct {
				Containers []struct {
					Name string `yaml:"name"`
					Env  []struct {
						Name  string `yaml:"name"`
						Value string `yaml:"value"`
					} `yaml:"env"`
				} `yaml:"containers"`
			} `yaml:"spec"`
		} `yaml:"template"`
	} `yaml:"spec"`
}

func workerNodeOptions(doc deployment) []string {
	var options []string
	for _, container := range doc.Spec.Template.Spec.Containers {
		for _, env := range container.Env {
			if env.Name == "NODE_OPTIONS" {
				options = append(options, env.Value)
			}
		}
	}
	return options
}

func lastIs(want string) func([]string) error {
	return func(options []string) error {
		if len(options) == 0 || options[len(options)-1] != want {
			return fmt.Errorf("want NODE_OPTIONS %q to win, got %q", want, options)
		}
		return nil
	}
}

// onlyIs asserts a single NODE_OPTIONS entry: server-side apply refuses a duplicate env name.
func onlyIs(want string) func([]string) error {
	return func(options []string) error {
		if len(options) != 1 || options[0] != want {
			return fmt.Errorf("want only NODE_OPTIONS %q, got %q", want, options)
		}
		return nil
	}
}

func noneSet(options []string) error {
	if len(options) > 0 {
		return fmt.Errorf("want no NODE_OPTIONS, got %q", options)
	}
	return nil
}

// HelmRender renders the workers Deployment of the chart at chartDir with helm on PATH,
// in the chart's own smoke preset.
func HelmRender(chartDir string) Render {
	return func(valuesFiles ...string) (string, error) {
		args := []string{
			"template", "lw", chartDir,
			"--set", "autogen.enabled=true",
			"--set", "app.dataplane.enabled=true",
			"--set", "langyagent.chartManaged=false",
			"--set", "workers.enabled=true",
			"--show-only", "templates/workers/deployment.yaml",
		}
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
