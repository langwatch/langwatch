// Package visualdiff boots two refs of this repository side by side, drives
// the same routes and the same flows against both with Playwright, and
// reports every screen whose rendering, console or network traffic differs.
// The Go half orchestrates and classifies; the Node half
// (tools/visualdiff/runner, @langwatch/visual-diff-runner) captures.
package visualdiff

import (
	"fmt"
	"os"
	"regexp"
	"slices"
	"sort"
	"strconv"
	"strings"

	"gopkg.in/yaml.v3"
)

// ConfigFile is the configuration the tool reads, relative to the repository
// root. It sits beside the tool it configures rather than at the root, which
// is why this is a path and not a bare name. Extending the coverage is editing
// that file, not the tool.
const ConfigFile = "tools/visualdiff/visualdiff.yaml"

// Viewport is one browser viewport, given on the command line or in the
// configuration as WIDTHxHEIGHT.
type Viewport struct {
	Width  int `json:"width"`
	Height int `json:"height"`
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
	Action   string            `json:"action"             yaml:"action"`
	Label    string            `json:"label,omitempty"    yaml:"label,omitempty"`
	Optional bool              `json:"optional,omitempty" yaml:"optional,omitempty"`
	With     map[string]string `json:"with,omitempty"     yaml:"with,omitempty"`
}

// Flow is a named sequence of steps captured on both refs.
type Flow struct {
	ID    string `json:"id"    yaml:"id"`
	Title string `json:"title" yaml:"title"`
	Steps []Step `json:"steps" yaml:"steps"`
}

// Settle carries the runner's event-driven settle knobs: the run waits for
// the in-flight request count to sit at zero for QuietMillis, and gives up at
// DeadlineMillis rather than hanging on a page that never goes quiet.
type Settle struct {
	QuietMillis    int `json:"quietMillis"    yaml:"quietMillis"`
	DeadlineMillis int `json:"deadlineMillis" yaml:"deadlineMillis"`
}

// Concurrency is how many pages each side captures on at once: routes spread
// over Routes pages, flows over Flows (a flow editing the project runs last,
// alone). Absent or zero is one page, the serial capture.
type Concurrency struct {
	Routes int `json:"routes,omitempty" yaml:"routes"`
	Flows  int `json:"flows,omitempty"  yaml:"flows"`
}

// Config is visualdiff.yaml.
type Config struct {
	Viewport    string      `yaml:"viewport"`
	Settle      Settle      `yaml:"settle"`
	Concurrency Concurrency `yaml:"concurrency"`
	Routes      []string    `yaml:"routes"`
	Flows       []Flow      `yaml:"flows"`
	// Fixtures fill a route's {name} placeholders with the ids the run seeds
	// deterministically, so a dynamic screen renders a real entity.
	Fixtures map[string]string `yaml:"fixtures"`
	Coverage CoverageConfig    `yaml:"coverage"`
	// Publish is what a run shows on its branch's pull request (publish.go).
	Publish PublishConfig `yaml:"publish"`

	// declared is the route list before Select narrowed it (DeclaredRoutes).
	declared []string
}

// RunnerActions are the actions tools/visualdiff/runner implements. A flow
// step naming anything else is refused when the configuration loads, before
// any worktree is created — a typo should cost a second, not a boot.
// Keep in step with runner/src/flows/registry.ts, which its own unit test
// pins to this list.
var RunnerActions = []string{
	// primitives
	"go", "click", "fill", "select", "dismissTour", "type", "wait", "expect",
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
	if err := config.validateRoutes(); err != nil {
		return err
	}
	return config.validateFlows()
}

// validateFlows refuses a flow declared twice or one the runner could not carry out.
func (config *Config) validateFlows() error {
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

var placeholder = regexp.MustCompile(`\{([^}]+)\}`)

// validateRoutes refuses a placeholder no fixture, static or seeded, fills and an exclusion
// with no reason: an unexplained gap is the thing coverage exists to stop.
func (config *Config) validateRoutes() error {
	for _, route := range config.Routes {
		for _, match := range placeholder.FindAllStringSubmatch(route, -1) {
			if _, ok := config.Fixtures[match[1]]; !ok && match[1] != "slug" && !slices.Contains(SeededFixtureNames, match[1]) {
				return fmt.Errorf("route %s: no fixture fills {%s}", route, match[1])
			}
		}
	}
	for _, exclusion := range config.Coverage.Excluded {
		if strings.TrimSpace(exclusion.Reason) == "" {
			return fmt.Errorf("coverage exclusion %s: give a reason", exclusion.Route)
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
		if step.Action == ExpectAction {
			if err := validateExpect(step.With); err != nil {
				return fmt.Errorf("flow %q step %d: %w", flow.ID, index, err)
			}
		}
	}
	return nil
}

// ExpectAction is the step that proves a flow's outcome (runner/src/flows/expect.ts).
const ExpectAction = "expect"

// expectForms are what an expect checks; exactly one per step.
var expectForms = []string{"text", "count", "url", "api"}

// expectOptions qualify the form: role/name scope a text, min/equals bound a
// count or an api field's length, field/contains pick into an api body.
var expectOptions = []string{"role", "name", "min", "equals", "field", "contains", "timeout"}

// validateExpect refuses an expect with no form, two forms, or a key the runner ignores.
func validateExpect(with map[string]string) error {
	forms := 0
	for key := range with {
		switch {
		case slices.Contains(expectForms, key):
			forms++
		case !slices.Contains(expectOptions, key):
			return fmt.Errorf("expect: unknown key %q (forms: %s; options: %s)",
				key, strings.Join(expectForms, ", "), strings.Join(expectOptions, ", "))
		}
	}
	if forms != 1 {
		return fmt.Errorf("expect: give exactly one of %s", strings.Join(expectForms, ", "))
	}
	return nil
}

// Select narrows the configuration to the named routes and flows, in the
// configuration's own order: naming either kind runs only what is named, so a
// re-check of one flow renders no route. Nothing named keeps everything.
// DeclaredRoutes still answers the full list, so coverage is never narrowed.
func (config *Config) Select(routes, flows []string) (*Config, error) {
	if len(routes)+len(flows) == 0 {
		return config, nil
	}
	narrowed := *config
	narrowed.declared = config.DeclaredRoutes()
	var unknown []string
	narrowed.Routes, unknown = pick(config.Routes, routes, func(route string) string { return route })
	if len(unknown) > 0 {
		return nil, fmt.Errorf("no such route: %s", strings.Join(sorted(unknown), ", "))
	}
	narrowed.Flows, unknown = pick(config.Flows, flows, func(flow Flow) string { return flow.ID })
	if len(unknown) > 0 {
		return nil, fmt.Errorf("no such flow: %s", strings.Join(sorted(unknown), ", "))
	}
	return &narrowed, nil
}

// DeclaredRoutes is every configured route, before any -routes narrowing.
func (config *Config) DeclaredRoutes() []string {
	if config.declared != nil {
		return config.declared
	}
	return config.Routes
}

// pick keeps the items whose name is wanted, and returns the wanted names no item has.
func pick[T any](items []T, names []string, name func(T) string) ([]T, []string) {
	wanted := map[string]bool{}
	for _, value := range names {
		wanted[strings.TrimSpace(value)] = true
	}
	var kept []T
	for _, item := range items {
		if wanted[name(item)] {
			kept = append(kept, item)
			delete(wanted, name(item))
		}
	}
	return kept, keys(wanted)
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
