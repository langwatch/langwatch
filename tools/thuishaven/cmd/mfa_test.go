package cmd

import (
	"strings"
	"testing"
)

func mfaRequest(t *testing.T, args ...string) (map[string]any, error) {
	t.Helper()
	inv, err := parse(mfaSpec(), args)
	if err != nil {
		return nil, err
	}
	verb, inv, err := mfaVerb(inv)
	if err != nil {
		return nil, err
	}
	return browserRequest(verb, inv)
}

// @scenario "A passkey, a security key and a U2F key each attach with their own defaults"
func TestMfaAddKinds(t *testing.T) {
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
		req, err := mfaRequest(t, append([]string{"add", "--lane", "q"}, c.args...)...)
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
func TestMfaRefusals(t *testing.T) {
	for _, args := range [][]string{
		{"add", "--lane", "q", "--kind", "yubikey"},
		{"add", "--lane", "q", "--uv", "maybe"},
		{"add", "--lane", "q", "--kind", "u2f", "--uv", "yes"},
		{"add", "--lane", "q", "--kind", "u2f", "--resident", "yes"},
		{"remove", "--lane", "q"},
		{"uv", "--lane", "q", "abc"},
		{"uv", "--lane", "q", "abc", "sometimes"},
		{"add"},
		{"reset", "--lane", "q"},
		{},
	} {
		if req, err := mfaRequest(t, args...); err == nil {
			t.Errorf("%v was accepted: %v", args, req)
		}
	}
}

// @scenario "Listing, removing and failing user verification address one authenticator by id"
func TestMfaByID(t *testing.T) {
	req, err := mfaRequest(t, "uv", "--lane", "q", "abc", "no")
	if err != nil || req["authenticatorId"] != "abc" || req["verified"] != false {
		t.Errorf("uv req = %v (%v)", req, err)
	}
	req, err = mfaRequest(t, "remove", "--lane", "q", "abc")
	if err != nil || req["authenticatorId"] != "abc" {
		t.Errorf("remove req = %v (%v)", req, err)
	}
	req, err = mfaRequest(t, "list", "--lane", "q")
	if err != nil || req["lane"] != "q" {
		t.Errorf("list req = %v (%v)", req, err)
	}
	if !strings.Contains(mfaUsage, "security-key") {
		t.Error("usage does not name the kinds")
	}
}

// @scenario "TOTP enroll reads the secret off the page and keeps it from the caller"
func TestMfaTotpEnroll(t *testing.T) {
	req, err := mfaRequest(t, "totp", "enroll", "--lane", "q")
	if err != nil || req["lane"] != "q" || req["ref"] != nil {
		t.Errorf("enroll req = %v (%v)", req, err)
	}
	req, err = mfaRequest(t, "totp", "enroll", "e12", "--lane", "q")
	if err != nil || req["ref"] != "e12" {
		t.Errorf("enroll with a ref = %v (%v)", req, err)
	}
}

// @scenario "TOTP fill types the current code, or a wrong one, without printing it"
func TestMfaTotpFill(t *testing.T) {
	req, err := mfaRequest(t, "totp", "fill", "e7", "--lane", "q")
	if err != nil || req["ref"] != "e7" || req["wrong"] != false {
		t.Errorf("fill req = %v (%v)", req, err)
	}
	req, err = mfaRequest(t, "totp", "fill", "e7", "--lane", "q", "--wrong")
	if err != nil || req["wrong"] != true {
		t.Errorf("fill --wrong req = %v (%v)", req, err)
	}
	for _, args := range [][]string{
		{"totp", "fill", "--lane", "q"},
		{"totp", "--lane", "q"},
		{"totp", "show", "--lane", "q"},
		{"add", "--lane", "q", "--wrong"},
		{"totp", "enroll", "--lane", "q", "--wrong"},
	} {
		if req, err := mfaRequest(t, args...); err == nil {
			t.Errorf("%v was accepted: %v", args, req)
		}
	}
}
