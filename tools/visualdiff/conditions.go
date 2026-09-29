package visualdiff

import (
	"bytes"
	"context"
	"fmt"
	"io"
	"math"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strconv"
	"strings"

	"github.com/langwatch/langwatch/tools/havenrun"
)

// DefaultMaxLoad is the 1-minute load average above which a run refuses to
// start: run 17 recaptured 138 blank screens alone with its API answering in
// up to eleven seconds, and a slow run is worse than no run.
const DefaultMaxLoad = 20.0

// Conditions are what the machine looks like as a run starts. Load is
// negative when it cannot be read; CPUs zero when unknown.
type Conditions struct {
	OnBattery bool
	Load      float64
	CPUs      int
	// LiveStacks are another live or kept run's haven stacks that are up.
	LiveStacks []string
}

// Refusals are the reasons a run does not start under these conditions.
func Refusals(conditions Conditions, maxLoad float64) []string {
	var reasons []string
	if conditions.OnBattery {
		reasons = append(reasons, "the machine is on battery")
	}
	if conditions.Load > maxLoad {
		reasons = append(reasons, fmt.Sprintf("the 1-minute load average is %.1f, above -max-load %.0f", conditions.Load, maxLoad))
	}
	if len(conditions.LiveStacks) > 0 {
		reasons = append(reasons, "another visualdiff stack is up: "+strings.Join(conditions.LiveStacks, ", ")+
			" (visualdiff down for the fix loop's, haven destroy it, or visualdiff gc -kept)")
	}
	return reasons
}

// PageWidth is how many pages each side captures on: the asked number, or
// half the CPUs, never more than the CPUs the load leaves free, never under one.
func PageWidth(asked int, conditions Conditions) int {
	width := asked
	if width <= 0 {
		width = conditions.CPUs / 2
	}
	if conditions.Load >= 0 && conditions.CPUs > 0 {
		width = min(width, conditions.CPUs-int(math.Ceil(conditions.Load)))
	}
	return max(width, 1)
}

// refuse stops a run the machine cannot carry, unless -force; then sizes its pages.
func refuse(ctx context.Context, request *Request, stderr io.Writer) error {
	options := &request.Options
	if options.DryRun || request.Deps.Conditions == nil {
		return nil
	}
	conditions := request.Deps.Conditions(ctx, *options)
	if reasons := Refusals(conditions, options.MaxLoad); len(reasons) > 0 {
		if !options.Force {
			return fmt.Errorf("not starting: %s; -force runs anyway", strings.Join(reasons, "; "))
		}
		fmt.Fprintf(stderr, "warning: -force, running although %s\n", strings.Join(reasons, "; "))
	}
	if conditions.CPUs > 0 {
		options.Pages = PageWidth(options.Pages, conditions)
		fmt.Fprintf(stderr, "pages: %d per side (%d CPUs, load %.1f)\n", options.Pages, conditions.CPUs, conditions.Load)
	}
	return nil
}

// ReadConditions is Deps.Conditions' real implementation.
func ReadConditions(ctx context.Context, options Options) Conditions {
	conditions := Conditions{Load: readLoad(ctx), CPUs: runtime.NumCPU()}
	if runtime.GOOS == "darwin" {
		conditions.OnBattery = strings.Contains(pmset("batt"), "'Battery Power'")
	}
	if options.UseHaven {
		conditions.LiveStacks = liveOtherStacks(ctx, options)
	}
	return conditions
}

// readLoad is the 1-minute load average, or -1.
func readLoad(ctx context.Context) float64 {
	if runtime.GOOS == "darwin" {
		// #nosec G204 -- a constant executable and constant arguments.
		output, err := exec.CommandContext(ctx, "sysctl", "-n", "vm.loadavg").Output()
		if err != nil {
			return -1
		}
		return ParseLoad(string(output))
	}
	output, err := os.ReadFile("/proc/loadavg")
	if err != nil {
		return -1
	}
	return ParseLoad(string(output))
}

// ParseLoad reads the first number of `sysctl -n vm.loadavg` ("{ 1.2 1.1 1.0 }")
// or /proc/loadavg, or -1.
func ParseLoad(text string) float64 {
	fields := strings.Fields(strings.Trim(strings.TrimSpace(text), "{}"))
	if len(fields) == 0 {
		return -1
	}
	load, err := strconv.ParseFloat(fields[0], 64)
	if err != nil {
		return -1
	}
	return load
}

// liveOtherStacks are the up haven stacks of runs gc would leave: live or kept
// ones other than this. A dead run's stacks are gc's to destroy, not a refusal.
func liveOtherStacks(ctx context.Context, options Options) []string {
	states, err := ScanRuns(options.Root, ProcessAlive)
	if err != nil {
		return nil
	}
	owned := map[string]bool{}
	for _, state := range states {
		if (state.Alive || state.Kept) && filepath.Clean(state.Dir) != filepath.Clean(options.RunDir) {
			for _, slug := range state.Slugs() {
				owned[slug] = true
			}
		}
	}
	var out bytes.Buffer
	spec := commandSpec{name: havenrun.Command, args: havenrun.StatusArgs(), dir: options.Root, env: os.Environ()}
	if err := execRunner(ctx, spec, &out); err != nil {
		return nil
	}
	status, err := havenrun.ParseStatus(out.Bytes())
	if err != nil {
		return nil
	}
	var live []string
	for _, stack := range status.Stacks {
		if stack.Live && owned[stack.Slug] {
			live = append(live, stack.Slug)
		}
	}
	return live
}
