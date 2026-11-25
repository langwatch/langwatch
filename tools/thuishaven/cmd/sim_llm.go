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
	"strings"
	"time"

	"github.com/langwatch/langwatch/tools/thuishaven/cmd/viewer/sources"
)

// The per-simulator nouns (`haven sim llm|analytics|storage|voice`) are thin
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

const llmUsage = "usage: haven sim llm <status|list [--model <text>] [--failed]|get <id>|clear|fault <status|off>|config [--seed <value>]> [--json]"

type llmCall struct {
	ID           string    `json:"id"`
	At           time.Time `json:"at"`
	Path         string    `json:"path"`
	Dialect      string    `json:"dialect"`
	Model        string    `json:"model"`
	Mode         string    `json:"mode"`
	Stream       bool      `json:"stream"`
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

// runLLM is `haven sim llm <status|list|get|clear|fault|config>`.
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
			Capacity int         `json:"capacity"`
			Settings llmSettings `json:"settings"`
		}) {
			fmt.Printf("stack: %s\nmodels: %v\ncalls kept: %d\nforced error: %d\nseed: %q\n", v.Stack, v.Models, v.Capacity, v.Settings.ForcedError, v.Settings.Seed)
		})
	case "calls":
		return llmCalls(api, inv, asJSON)
	case "call":
		if err := needArgs(inv, 2, "haven sim llm get <id>"); err != nil {
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
	return fmt.Errorf("unknown `haven sim llm` subcommand %q; %s", inv.args[0], llmUsage)
}

// llmCalls lists recent calls, keeping only those whose model contains --model
// and, with --failed, those answered with a 4xx or 5xx.
func llmCalls(api sources.SimAPI, inv invocation, asJSON bool) error {
	var doc struct {
		Calls []json.RawMessage `json:"calls"`
	}
	if err := api.Get("/_sim/api/calls", nil, &doc); err != nil {
		return err
	}
	kept, calls, err := filterLlmCalls(doc.Calls, inv)
	if err != nil {
		return err
	}
	if asJSON {
		out, err := json.Marshal(map[string][]json.RawMessage{"calls": kept})
		if err != nil {
			return err
		}
		return printSimRaw(out)
	}
	printLlmCalls(calls)
	return nil
}

// filterLlmCalls keeps the calls the --model and --failed flags select, raw and decoded.
func filterLlmCalls(raws []json.RawMessage, inv invocation) ([]json.RawMessage, []llmCall, error) {
	kept, calls := []json.RawMessage{}, []llmCall{}
	for _, raw := range raws {
		var c llmCall
		if err := json.Unmarshal(raw, &c); err != nil {
			return nil, nil, err
		}
		if !strings.Contains(c.Model, inv.value("--model")) || (inv.has("--failed") && c.Status < 400) {
			continue
		}
		kept, calls = append(kept, raw), append(calls, c)
	}
	return kept, calls, nil
}

func printLlmCalls(calls []llmCall) {
	if len(calls) == 0 {
		fmt.Println("no calls")
	}
	for i := range calls {
		c := &calls[i]
		fmt.Printf("%-10s %-28s %-9s %-6s %-24s %d  in=%d out=%d %.0fms %s\n", c.ID, c.Path, c.Dialect, c.Mode, c.Model, c.Status, c.InputTokens, c.OutputTokens, c.LatencyMs, c.Error)
	}
}

// llmSet changes only the flags given: the sim replaces its settings wholesale,
// so the current ones are read first.
func llmSet(api sources.SimAPI, inv invocation, asJSON bool) error {
	if !inv.has("--error") && !inv.has("--seed") {
		return errors.New("usage: haven sim llm fault <0|4xx|5xx|off> | config --seed <value>")
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
