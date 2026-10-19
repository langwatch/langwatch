package cmd

import (
	"context"
	"encoding/json"
	"errors"
	"strings"

	"github.com/langwatch/langwatch/tools/thuishaven/cmd/viewer/sources"
)

const githubUsage = "usage: haven sim github <status|list|pulls|calls|deliveries|install --account <login>|pr open --repo <o/r> --head <branch>|pr <close|merge|reopen|draft|ready|edit|synchronize> --repo <o/r> --number <n>|app <suspend|unsuspend|delete|add-repo|remove-repo> --installation <id>|deliver --event <e> --action <a>|fault <add|list|clear>|clear|reset> [--deliver] [--json]"

// runGithub is `haven sim github …`: a thin client over githubsim's /_sim/api. It prints the sim's own JSON.
func runGithub(_ context.Context, d deps, inv invocation) error {
	if len(inv.args) == 0 {
		return errors.New(githubUsage)
	}
	api, err := simAPI(d, inv, "github")
	if err != nil {
		return err
	}
	return githubCommand(api, inv)
}

func githubCommand(api sources.SimAPI, inv invocation) error {
	switch inv.args[0] {
	case "status":
		return githubGet(api, "/_sim/api/info")
	case "list":
		return githubGet(api, "/_sim/api/installations")
	case "pulls":
		return githubGet(api, "/_sim/api/pulls")
	case "calls":
		return githubGet(api, "/_sim/api/calls")
	case "deliveries":
		return githubGet(api, "/_sim/api/deliveries")
	case "install":
		return githubInstall(api, inv)
	case "pr":
		return githubPR(api, inv)
	case "app":
		return githubApp(api, inv)
	case "deliver":
		return githubDeliver(api, inv)
	case "fault":
		return githubFault(api, inv)
	case "clear":
		if err := api.Delete("/_sim/api/calls"); err != nil {
			return err
		}
		return simDone(true, "cleared", "calls and deliveries cleared")
	case "reset":
		return githubPost(api, "/_sim/api/reset", map[string]any{})
	}
	return errors.New("unknown `haven sim github` subcommand " + inv.args[0] + "; " + githubUsage)
}

func githubGet(api sources.SimAPI, path string) error {
	var raw json.RawMessage
	if err := api.Get(path, nil, &raw); err != nil {
		return err
	}
	return printSimRaw(raw)
}

func githubPost(api sources.SimAPI, path string, body any) error {
	var raw json.RawMessage
	if err := api.Post(path, body, &raw); err != nil {
		return err
	}
	return printSimRaw(raw)
}

func githubInstall(api sources.SimAPI, inv invocation) error {
	account := inv.value("--account")
	if account == "" {
		return errors.New("usage: haven sim github install --account <login> [--type Organization|User] [--repos a/b,c/d] [--deliver]")
	}
	body := map[string]any{"account": account, "type": inv.value("--type"), "deliver": inv.has("--deliver")}
	if repos := inv.value("--repos"); repos != "" {
		body["repos"] = strings.Split(repos, ",")
	}
	return githubPost(api, "/_sim/api/installations", body)
}

func githubPR(api sources.SimAPI, inv invocation) error {
	if len(inv.args) < 2 || inv.value("--repo") == "" {
		return errors.New("usage: haven sim github pr open --repo <o/r> --head <branch> | pr <close|merge|reopen|draft|ready|edit|synchronize> --repo <o/r> --number <n>")
	}
	deliver := inv.has("--deliver")
	if inv.args[1] == "open" {
		return githubPost(api, "/_sim/api/pulls", map[string]any{
			"repo": inv.value("--repo"), "head": inv.value("--head"), "title": inv.value("--title"),
			"user": inv.value("--user"), "draft": inv.has("--draft"), "deliver": deliver,
		})
	}
	number, err := intFlag(inv, "--number", 0)
	if err != nil {
		return err
	}
	return githubPost(api, "/_sim/api/pulls/transition", map[string]any{
		"repo": inv.value("--repo"), "number": number, "action": inv.args[1], "title": inv.value("--title"), "deliver": deliver,
	})
}

func githubApp(api sources.SimAPI, inv invocation) error {
	id := inv.value("--installation")
	if len(inv.args) < 2 || id == "" {
		return errors.New("usage: haven sim github app <suspend|unsuspend|delete|add-repo|remove-repo> --installation <id> [--repo <o/r>] [--deliver]")
	}
	return githubPost(api, "/_sim/api/installations/"+id+"/action", map[string]any{
		"action": inv.args[1], "repo": inv.value("--repo"), "deliver": inv.has("--deliver"),
	})
}

func githubDeliver(api sources.SimAPI, inv invocation) error {
	event := inv.value("--event")
	if event == "" {
		return errors.New("usage: haven sim github deliver --event <ping|installation|installation_repositories|pull_request> [--action <a>] [--installation <id>] [--repo <o/r> --number <n>] [--bad-signature] [--omit-signature]")
	}
	installation, err := intFlag(inv, "--installation", 0)
	if err != nil {
		return err
	}
	number, err := intFlag(inv, "--number", 0)
	if err != nil {
		return err
	}
	return githubPost(api, "/_sim/api/deliver", map[string]any{
		"event": event, "action": inv.value("--action"), "installationId": installation, "repo": inv.value("--repo"), "number": number,
		"badSignature": inv.has("--bad-signature"), "omitSignature": inv.has("--omit-signature"),
	})
}

func githubFault(api sources.SimAPI, inv invocation) error {
	verb := ""
	if len(inv.args) > 1 {
		verb = inv.args[1]
	}
	switch verb {
	case "list":
		return githubGet(api, "/_sim/api/faults")
	case "clear", "off":
		if err := api.Delete("/_sim/api/faults"); err != nil {
			return err
		}
		return simDone(true, "cleared", "faults cleared")
	case "add":
		status, err := intFlag(inv, "--status", 0)
		if err != nil {
			return err
		}
		retry, err := intFlag(inv, "--retry-after", 0)
		if err != nil {
			return err
		}
		times, err := intFlag(inv, "--times", 0)
		if err != nil {
			return err
		}
		return githubPost(api, "/_sim/api/faults", map[string]any{
			"match": inv.value("--match"), "status": status, "retryAfter": retry, "times": times, "message": inv.value("--message"),
		})
	}
	return errors.New("usage: haven sim github fault add --status <4xx|5xx> [--match <text>] [--retry-after <s>] [--times <n>] | fault list | fault clear")
}
