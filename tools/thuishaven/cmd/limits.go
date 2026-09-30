package cmd

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"runtime"
	"strconv"
	"text/tabwriter"

	"github.com/langwatch/langwatch/tools/thuishaven/adapters/atomicfile"
	"github.com/langwatch/langwatch/tools/thuishaven/adapters/system"
	"github.com/langwatch/langwatch/tools/thuishaven/domain"
)

// limitsFile lives in haven's home and holds only the limits the operator set,
// as kebab name to number. It is the bottom layer of resolveKnob, below .env.
const limitsFile = "limits.json"

func limitsPath() string { return filepath.Join(havenHome(), limitsFile) }

func readLimitSettings() map[string]int {
	out := map[string]int{}
	if data, err := os.ReadFile(limitsPath()); err == nil {
		_ = json.Unmarshal(data, &out) // a damaged file reads as no settings
	}
	return out
}

func writeLimitSettings(settings map[string]int) error {
	if len(settings) == 0 {
		if err := os.Remove(limitsPath()); err != nil && !errors.Is(err, os.ErrNotExist) {
			return err
		}
		return nil
	}
	data, err := json.MarshalIndent(settings, "", "  ")
	if err != nil {
		return err
	}
	if err := os.MkdirAll(havenHome(), 0o755); err != nil { //nolint:gosec // haven's own home, same mode as its siblings
		return err
	}
	return atomicfile.Write(limitsPath(), append(data, '\n'), 0o644)
}

// settingsKnobs is resolveKnob's settings layer, keyed by env name.
func settingsKnobs() map[string]string {
	out := map[string]string{}
	for name, n := range readLimitSettings() {
		if l, err := domain.FindLimit(name); err == nil {
			out[l.Env] = strconv.Itoa(n)
		}
	}
	return out
}

func limitMachine() domain.LimitMachine {
	return domain.LimitMachine{TotalRAMBytes: system.New().TotalMemory(), NumCPU: runtime.NumCPU()}
}

// limitsReport resolves every limit through the same layers the readers use.
func limitsReport() domain.LimitsReport {
	return domain.ResolveLimits(limitMachine(), envOr("HAVEN_COLIMA_PROFILE", "default"),
		func(key string) (string, string, bool) {
			return resolveKnobSource(key, processKnobs())
		})
}

func limitValue(report domain.LimitsReport, name string) domain.LimitValue {
	for _, v := range report.Limits {
		if v.Name == name {
			return v
		}
	}
	return domain.LimitValue{}
}

func winsNote(v domain.LimitValue) string {
	if v.Source == "settings" || v.Source == "default" {
		return ""
	}
	return fmt.Sprintf(" (note: %s is set in %s, which wins: the effective value is %d %s)", v.Env, v.Source, v.Value, v.Unit)
}

// setLimit validates and saves one limit, and answers the line to show.
func setLimit(name string, value int) (string, error) {
	l, err := domain.FindLimit(name)
	if err != nil {
		return "", err
	}
	if err := limitsReport().Check(name, value); err != nil {
		return "", err
	}
	settings := readLimitSettings()
	settings[name] = value
	if err := writeLimitSettings(settings); err != nil {
		return "", fmt.Errorf("saving %s: %w", limitsPath(), err)
	}
	v := limitValue(limitsReport(), name)
	return fmt.Sprintf("%s set to %d %s%s; applies %s", name, value, l.Unit, winsNote(v), v.Applies), nil
}

func unsetLimit(name string) (string, error) {
	l, err := domain.FindLimit(name)
	if err != nil {
		return "", err
	}
	settings := readLimitSettings()
	delete(settings, name)
	if err := writeLimitSettings(settings); err != nil {
		return "", fmt.Errorf("saving %s: %w", limitsPath(), err)
	}
	v := limitValue(limitsReport(), name)
	return fmt.Sprintf("%s unset: now %d %s (%s); applies %s", name, v.Value, l.Unit, v.Source, v.Applies), nil
}

func runLimits(_ context.Context, _ deps, inv invocation) error {
	args := inv.args
	switch {
	case len(args) == 0:
		return printLimits(inv.has("--json"))
	case args[0] == "set" && len(args) == 3:
		n, err := strconv.Atoi(args[2])
		if err != nil {
			return fmt.Errorf("haven limits set: %q is not a whole number", args[2])
		}
		return printLimitResult(setLimit(args[1], n))
	case args[0] == "unset" && len(args) == 2:
		return printLimitResult(unsetLimit(args[1]))
	}
	return errors.New("usage: haven limits [--json] | haven limits set <name> <value> | haven limits unset <name>")
}

func printLimitResult(message string, err error) error {
	if err == nil {
		fmt.Println(message)
	}
	return err
}

func printLimits(asJSON bool) error {
	report := limitsReport()
	if asJSON {
		enc := json.NewEncoder(os.Stdout)
		enc.SetIndent("", "  ")
		return enc.Encode(report)
	}
	fmt.Printf("This machine: %d GiB RAM, %d CPUs. Settings file: %s\n\n", report.TotalRAMBytes>>30, report.CPUs, limitsPath())
	tw := tabwriter.NewWriter(os.Stdout, 0, 4, 2, ' ', 0)
	fmt.Fprintln(tw, "LIMIT\tVALUE\tSOURCE\tKNOB")
	for _, v := range report.Limits {
		fmt.Fprintf(tw, "%s\t%d %s\t%s\t%s\n", v.Name, v.Value, v.Unit, v.Source, v.Env)
	}
	_ = tw.Flush()
	fmt.Println("\nWhen a change applies:")
	for _, v := range report.Limits {
		fmt.Printf("  %s: %s\n", v.Name, v.Applies)
	}
	fmt.Println("\nPrecedence: environment > .env > settings file > default.")
	return nil
}
