// Package visualdiff boots two refs of this repository side by side, drives
// the same routes and the same flows against both with Playwright, and
// reports every screen whose rendering, console or network traffic differs.
// The Go half orchestrates and classifies; the Node half
// (tools/visualdiff/runner, @langwatch/visual-diff-runner) captures.
package visualdiff

import (
	"fmt"
	"os"
	"sort"
	"strconv"
	"strings"

	"gopkg.in/yaml.v3"
)

// ConfigFile is the repository-root configuration the tool reads. Extending
// the coverage is editing this file, not the tool.
const ConfigFile = "visualdiff.yaml"

// Viewport is one browser viewport, given on the command line or in the
// configuration as WIDTHxHEIGHT.
type Viewport struct {
	Width  int
	Height int
}

func (viewport Viewport) String() string {
	return strconv.Itoa(viewport.Width) + "x" + strconv.Itoa(viewport.Height)
}

// ParseViewport reads a WIDTHxHEIGHT viewport.
func ParseViewport(value string) (Viewport, error) {
	width, height, found := strings.Cut(strings.TrimSpace(value), "x")
	if !found {
		return Viewport{}, fmt.Errorf("viewport %q: want WIDTHxHEIGHT", value)
	}
	parsedWidth, widthErr := strconv.Atoi(width)
	parsedHeight, heightErr := strconv.Atoi(height)
	if widthErr != nil || heightErr != nil || parsedWidth <= 0 || parsedHeight <= 0 {
		return Viewport{}, fmt.Errorf("viewport %q: want two positive integers", value)
	}
	return Viewport{Width: parsedWidth, Height: parsedHeight}, nil
}

// Step is one action in a flow. Action names one of the runner's registered
// actions; With carries that action's arguments verbatim.
type Step struct {
	Action   string            `yaml:"action"`
	Label    string            `yaml:"label,omitempty"`
	Optional bool              `yaml:"optional,omitempty"`
	With     map[string]string `yaml:"with,omitempty"`
}

// Flow is a named sequence of steps captured on both refs.
type Flow struct {
	ID    string `yaml:"id"`
	Title string `yaml:"title"`
	Steps []Step `yaml:"steps"`
}

// Settle carries the runner's event-driven settle knobs: the run waits for
// the in-flight request count to sit at zero for QuietMillis, and gives up at
// DeadlineMillis rather than hanging on a page that never goes quiet.
type Settle struct {
	QuietMillis    int `yaml:"quietMillis"`
	DeadlineMillis int `yaml:"deadlineMillis"`
}

// Config is visualdiff.yaml.
type Config struct {
	Viewport string   `yaml:"viewport"`
	Settle   Settle   `yaml:"settle"`
	Routes   []string `yaml:"routes"`
	Flows    []Flow   `yaml:"flows"`
}

// RunnerActions are the actions tools/visualdiff/runner implements. A flow
// step naming anything else is refused when the configuration loads, before
// any worktree is created — a typo should cost a second, not a boot.
// Keep in step with runner/src/flows/registry.ts, which its own unit test
// pins to this list.
var RunnerActions = []string{
	// primitives
	"go", "click", "fill", "select", "dismissTour", "type", "wait",
	// named flow actions
	"signIn", "createAutomation", "createEvaluation", "sendTrace", "openTrace",
	"annotate", "editProjectSettings", "createPrompt", "createExperiment",
	"createPairwise", "createScenario", "createRunSet", "createDashboard",
}

func knownAction(name string) bool {
	for _, action := range RunnerActions {
		if action == name {
			return true
		}
	}
	return false
}

// LoadConfig reads and validates visualdiff.yaml.
func LoadConfig(path string) (*Config, error) {
	content, err := os.ReadFile(path) // #nosec G304 -- the path is the tool's own config, given by the operator.
	if err != nil {
		return nil, fmt.Errorf("read %s: %w", path, err)
	}
	config := &Config{}
	if err := yaml.Unmarshal(content, config); err != nil {
		return nil, fmt.Errorf("parse %s: %w", path, err)
	}
	if err := config.Validate(); err != nil {
		return nil, fmt.Errorf("%s: %w", path, err)
	}
	return config, nil
}

// Validate refuses a configuration the run could not honor.
func (config *Config) Validate() error {
	if len(config.Routes) == 0 && len(config.Flows) == 0 {
		return fmt.Errorf("no routes and no flows: nothing to capture")
	}
	if config.Viewport != "" {
		if _, err := ParseViewport(config.Viewport); err != nil {
			return err
		}
	}
	seen := map[string]bool{}
	for _, flow := range config.Flows {
		if seen[flow.ID] {
			return fmt.Errorf("flow %q: declared twice", flow.ID)
		}
		seen[flow.ID] = true
		if err := validateFlow(flow); err != nil {
			return err
		}
	}
	return nil
}

// validateFlow refuses a flow the runner could not carry out.
func validateFlow(flow Flow) error {
	if flow.ID == "" {
		return fmt.Errorf("a flow has no id")
	}
	if len(flow.Steps) == 0 {
		return fmt.Errorf("flow %q: no steps", flow.ID)
	}
	for index, step := range flow.Steps {
		if !knownAction(step.Action) {
			return fmt.Errorf("flow %q step %d: unknown action %q (known: %s)",
				flow.ID, index, step.Action, strings.Join(sorted(RunnerActions), ", "))
		}
	}
	return nil
}

// SelectFlows narrows the configuration to the named flows, in the
// configuration's own order. An empty selection keeps every flow.
func (config *Config) SelectFlows(names []string) (*Config, error) {
	if len(names) == 0 {
		return config, nil
	}
	wanted := map[string]bool{}
	for _, name := range names {
		wanted[strings.TrimSpace(name)] = true
	}
	narrowed := *config
	narrowed.Flows = nil
	for _, flow := range config.Flows {
		if wanted[flow.ID] {
			narrowed.Flows = append(narrowed.Flows, flow)
			delete(wanted, flow.ID)
		}
	}
	if len(wanted) > 0 {
		return nil, fmt.Errorf("no such flow: %s", strings.Join(sorted(keys(wanted)), ", "))
	}
	return &narrowed, nil
}

func keys(set map[string]bool) []string {
	out := make([]string, 0, len(set))
	for key := range set {
		out = append(out, key)
	}
	return out
}

func sorted(values []string) []string {
	out := append([]string(nil), values...)
	sort.Strings(out)
	return out
}
