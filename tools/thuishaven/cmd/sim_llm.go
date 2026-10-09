package cmd

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/url"
	"os"
	"strconv"
	"time"

	"github.com/langwatch/langwatch/tools/thuishaven/cmd/viewer/sources"
)

// The per-simulator nouns (`haven llm|analytics|storage|voice`) are thin
// clients over each sim's own console API. simAPI and the helpers below are
// shared by all of them; the mail noun predates them and has its own client.

// simAPI dials the named simulator on this worktree's stack (or --stack's).
func simAPI(d deps, inv invocation, name string) (sources.SimAPI, error) {
	slug, err := tabSlug(d, inv)
	if err != nil {
		return sources.SimAPI{}, err
	}
	for _, service := range d.orch.SessionSnapshot(slug).Services {
		if service.Name == name && service.Port != 0 {
			return sources.NewSimAPI(service.Port), nil
		}
	}
	return sources.SimAPI{}, fmt.Errorf("%s is not running in %s; start it with haven up +%s", name, slug, name)
}

// simFlags are the flags every simulator noun takes, plus its own.
func simFlags(own ...flagSpec) []flagSpec {
	return append(own,
		flagSpec{long: "--json", summary: "machine-readable"},
		flagSpec{long: "--stack", takesValue: true, value: "<slug>", summary: "another worktree's stack by slug"},
	)
}

// simGet reads path; --json prints the sim's own document, otherwise human renders it.
func simGet[T any](api sources.SimAPI, path string, params url.Values, asJSON bool, human func(T)) error {
	var raw json.RawMessage
	if err := api.Get(path, params, &raw); err != nil {
		return err
	}
	if asJSON {
		return printSimRaw(raw)
	}
	var v T
	if err := json.Unmarshal(raw, &v); err != nil {
		return err
	}
	human(v)
	return nil
}

func printSimRaw(raw []byte) error {
	var out bytes.Buffer
	if err := json.Indent(&out, raw, "", "  "); err != nil {
		return err
	}
	out.WriteByte('\n')
	_, err := os.Stdout.Write(out.Bytes())
	return err
}

// simDone reports a mutation that has no document to show.
func simDone(asJSON bool, key, text string) error {
	if asJSON {
		return printMailJSON(map[string]bool{key: true})
	}
	fmt.Println(text)
	return nil
}

func needArgs(inv invocation, n int, usage string) error {
	if len(inv.args) < n {
		return errors.New("usage: " + usage)
	}
	return nil
}

const llmUsage = "usage: haven llm <info|calls|call <id>|clear|set [--error <status>] [--seed <value>]> [--json]"

type llmCall struct {
	ID           string    `json:"id"`
	At           time.Time `json:"at"`
	Path         string    `json:"path"`
	Model        string    `json:"model"`
	Status       int       `json:"status"`
	InputTokens  int       `json:"inputTokens"`
	OutputTokens int       `json:"outputTokens"`
	LatencyMs    float64   `json:"latencyMs"`
	Error        string    `json:"error"`
}

// llmSettings is what PUT /_sim/api/settings replaces wholesale.
type llmSettings struct {
	ForcedError int    `json:"forcedError"`
	Seed        string `json:"seed"`
}

// runLLM is `haven llm <info|calls|call|clear|set>`.
func runLLM(_ context.Context, d deps, inv invocation) error {
	if len(inv.args) == 0 {
		return errors.New(llmUsage)
	}
	api, err := simAPI(d, inv, "llm")
	if err != nil {
		return err
	}
	return llmCommand(api, inv, inv.has("--json") || d.isAgent)
}

func llmCommand(api sources.SimAPI, inv invocation, asJSON bool) error {
	switch inv.args[0] {
	case "info":
		return simGet(api, "/_sim/api/info", nil, asJSON, func(v struct {
			Stack    string      `json:"stack"`
			Models   []string    `json:"models"`
			Settings llmSettings `json:"settings"`
		}) {
			fmt.Printf("stack: %s\nmodels: %v\nforced error: %d\nseed: %q\n", v.Stack, v.Models, v.Settings.ForcedError, v.Settings.Seed)
		})
	case "calls":
		return simGet(api, "/_sim/api/calls", nil, asJSON, func(v struct{ Calls []llmCall }) {
			if len(v.Calls) == 0 {
				fmt.Println("no calls yet")
			}
			for _, c := range v.Calls {
				fmt.Printf("%-10s %-28s %-24s %d  in=%d out=%d %.0fms %s\n", c.ID, c.Path, c.Model, c.Status, c.InputTokens, c.OutputTokens, c.LatencyMs, c.Error)
			}
		})
	case "call":
		if err := needArgs(inv, 2, "haven llm call <id>"); err != nil {
			return err
		}
		raw, err := api.GetRaw("/_sim/api/calls/"+url.PathEscape(inv.args[1]), nil)
		if err != nil {
			return err
		}
		return printSimRaw(raw)
	case "clear":
		if err := api.Delete("/_sim/api/calls"); err != nil {
			return err
		}
		return simDone(asJSON, "cleared", "calls cleared")
	case "set":
		return llmSet(api, inv, asJSON)
	}
	return fmt.Errorf("unknown `haven llm` subcommand %q; %s", inv.args[0], llmUsage)
}

// llmSet changes only the flags given: the sim replaces its settings wholesale,
// so the current ones are read first.
func llmSet(api sources.SimAPI, inv invocation, asJSON bool) error {
	if !inv.has("--error") && !inv.has("--seed") {
		return errors.New("usage: haven llm set [--error <0|4xx|5xx>] [--seed <value>]")
	}
	var next llmSettings
	if err := api.Get("/_sim/api/settings", nil, &next); err != nil {
		return err
	}
	if inv.has("--error") {
		status, err := strconv.Atoi(inv.value("--error"))
		if err != nil {
			return fmt.Errorf("--error %q is not a status code; use 0 to turn it off", inv.value("--error"))
		}
		next.ForcedError = status
	}
	if inv.has("--seed") {
		next.Seed = inv.value("--seed")
	}
	var saved json.RawMessage
	if err := api.Put("/_sim/api/settings", next, &saved); err != nil {
		return err
	}
	if asJSON {
		return printSimRaw(saved)
	}
	fmt.Printf("forced error: %d\nseed: %q\n", next.ForcedError, next.Seed)
	return nil
}
