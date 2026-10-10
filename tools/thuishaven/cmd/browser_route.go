package cmd

import (
	"errors"
	"fmt"
	"strconv"
)

// `haven browser route`: a lane's requests matching a URL glob are answered with a
// fault (Playwright context routes in the daemon), so a page's failure and retry
// paths can be walked without stopping a service.

const routeUsage = "usage: haven browser route <add <glob> [--status <code>] [--times <n>] | off [glob] | list> --lane <name>"

// routeVerb maps `route <sub>` onto the daemon's verb.
func routeVerb(inv invocation) (string, invocation, error) {
	if len(inv.args) < 2 {
		return "", inv, errors.New(routeUsage)
	}
	sub := inv.args[1]
	switch sub {
	case "add", "off", "list":
	default:
		return "", inv, errors.New(routeUsage)
	}
	if sub != "add" && (inv.value("--status") != "" || inv.value("--times") != "") {
		return "", inv, errors.New("--status and --times are for route add")
	}
	inv.args = append([]string{"route-" + sub}, inv.args[2:]...)
	return "route-" + sub, inv, nil
}

// routeExtras maps route add's --status and --times onto the request.
func routeExtras(verb string, inv invocation, req map[string]any) error {
	if verb != "route-add" {
		return nil
	}
	for flag, field := range map[string]string{"--status": "status", "--times": "times"} {
		raw := inv.value(flag)
		if raw == "" {
			continue
		}
		n, err := strconv.Atoi(raw)
		if err != nil || n < 1 {
			return fmt.Errorf("%s %q is not a positive number", flag, raw)
		}
		req[field] = n
	}
	return nil
}

// printRoute prints a route verb's reply in plain text.
func printRoute(verb string, reply map[string]any) {
	switch verb {
	case "route-add":
		times := "every match"
		if reply["times"] != nil {
			times = fmt.Sprintf("%v match(es)", reply["times"])
		}
		fmt.Printf("routing %v -> %v for %s\n", reply["routed"], reply["status"], times)
	case "route-off":
		fmt.Printf("lifted %v\n", reply["lifted"])
	case "route-list":
		routes, _ := reply["routes"].([]any)
		if len(routes) == 0 {
			fmt.Println("no routes on this lane")
		}
		for _, raw := range routes {
			route, _ := raw.(map[string]any)
			fmt.Printf("%v -> %v (times %v, hits %v)\n", route["pattern"], route["status"], route["times"], route["hits"])
		}
	}
}
