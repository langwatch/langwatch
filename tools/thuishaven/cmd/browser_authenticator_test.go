package cmd

import (
	"strings"
	"testing"
)

func authenticatorRequest(t *testing.T, args ...string) (map[string]any, error) {
	t.Helper()
	inv, err := parse(browserSpec(), args)
	if err != nil {
		t.Fatal(err)
	}
	verb, inv, err := authenticatorVerb(inv)
	if err != nil {
		return nil, err
	}
	return browserRequest(verb, inv)
}

// @scenario "A passkey, a security key and a U2F key each attach with their own defaults"
func TestAuthenticatorAddKinds(t *testing.T) {
	cases := []struct {
		args []string
		want map[string]any
	}{
		{nil, map[string]any{"protocol": "ctap2", "transport": "internal", "hasResidentKey": true, "hasUserVerification": true, "isUserVerified": true}},
		{[]string{"--kind", "security-key"}, map[string]any{"protocol": "ctap2", "transport": "usb", "hasResidentKey": false, "hasUserVerification": false}},
		{[]string{"--kind", "security-key", "--uv", "yes", "--resident", "yes"}, map[string]any{"hasResidentKey": true, "hasUserVerification": true, "isUserVerified": true}},
		{[]string{"--kind", "u2f"}, map[string]any{"protocol": "u2f", "transport": "usb", "hasResidentKey": false, "hasUserVerification": false}},
		{[]string{"--kind", "passkey", "--uv", "no"}, map[string]any{"transport": "internal", "hasUserVerification": false, "isUserVerified": false}},
	}
	for _, c := range cases {
		req, err := authenticatorRequest(t, append([]string{"authenticator", "add", "--lane", "q"}, c.args...)...)
		if err != nil {
			t.Fatalf("%v: %v", c.args, err)
		}
		options := req["options"].(map[string]any)
		for key, want := range c.want {
			if options[key] != want {
				t.Errorf("%v: %s = %v, want %v", c.args, key, options[key], want)
			}
		}
		if options["automaticPresenceSimulation"] != true {
			t.Errorf("%v: presence is not simulated", c.args)
		}
	}
}

// @scenario "An authenticator command refuses what it cannot emulate"
func TestAuthenticatorRefusals(t *testing.T) {
	for _, args := range [][]string{
		{"authenticator", "add", "--lane", "q", "--kind", "yubikey"},
		{"authenticator", "add", "--lane", "q", "--uv", "maybe"},
		{"authenticator", "add", "--lane", "q", "--kind", "u2f", "--uv", "yes"},
		{"authenticator", "add", "--lane", "q", "--kind", "u2f", "--resident", "yes"},
		{"authenticator", "remove", "--lane", "q"},
		{"authenticator", "uv", "--lane", "q", "abc"},
		{"authenticator", "uv", "--lane", "q", "abc", "sometimes"},
		{"authenticator", "add"},
		{"authenticator", "reset", "--lane", "q"},
		{"authenticator"},
	} {
		if req, err := authenticatorRequest(t, args...); err == nil {
			t.Errorf("%v was accepted: %v", args, req)
		}
	}
}

// @scenario "Listing, removing and failing user verification address one authenticator by id"
func TestAuthenticatorByID(t *testing.T) {
	req, err := authenticatorRequest(t, "authenticator", "uv", "--lane", "q", "abc", "no")
	if err != nil || req["authenticatorId"] != "abc" || req["verified"] != false {
		t.Errorf("uv req = %v (%v)", req, err)
	}
	req, err = authenticatorRequest(t, "authenticator", "remove", "--lane", "q", "abc")
	if err != nil || req["authenticatorId"] != "abc" {
		t.Errorf("remove req = %v (%v)", req, err)
	}
	req, err = authenticatorRequest(t, "authenticator", "list", "--lane", "q")
	if err != nil || req["lane"] != "q" {
		t.Errorf("list req = %v (%v)", req, err)
	}
	if !strings.Contains(authenticatorUsage, "security-key") {
		t.Error("usage does not name the kinds")
	}
}
