// Package havenrun is what apidiff and visualdiff share to boot their
// instances as haven stacks instead of provisioning infrastructure by hand:
// slugs, the haven-command environment, argv for up/status/destroy/logs, and
// readiness from `haven status --json`. Each tool keeps its own command
// execution, on the `runner`/`commandSpec` pair its own boot pipeline uses.
package havenrun

import (
	"encoding/json"
	"fmt"
	"os/exec"
	"path/filepath"
	"strings"
	"time"

	"github.com/langwatch/langwatch/tools/thuishaven/domain"
)

// Command is the orchestrator binary every path in this package shells out
// to. Its presence on PATH is what selects the haven path over a tool's own
// port-based or compose-based one.
const Command = "haven"

// UILane and BackendLane name the two Node lanes haven supervises (see
// tools/thuishaven/domain/stack.go, Stack.Lanes). A caller names the lanes it
// needs ready; apidiff only ever needs the backend lane, visualdiff needs
// both because it drives a browser against the UI and seeds fixtures through
// the API on the same origin.
const (
	UILane      = "ui"
	BackendLane = "backend"
)

// AppService is the routed service name whose URL is the browser-facing
// origin: the UI, with the API served under /api on the same origin.
const AppService = "app"

// DefaultReadyPoll and DefaultFailureLogLines are the timings both callers'
// readiness loops use: a stack's boot is minutes of install, codegen,
// migrate and seed, so a second between questions is already generous, and
// forty lines is enough of a failed stack's backend log to name the failure
// without flooding the caller's own error.
const (
	DefaultReadyPoll       = time.Second
	DefaultFailureLogLines = 40
)

// OnPath reports whether the orchestrator is installed.
func OnPath() bool {
	_, err := exec.LookPath(Command)
	return err == nil
}

// Selected decides where the infrastructure comes from: haven is the default
// wherever it is installed, unless the caller opted out (-no-haven) or named
// an explicit alternative of its own (apidiff's three external servers, for
// example). A caller with no such alternative always passes false.
func Selected(onPath, noHaven, explicitAlternative bool) bool {
	return onPath && !noHaven && !explicitAlternative
}

// Slug names the haven stack one run's instance runs as: prefixed so it can
// never collide with a slug haven derives from a worktree's directory or
// branch, and scoped to both the run and the instance so two concurrent runs
// — or the two sides of one run — never share a stack.
func Slug(prefix, runID, instance string) string {
	return domain.SanitizeSlug(prefix + "-" + runID + "-" + instance)
}

// RunID derives a run's identity from its work root's base name (the
// timestamp directory both tools default to), sanitized to characters a
// slug can carry. Shared so "the same directory name produces the same run
// identity" holds for both callers, not just by convention.
func RunID(workRoot string) string {
	base := strings.ToLower(filepath.Base(filepath.Clean(workRoot)))
	var id strings.Builder
	for _, character := range base {
		if (character >= 'a' && character <= 'z') || (character >= '0' && character <= '9') {
			id.WriteRune(character)
			continue
		}
		id.WriteByte('_')
	}
	result := strings.Trim(id.String(), "_")
	if result == "" {
		return "run"
	}
	return result
}

// ManagedEnvKeys are the datastore addresses and identity variable every
// haven command's environment must never carry in from the caller's own
// shell: haven decides where a stack's data lives, and one of these
// inherited from the developer's own process is exactly the input that
// would point an instance at their data again.
var ManagedEnvKeys = []string{"DATABASE_URL", "CLICKHOUSE_URL", "REDIS_URL", "REDIS_DB_INDEX", "LANGWATCH_SLUG"}

// EnvOptions carries a caller's own additions to Env: extra keys to strip
// beyond ManagedEnvKeys, and extra "KEY=value" pairs to append after the
// slug (apidiff uses this for the throwaway instance-admin key both sides
// share; visualdiff needs neither).
type EnvOptions struct {
	ExtraManagedKeys []string
	Extra            []string
}

