package cmd

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"text/tabwriter"
)

const machineSettingsUsage = "usage: haven machine settings [--json] | haven machine settings set <name> <value> | haven machine settings unset <name>"

// machineSettingsSpec is `haven machine settings`: the machine-wide switches
// (observability on/off, the VM on/off, VM auto-stop and its grace), beside `machine limits`.
func machineSettingsSpec() commandSpec {
	return commandSpec{
		name:    "settings",
		summary: "machine settings: observability on|off, vm on|off, runtime-auto-stop on|off, runtime-idle-grace-minutes; set <name> <value> | unset <name>",
		args:    "[set <name> <value> | unset <name>]",
		maxArgs: 3,
		flags:   []flagSpec{{long: "--json", summary: "machine-readable"}},
		run:     runMachineSettings,
	}
}

func runMachineSettings(ctx context.Context, d deps, inv invocation) error {
	args := inv.args
	switch {
	case len(args) == 0:
		return printMachineSettings(d, inv.has("--json") || d.isAgent)
	case args[0] == "set" && len(args) == 3:
		return printLimitResult(d.orch.SetMachineSetting(ctx, args[1], args[2]))
	case args[0] == "unset" && len(args) == 2:
		return printLimitResult(d.orch.SetMachineSetting(ctx, args[1], ""))
	}
	return errors.New(machineSettingsUsage)
}

func printMachineSettings(d deps, asJSON bool) error {
	view := d.orch.MachineSettingsView()
	if asJSON {
		enc := json.NewEncoder(os.Stdout)
		enc.SetIndent("", "  ")
		return enc.Encode(map[string]any{"settings": view})
	}
	tw := tabwriter.NewWriter(os.Stdout, 0, 4, 2, ' ', 0)
	fmt.Fprintln(tw, "SETTING\tVALUE\tDEFAULT\tWHAT IT DOES")
	for _, v := range view {
		fmt.Fprintf(tw, "%s\t%s\t%s\t%s\n", v.Name, v.Value, v.Default, v.Summary)
	}
	return tw.Flush()
}
