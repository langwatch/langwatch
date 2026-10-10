package cmd

import (
	"context"
	"fmt"
	"slices"
	"strings"
)

// The simulators share one vocabulary (ADR-064, amendment 2026-10-10): status,
// list, get, wait, clear, fault and console wherever a simulator has the
// concept, and settings under config. Each simulator's command still parses
// its own verbs; simRenames is the one table between the two spellings, read
// both ways: public to the verb the command parses, and a retired verb to the
// exact public spelling that replaced it.
// ponytail: a translation table, not renamed switch cases; renaming the cases
// in each sim_*.go file retires it.

type verbRename struct{ public, internal []string }

var simRenames = map[string][]verbRename{
	"mail":      {{[]string{"status"}, []string{"inbox"}}},
	"llm":       {{[]string{"status"}, []string{"info"}}, {[]string{"list"}, []string{"calls"}}, {[]string{"get"}, []string{"call"}}, {[]string{"config"}, []string{"set"}}},
	"analytics": {{[]string{"list"}, []string{"records"}}},
	"outbound":  {{[]string{"list"}, []string{"records"}}},
	"lambda":    {{[]string{"status"}, []string{"info"}}, {[]string{"list"}, []string{"calls"}}, {[]string{"get"}, []string{"call"}}},
	"payment":   {{[]string{"list"}, []string{"events"}}, {[]string{"clear"}, []string{"reset"}}},
	"storage":   {{[]string{"list"}, []string{"requests"}}},
	"idp":       {{[]string{"list"}, []string{"tenants"}}, {[]string{"get"}, []string{"tenant", "show"}}, {[]string{"clear"}, []string{"reset"}}},
	"voice":     {{[]string{"list"}, []string{"calls"}}, {[]string{"get"}, []string{"call"}}},
	"telemetry": {{[]string{"list"}, []string{"runs"}}, {[]string{"get"}, []string{"run"}}},
}

// faultStyle is how a simulator's `fault` reaches the command that injects it.
var faultStyle = map[string]string{
	"mail": "error", "llm": "error", "analytics": "error", "storage": "error",
	"lambda": "error-none", "payment": "payment", "idp": "idp", "outbound": "native",
}

// simPublicVerbs is each simulator's verb list as help and `haven sim` show it.
var simPublicVerbs = map[string]string{
	"mail":      "status|address|list|get|links|wait|delete|clear|fault",
	"llm":       "status|list|get|clear|fault|config",
	"analytics": "status|list|clear|wait|fault",
	"outbound":  "status|list|deliveries|clear|wait|fault|receiver|urls",
	"lambda":    "status|list|get|clear|fault",
	"payment":   "status|list|customers|subscriptions|checkouts|invoices|usage|complete|retry|advance|fault|deliver|hold|release|clear",
	"storage":   "list|buckets|objects|object|presign|delete|clear|seed|fault",
	"voice":     "status|list|get|clear",
	"telemetry": "status|list|get|send|load|fuzz|post|fixtures|fixture|stop|console",
}

// simCommand turns one simulator's command into `haven sim <name>`.
func simCommand(spec commandSpec) commandSpec {
	name := spec.name
	if verbs, ok := simPublicVerbs[name]; ok {
		spec.args = "<" + verbs + "> [id]"
		spec.summary = name + "sim: " + strings.ReplaceAll(verbs, "|", " | ")
	} else {
		spec.args, spec.summary = "<verb> [tenant] [args]", name+"sim: "+strings.Join(simVerbs(name), " | ")
	}
	for i, f := range spec.flags {
		if f.long == "--error" {
			spec.flags[i].hidden = true
		}
	}
	spec.rewrite = func(rest []string) ([]string, error) { return simInternalArgv(name, rest) }
	run := spec.run
	self := spec
	spec.run = func(ctx context.Context, d deps, inv invocation) error {
		if len(inv.args) == 0 {
			self.path = "sim " + name
			fmt.Print(renderCommandHelp(self))
			return nil
		}
		if err := requireSim(d, name, inv); err != nil {
			return err
		}
		return run(ctx, d, inv)
	}
	return spec
}