// Env composes one instance's haven-command environment: the inherited
// environment minus every managed key, plus LANGWATCH_SLUG and the caller's
// own extras.
func Env(inherit []string, slug string, options EnvOptions) []string {
	managed := map[string]bool{}
	for _, key := range ManagedEnvKeys {
		managed[key] = true
	}
	for _, key := range options.ExtraManagedKeys {
		managed[key] = true
	}
	env := make([]string, 0, len(inherit)+1+len(options.Extra))
	for _, entry := range inherit {
		name, _, _ := strings.Cut(entry, "=")
		if managed[name] {
			continue
		}
		env = append(env, entry)
	}
	env = append(env, "LANGWATCH_SLUG="+slug)
	return append(env, options.Extra...)
}

// UpArgs brings one instance's stack up and returns rather than attaching
// the log viewer. --agent is plain, token-free output; --detach backgrounds
// the stack instead of attaching the log viewer, which is what makes this a
// call rather than a session.
func UpArgs() []string { return []string{"up", "--agent", "--detach"} }

// StatusArgs asks for the machine-readable one-shot report.
func StatusArgs() []string { return []string{"status", "--agent", "--json"} }

// DestroyArgs stops one stack and drops the databases haven made for it. The
// slug is the whole safety story: nothing is derived from a directory, so a
// caller can only destroy what it named.
func DestroyArgs(slug string) []string {
	return []string{"destroy", slug, "--agent", "--yes"}
}

// BackendLogArgs reads one stack's backend lane log, for a boot that never
// became ready.
func BackendLogArgs(slug string) []string {
	return []string{"logs", "backend", "--agent", "--stack", slug}
}

// Status is the slice of `haven status --json` this package reads.
type Status struct {
	Stacks []StackStatus `json:"stacks"`
}

// StackStatus is one registered stack.
type StackStatus struct {
	Slug     string        `json:"slug"`
	APIPort  int           `json:"apiPort"`
	Live     bool          `json:"live"`
	Lanes    []LaneStatus  `json:"lanes"`
	Services []ServiceItem `json:"services"`
}

// LaneStatus is one supervised Node lane plus whether it is listening.
type LaneStatus struct {
	Name      string `json:"name"`
	Listening bool   `json:"listening"`
}

// ServiceItem is one routed service's hostname.
type ServiceItem struct {
	Name string `json:"name"`
	URL  string `json:"url"`
}

// ServiceURL returns the routed URL haven allocated for a named service (for
// example AppService), and whether the stack reported one.
func (stack StackStatus) ServiceURL(name string) (string, bool) {
	for _, service := range stack.Services {
		if service.Name == name && service.URL != "" {
			return service.URL, true
		}
	}
	return "", false
}

// ParseStatus decodes a `haven status --json` report.
func ParseStatus(output []byte) (Status, error) {
	var report Status
	if err := json.Unmarshal(output, &report); err != nil {
		return Status{}, fmt.Errorf("haven status --json: %w", err)
	}
	return report, nil
}

// StackReady finds the named, live stack whose every required lane is
// listening. Ready is haven's own answer, never a guess from elapsed time: a
// stack that is not live, or missing any required lane, is not ready.
func StackReady(status Status, slug string, requiredLanes ...string) (StackStatus, bool) {
	for _, stack := range status.Stacks {
		if stack.Slug != slug || !stack.Live {
			continue
		}
		if lanesListening(stack.Lanes, requiredLanes) {
			return stack, true
		}
	}
	return StackStatus{}, false
}

func lanesListening(lanes []LaneStatus, required []string) bool {
	for _, name := range required {
		found := false
		for _, lane := range lanes {
			if lane.Name == name && lane.Listening {
				found = true
				break
			}
		}
		if !found {
			return false
		}
	}
	return true
}

// PollDelay is the wait before the next readiness question, never longer
// than what is left of the deadline — so a short timeout fails when it says
// it will rather than one whole poll interval later.
func PollDelay(deadline time.Time, poll time.Duration) time.Duration {
	remaining := time.Until(deadline)
	if remaining > 0 && remaining < poll {
		return remaining
	}
	return poll
}

// LastLines returns at most count trailing non-empty lines of text, for an
// error that has to say what a stack died of.
func LastLines(text string, count int) string {
	lines := strings.Split(strings.TrimRight(text, "\n"), "\n")
	if len(lines) > count {
		lines = lines[len(lines)-count:]
	}
	return strings.Join(lines, "\n")
}
