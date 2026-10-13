package cmd

import "testing"

// @scenario "A browser lane can fault matching requests to walk a failure and its retry"
func TestBrowserRouteVerbs(t *testing.T) {
	inv, _ := parse(browserSpec(), []string{"route", "add", "**/api/trpc/**", "--status", "500", "--times", "2", "--lane", "a"})
	verb, inv, err := routeVerb(inv)
	if err != nil || verb != "route-add" {
		t.Fatalf("verb = %q (%v)", verb, err)
	}
	req, err := browserRequest(verb, inv)
	if err != nil {
		t.Fatal(err)
	}
	if req["pattern"] != "**/api/trpc/**" || req["status"] != 500 || req["times"] != 2 || req["lane"] != "a" {
		t.Errorf("route add req = %v", req)
	}

	inv, _ = parse(browserSpec(), []string{"route", "off", "--lane", "a"})
	verb, inv, _ = routeVerb(inv)
	if req, err := browserRequest(verb, inv); err != nil || verb != "route-off" || req["pattern"] != nil {
		t.Errorf("route off = %q %v (%v)", verb, req, err)
	}

	inv, _ = parse(browserSpec(), []string{"route", "list", "--lane", "a"})
	if verb, _, err := routeVerb(inv); err != nil || verb != "route-list" {
		t.Errorf("route list = %q (%v)", verb, err)
	}
}

func TestBrowserRouteRefusals(t *testing.T) {
	for _, args := range [][]string{
		{"route", "--lane", "a"},
		{"route", "block", "**/x", "--lane", "a"},
		{"route", "off", "--status", "500", "--lane", "a"},
	} {
		inv, _ := parse(browserSpec(), args)
		if _, _, err := routeVerb(inv); err == nil {
			t.Errorf("%v was accepted", args)
		}
	}
	inv, _ := parse(browserSpec(), []string{"route", "add", "--lane", "a"})
	verb, inv, _ := routeVerb(inv)
	if _, err := browserRequest(verb, inv); err == nil {
		t.Error("route add without a pattern was accepted")
	}
	inv, _ = parse(browserSpec(), []string{"route", "add", "**/x", "--times", "0", "--lane", "a"})
	verb, inv, _ = routeVerb(inv)
	if _, err := browserRequest(verb, inv); err == nil {
		t.Error("--times 0 was accepted")
	}
}
