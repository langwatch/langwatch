// Package chartheap checks the JavaScript heap ceiling the langwatch chart gives
// the app and the worker: three quarters of the memory limit when there is one,
// nothing of the chart's when there is none, and an operator's NODE_OPTIONS
// winning over both.
//
// Spec: specs/setup/helm-heap-ceiling.feature
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

// Ceiling is the NODE_OPTIONS value the chart renders for a process with a memory limit.
const Ceiling = "--max-old-space-size-percentage=75"

// The deployments a check renders.
const (
	App     = "templates/app/deployment.yaml"
	Workers = "templates/workers/deployment.yaml"
)

// Render renders one chart template with the given values files.
type Render func(template string, valuesFiles ...string) (string, error)

// Assertion checks the NODE_OPTIONS values one deployment declares, in order.
type Assertion func(nodeOptions []string) error

// Check is one scenario: its title, the values it renders with, and what each deployment must hold.
type Check struct {
	Scenario string
	Values   string
	Expect   map[string]Assertion
}

// Checks are the spec's scenarios in its order; the operator's scenario is checked from both lists.
var Checks = []Check{
	{
		Scenario: "The app and the worker with a memory limit get a heap of three quarters of it",
		Values: "app:\n  resources:\n    limits: { memory: 4Gi }\n" +
			"workers:\n  resources:\n    limits: { memory: 4Gi }\n",
		Expect: map[string]Assertion{App: onlyIs(Ceiling), Workers: lastIs(Ceiling)},
	},
	{
		Scenario: "With no memory limit the app and the worker keep Node's own heap size",
		Values: "app:\n  resources:\n    requests: { cpu: 250m, memory: 2Gi }\n    limits: null\n" +
			"workers:\n  resources:\n    requests: { cpu: 250m, memory: 2Gi }\n    limits: null\n",
		Expect: map[string]Assertion{App: noneSet, Workers: noneSet},
	},
	{
		Scenario: "The operator's own Node options win",
		Values:   "workers:\n  extraEnvs:\n    - name: NODE_OPTIONS\n      value: \"--max-old-space-size=3000\"\n",
		Expect:   map[string]Assertion{App: onlyIs(Ceiling), Workers: onlyIs("--max-old-space-size=3000")},
	},
	{
		Scenario: "The operator's own Node options win",
		Values:   "app:\n  extraEnvs:\n    - name: NODE_OPTIONS\n      value: \"--max-old-space-size=2500\"\n",
		Expect: map[string]Assertion{
			App:     onlyIs("--max-old-space-size=2500"),
			Workers: onlyIs("--max-old-space-size=2500"),
		},
	},
}

// Run renders each deployment the check names, with its values written to a file under dir.
func (c Check) Run(render Render, dir string) error {
	path := filepath.Join(dir, "values.yaml")
	if err := os.WriteFile(path, []byte(c.Values), 0o600); err != nil {
		return err
	}
	for _, template := range []string{App, Workers} {
		if err := c.runTemplate(render, template, path); err != nil {
			return fmt.Errorf("%s: %w", template, err)
		}
	}
	return nil
}

func (c Check) runTemplate(render Render, template, valuesPath string) error {
	manifest, err := render(template, valuesPath)
	if err != nil {
		return fmt.Errorf("render: %w", err)
	}
	options, err := NodeOptions(manifest)
	if err != nil {
		return err
	}
	return c.Expect[template](options)
}

// NodeOptions lists every NODE_OPTIONS value the Deployment's containers declare, in order;
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
			return containerNodeOptions(doc), nil
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

func containerNodeOptions(doc deployment) []string {
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

// HelmRender renders one template of the chart at chartDir with helm on PATH,
// in the chart's own smoke preset.
func HelmRender(chartDir string) Render {
	return func(template string, valuesFiles ...string) (string, error) {
		args := []string{
			"template", "lw", chartDir,
			"--set", "autogen.enabled=true",
			"--set", "app.dataplane.enabled=true",
			"--set", "langyagent.chartManaged=false",
			"--set", "workers.enabled=true",
			"--show-only", template,
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
