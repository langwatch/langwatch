package cmd

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"time"

	"github.com/langwatch/langwatch/tools/thuishaven/cmd/viewer/sources"
)

const voiceUsage = "usage: haven voice <status|calls|call <id>> [--json]"

type voiceCall struct {
	ID        string     `json:"id"`
	AgentID   string     `json:"agentId"`
	StartedAt time.Time  `json:"startedAt"`
	EndedAt   *time.Time `json:"endedAt"`
	Turns     []struct {
		CallerText string `json:"callerText"`
		AgentText  string `json:"agentText"`
	} `json:"turns"`
}

// runVoice is `haven voice <status|calls|call>`.
func runVoice(_ context.Context, d deps, inv invocation) error {
	if len(inv.args) == 0 {
		return errors.New(voiceUsage)
	}
	api, err := simAPI(d, inv, "voice")
	if err != nil {
		return err
	}
	return voiceCommand(api, inv, inv.has("--json") || d.isAgent)
}

func voiceCommand(api sources.SimAPI, inv invocation, asJSON bool) error {
	switch inv.args[0] {
	case "status":
		return simGet(api, "/_sim/api/status", nil, asJSON, func(v struct {
			Stack             string `json:"stack"`
			Calls             int    `json:"calls"`
			ElevenLabsBaseURL string `json:"elevenLabsBaseUrl"`
			OpenAIBaseURL     string `json:"openaiBaseUrl"`
		}) {
			fmt.Printf("stack: %s\ncalls: %d\nElevenLabs: %s\nOpenAI: %s\n", v.Stack, v.Calls, v.ElevenLabsBaseURL, v.OpenAIBaseURL)
		})
	case "calls":
		return simGet(api, "/_sim/api/calls", nil, asJSON, func(v struct{ Calls []voiceCall }) {
			if len(v.Calls) == 0 {
				fmt.Println("no calls yet")
			}
			for _, c := range v.Calls {
				fmt.Printf("%-24s %-24s %d turns  %s\n", c.ID, c.AgentID, len(c.Turns), c.StartedAt.Format(time.RFC3339))
			}
		})
	case "call":
		return voiceOneCall(api, inv, asJSON)
	}
	return fmt.Errorf("unknown `haven voice` subcommand %q; %s", inv.args[0], voiceUsage)
}

// voiceOneCall picks a call out of the list: the sim has no per-call endpoint.
func voiceOneCall(api sources.SimAPI, inv invocation, asJSON bool) error {
	if err := needArgs(inv, 2, "haven voice call <id>"); err != nil {
		return err
	}
	var all struct {
		Calls []json.RawMessage `json:"calls"`
	}
	if err := api.Get("/_sim/api/calls", nil, &all); err != nil {
		return err
	}
	for _, raw := range all.Calls {
		var c voiceCall
		if err := json.Unmarshal(raw, &c); err != nil || c.ID != inv.args[1] {
			continue
		}
		if asJSON {
			return printSimRaw(raw)
		}
		fmt.Printf("%s agent=%s started %s\n", c.ID, c.AgentID, c.StartedAt.Format(time.RFC3339))
		for i, t := range c.Turns {
			fmt.Printf("%2d caller: %s\n   agent:  %s\n", i+1, t.CallerText, t.AgentText)
		}
		return nil
	}
	return fmt.Errorf("call %q is not in this stack's voice log", inv.args[1])
}
