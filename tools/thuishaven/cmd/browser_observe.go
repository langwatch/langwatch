package cmd

import (
	"bufio"
	"errors"
	"fmt"
	"io"
	"os"
	"strconv"
)

// `haven browser network|console|profile|lean` and the page diff an action prints:
// what an agent needs to see after a step, in a few lines, instead of a snapshot.

const observeUsage = "usage: haven browser <network [show <id>] | profile <start|stop>> --lane <name>"

// stackBody names the stack on a call that needs no app URL (status, a lane already open).
func stackBody(slug string) map[string]any {
	return map[string]any{"stack": map[string]any{"slug": slug}}
}

// observeVerb maps `network [show <id>]` and `profile <start|stop>` onto the daemon's verb.
func observeVerb(inv invocation) (string, invocation, error) {
	noun := inv.args[0]
	sub := ""
	if len(inv.args) > 1 {
		sub = inv.args[1]
	}
	switch {
	case noun == "network" && sub == "":
		return "network", inv, nil
	case noun == "network" && sub == "show":
		inv.args = append([]string{"network-show"}, inv.args[2:]...)
		return "network-show", inv, nil
	case noun == "profile" && (sub == "start" || sub == "stop"):
		inv.args = append([]string{"profile-" + sub}, inv.args[2:]...)
		return "profile-" + sub, inv, nil
	}
	return "", inv, errors.New(observeUsage)
}

// observeFlags are the boolean flags a read or an action carries onto its request.
var observeFlags = map[string]string{"--since-last": "sinceLast", "--failed": "failed", "--all": "all", "--full": "full", "--lean": "lean"}

// observeExtras maps the read and switch flags onto the request.
func observeExtras(verb string, inv invocation, req map[string]any) error {
	if err := observeArgs(verb, req); err != nil {
		return err
	}
	for flag, field := range observeFlags {
		if inv.has(flag) {
			req[field] = true
		}
	}
	if level := inv.value("--level"); level != "" {
		req["level"] = level
	}
	return nil
}

// observeArgs checks the positional argument of `network show <id>` and `lean <on|off>`.
func observeArgs(verb string, req map[string]any) error {
	switch verb {
	case "network-show":
		id, err := strconv.Atoi(fmt.Sprint(req["id"]))
		if err != nil || id < 1 {
			return fmt.Errorf("network show needs a request id such as 12 (from haven browser network), got %v", req["id"])
		}
		req["id"] = id
	case "lean":
		if req["mode"] != "on" && req["mode"] != "off" {
			return errors.New("usage: haven browser lean <on|off> --lane <name>")
		}
	}
	return nil
}

// printAction prints where an action landed, then what it changed, the requests
// it made and the console errors it raised; --full replies carry url and title only.
// Lines are buffered and written once: a diff is up to 40 lines.
func printAction(reply map[string]any) {
	w := bufio.NewWriter(os.Stdout)
	defer func() { _ = w.Flush() }()
	_, _ = fmt.Fprintf(w, "%v  %v\n", reply["url"], reply["title"])
	changes, diffed := reply["changes"].([]any)
	if !diffed {
		return
	}
	if len(changes) == 0 {
		_, _ = fmt.Fprintln(w, "no change on the page")
	}
	printLines(w, "", changes)
	printBlock(w, "requests:", reply["requests"])
	printBlock(w, "console errors:", reply["errors"])
}

// printObserve prints a network, console, profile or lean reply in plain text.
func printObserve(verb string, reply map[string]any) {
	w := bufio.NewWriter(os.Stdout)
	defer func() { _ = w.Flush() }()
	switch verb {
	case "network", "console":
		entries, _ := reply["entries"].([]any)
		if len(entries) == 0 {
			_, _ = fmt.Fprintln(w, "nothing yet")
		}
		printLines(w, "", entries)
	case "network-show":
		_, _ = fmt.Fprintf(w, "%v\n%v\ncontent-type: %v\nrequest body: %v\nresponse body: %v\n", reply["line"], reply["url"], reply["contentType"], reply["requestBody"], reply["responseBody"])
	case "profile-start":
		_, _ = fmt.Fprintf(w, "profiling %v; haven browser profile stop when done\n", reply["profiling"])
	case "profile-stop":
		summary, _ := reply["summary"].([]any)
		printLines(w, "", summary)
		_, _ = fmt.Fprintf(w, "trace: %v\n", reply["file"])
	case "lean":
		_, _ = fmt.Fprintf(w, "lean %v\n", map[bool]string{true: "on", false: "off"}[reply["lean"] == true])
	}
}

func printBlock(w io.Writer, title string, raw any) {
	lines, _ := raw.([]any)
	if len(lines) == 0 {
		return
	}
	_, _ = fmt.Fprintln(w, title)
	printLines(w, "  ", lines)
}

func printLines(w io.Writer, indent string, lines []any) {
	for _, line := range lines {
		_, _ = fmt.Fprintf(w, "%s%v\n", indent, line)
	}
}
