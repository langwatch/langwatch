package cmd

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/url"
	"time"

	"github.com/langwatch/langwatch/tools/thuishaven/cmd/viewer/sources"
)

const lambdaUsage = "usage: haven lambda <info|calls|call <id>|clear|set --error <none|throttled|not-found|function-error|service>> [--json]"

type lambdaCall struct {
	ID            string    `json:"id"`
	At            time.Time `json:"at"`
	Function      string    `json:"function"`
	Mode          string    `json:"mode"`
	Method        string    `json:"method"`
	Path          string    `json:"path"`
	Status        int       `json:"status"`
	FunctionError string    `json:"functionError"`
	DurationMs    float64   `json:"durationMs"`
	Error         string    `json:"error"`
}

// runLambda is `haven lambda <info|calls|call|clear|set>`.
func runLambda(_ context.Context, d deps, inv invocation) error {
	if len(inv.args) == 0 {
		return errors.New(lambdaUsage)
	}
	api, err := simAPI(d, inv, "lambda")
	if err != nil {
		return err
	}
	return lambdaCommand(api, inv, inv.has("--json") || d.isAgent)
}

func lambdaCommand(api sources.SimAPI, inv invocation, asJSON bool) error {
	switch inv.args[0] {
	case "info":
		return simGet(api, "/_sim/api/info", nil, asJSON, func(v struct {
			Stack     string   `json:"stack"`
			Target    string   `json:"target"`
			Capacity  int      `json:"capacity"`
			Functions []string `json:"functions"`
			Settings  struct {
				ForcedError string `json:"forcedError"`
			} `json:"settings"`
		}) {
			fmt.Printf("stack: %s\nnlpgo: %s\ncalls kept: %d\nfunctions: %v\nforced error: %q\n", v.Stack, v.Target, v.Capacity, v.Functions, v.Settings.ForcedError)
		})
	case "calls":
		return simGet(api, "/_sim/api/calls", nil, asJSON, func(v struct{ Calls []lambdaCall }) {
			if len(v.Calls) == 0 {
				fmt.Println("no calls")
			}
			for i := range v.Calls {
				c := &v.Calls[i]
				fmt.Printf("%-6s %-32s %-6s %-6s %-28s %3d %-9s %.0fms %s\n", c.ID, c.Function, c.Mode, c.Method, c.Path, c.Status, c.FunctionError, c.DurationMs, c.Error)
			}
		})
	case "call":
		return lambdaShowCall(api, inv)
	case "clear":
		if err := api.Delete("/_sim/api/calls"); err != nil {
			return err
		}
		return simDone(asJSON, "cleared", "calls cleared")
	case "set":
		return lambdaSet(api, inv, asJSON)
	}
	return fmt.Errorf("unknown `haven lambda` subcommand %q; %s", inv.args[0], lambdaUsage)
}

func lambdaShowCall(api sources.SimAPI, inv invocation) error {
	if err := needArgs(inv, 2, "haven lambda call <id>"); err != nil {
		return err
	}
	raw, err := api.GetRaw("/_sim/api/calls/"+url.PathEscape(inv.args[1]), nil)
	if err != nil {
		return err
	}
	return printSimRaw(raw)
}

func lambdaSet(api sources.SimAPI, inv invocation, asJSON bool) error {
	if !inv.has("--error") {
		return errors.New(lambdaUsage)
	}
	kind := inv.value("--error")
	if kind == "none" {
		kind = ""
	}
	var saved json.RawMessage
	if err := api.Put("/_sim/api/settings", map[string]string{"forcedError": kind}, &saved); err != nil {
		return err
	}
	if asJSON {
		return printSimRaw(saved)
	}
	fmt.Printf("forced error: %q\n", kind)
	return nil
}