// simInternalArgv turns `haven sim <name> <public verb> …` into the argv the
// simulator's command parses, refusing a retired verb with its new spelling.
func simInternalArgv(name string, rest []string) ([]string, error) {
	if len(rest) == 0 {
		return rest, nil
	}
	if retiredSimVerb(name, rest) {
		return nil, retiredError(append([]string{"sim", name}, rest...), append([]string{"sim", name}, simPublicArgv(name, rest)...))
	}
	if rest[0] == "fault" {
		return faultArgv(name, rest)
	}
	for _, r := range simRenames[name] {
		if hasPrefix(rest, r.public) {
			return append(slices.Clone(r.internal), rest[len(r.public):]...), nil
		}
	}
	return rest, nil
}

func faultArgv(name string, rest []string) ([]string, error) {
	off := func(v, offValue string) string {
		if v == "off" {
			return offValue
		}
		return v
	}
	switch faultStyle[name] {
	case "native":
		return rest, nil
	case "error", "error-none":
		if len(rest) < 2 {
			return nil, usageErr("usage: haven sim %s fault <status> | off", name)
		}
		offValue := "0"
		if faultStyle[name] == "error-none" {
			offValue = "none"
		}
		return append([]string{"set", "--error", off(rest[1], offValue)}, rest[2:]...), nil
	case "payment":
		if len(rest) > 1 && rest[1] == "off" {
			return append([]string{"clear-failures"}, rest[2:]...), nil
		}
		return append([]string{"fail"}, rest[1:]...), nil
	case "idp":
		if len(rest) < 3 {
			return nil, usageErr("usage: haven sim idp fault <tenant> <kind> | off")
		}
		return append([]string{"tamper", rest[1], off(rest[2], "none")}, rest[3:]...), nil
	}
	return nil, usageErr("haven sim %s has no fault to inject", name)
}

// retiredSimVerb reports whether rest starts with a verb the simulator's
// command parses but its public vocabulary has renamed.
func retiredSimVerb(name string, rest []string) bool {
	for _, r := range simRenames[name] {
		if hasPrefix(rest, r.internal) && !hasPrefix(rest, r.public) {
			return true
		}
	}
	switch faultStyle[name] {
	case "error", "error-none":
		return rest[0] == "set"
	case "payment":
		return rest[0] == "fail" || rest[0] == "clear-failures"
	case "idp":
		return rest[0] == "tamper"
	}
	return false
}

// simPublicArgv is the public spelling of a simulator argv written in the old
// verbs, for the pointer a retired spelling answers with.
func simPublicArgv(name string, rest []string) []string {
	if len(rest) == 0 {
		return rest
	}
	switch {
	case rest[0] == "set" && flagValue(rest, "--error") != "":
		v := flagValue(rest, "--error")
		if v == "0" || v == "none" {
			v = "off"
		}
		return []string{"fault", v}
	case rest[0] == "set" && name == "llm":
		return append([]string{"config"}, rest[1:]...)
	case rest[0] == "fail" && name == "payment":
		return append([]string{"fault"}, rest[1:]...)
	case rest[0] == "clear-failures" && name == "payment":
		return append([]string{"fault", "off"}, rest[1:]...)
	case rest[0] == "tamper" && name == "idp" && len(rest) >= 3:
		kind := rest[2]
		if kind == "none" {
			kind = "off"
		}
		return append([]string{"fault", rest[1], kind}, rest[3:]...)
	}
	for _, r := range simRenames[name] {
		if hasPrefix(rest, r.internal) {
			return append(slices.Clone(r.public), rest[len(r.internal):]...)
		}
	}
	return rest
}

func hasPrefix(args, words []string) bool {
	return len(args) >= len(words) && slices.Equal(args[:len(words)], words)
}

func flagValue(args []string, long string) string {
	for i, a := range args {
		if v, ok := strings.CutPrefix(a, long+"="); ok {
			return v
		}
		if a == long && i+1 < len(args) {
			return args[i+1]
		}
	}
	return ""
}

// requireSim refuses a verb aimed at a simulator this stack does not run,
// naming how to start it: exit 65. A command pointed elsewhere (--sim,
// --target) is not this stack's to check.
func requireSim(d deps, name string, inv invocation) error {
	if d.orch == nil || inv.has("--sim") || inv.has("--target") {
		return nil
	}
	slug, err := tabSlug(d, inv)
	if err != nil {
		return err
	}
	for _, row := range simRows(d.orch.SessionSnapshot(slug).Services) {
		if row.Name == name && !row.Running {
			return notRunningErr("%s is not running in %s; start it with haven up +%s", name, slug, name)
		}
	}
	return nil
}
