package cmd

import (
	"errors"
	"fmt"
)

// `haven browser authenticator`: a virtual WebAuthn authenticator on a lane's
// page, through Chromium's CDP WebAuthn domain. A WebAuthn ceremony runs in
// the browser, so the stand-in lives there, not in a server sim.

const authenticatorUsage = "usage: haven browser authenticator <add [--kind passkey|security-key|u2f] [--uv yes|no] [--resident yes|no] | list | remove <id> | uv <id> yes|no> --lane <name>"

// authenticatorVerb maps `authenticator <sub>` onto the daemon's verb, as recordVerb does.
func authenticatorVerb(inv invocation) (string, invocation, error) {
	if len(inv.args) < 2 {
		return "", inv, errors.New(authenticatorUsage)
	}
	switch sub := inv.args[1]; sub {
	case "add", "list", "remove", "uv":
		inv.args = append([]string{"authenticator-" + sub}, inv.args[2:]...)
		return "authenticator-" + sub, inv, nil
	}
	return "", inv, errors.New(authenticatorUsage)
}

// yesNo reads a yes|no flag or argument; def when it is absent.
func yesNo(name, raw string, def bool) (bool, error) {
	switch raw {
	case "":
		return def, nil
	case "yes":
		return true, nil
	case "no":
		return false, nil
	}
	return false, fmt.Errorf("%s %q is not yes or no", name, raw)
}

// authenticatorOptions builds CDP's VirtualAuthenticatorOptions for --kind, --uv and --resident.
func authenticatorOptions(inv invocation) (map[string]any, error) {
	protocol, transport, resident, uv := "ctap2", "internal", true, true
	switch kind := inv.value("--kind"); kind {
	case "", "passkey":
	case "security-key":
		transport, resident, uv = "usb", false, false
	case "u2f":
		protocol, transport, resident, uv = "u2f", "usb", false, false
	default:
		return nil, fmt.Errorf("--kind %q is not passkey, security-key or u2f", kind)
	}
	uv, err := yesNo("--uv", inv.value("--uv"), uv)
	if err != nil {
		return nil, err
	}
	if resident, err = yesNo("--resident", inv.value("--resident"), resident); err != nil {
		return nil, err
	}
	if protocol == "u2f" && (uv || resident) {
		return nil, errors.New("a u2f authenticator has no user verification and no resident keys; use --kind security-key")
	}
	return map[string]any{
		"protocol": protocol, "transport": transport, "hasResidentKey": resident,
		"hasUserVerification": uv, "isUserVerified": uv, "automaticPresenceSimulation": true,
	}, nil
}

// authenticatorExtras adds add's options and uv's yes|no to the request.
func authenticatorExtras(verb string, inv invocation, req map[string]any) error {
	switch verb {
	case "authenticator-add":
		options, err := authenticatorOptions(inv)
		if err != nil {
			return err
		}
		req["options"] = options
		req["kind"] = inv.value("--kind")
		if req["kind"] == "" {
			req["kind"] = "passkey"
		}
	case "authenticator-uv":
		verified, err := yesNo("uv", fmt.Sprint(req["verified"]), false)
		if err != nil {
			return err
		}
		req["verified"] = verified
	}
	return nil
}

func printAuthenticators(reply map[string]any) {
	list, _ := reply["authenticators"].([]any)
	if len(list) == 0 {
		fmt.Println("no authenticators on this lane")
	}
	for _, raw := range list {
		a, _ := raw.(map[string]any)
		fmt.Printf("%v  %v  uv=%v\n", a["id"], a["kind"], a["userVerified"])
		credentials, _ := a["credentials"].([]any)
		for _, rawCredential := range credentials {
			c, _ := rawCredential.(map[string]any)
			fmt.Printf("  %v  rp=%v  user=%v  signCount=%v  resident=%v\n", c["credentialId"], c["rpId"], c["userHandle"], c["signCount"], c["isResidentCredential"])
		}
	}
}
