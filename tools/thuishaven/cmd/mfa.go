package cmd

import (
	"context"
	"errors"
	"fmt"
)

// `haven mfa` (mfasim): second factors on a haven browser lane. Passkeys and
// security keys are Chromium's CDP WebAuthn domain; TOTP codes come from a
// secret the daemon reads off the enrollment page and keeps in the lane's
// state, so neither the secret nor a code ever reaches the caller.

const mfaUsage = "usage: haven mfa <add [--kind passkey|security-key|u2f] [--uv yes|no] [--resident yes|no] | list | remove <id> | uv <id> yes|no | totp enroll [ref] | totp fill <ref> [--wrong]> --lane <name>"

func mfaSpec() commandSpec {
	return commandSpec{
		name:    "mfa",
		summary: "mfasim on a haven browser lane: virtual passkeys and security keys (add | list | remove | uv) and TOTP codes typed without showing them (totp enroll | totp fill)",
		args:    "<add|list|remove|uv|totp> [id|enroll|fill] [yes|no|ref]",
		maxArgs: 3,
		flags: simFlags(
			flagSpec{long: "--lane", takesValue: true, value: "<name>", summary: "the haven browser lane whose page holds the factors"},
			flagSpec{long: "--as", takesValue: true, value: "<admin|email>", summary: "sign the lane in as this login first, as haven browser --as"},
			flagSpec{long: "--kind", takesValue: true, value: "<passkey|security-key|u2f>", summary: "add: the virtual authenticator to attach (default passkey)"},
			flagSpec{long: "--uv", takesValue: true, value: "<yes|no>", summary: "add: whether it verifies the user (fingerprint or PIN)"},
			flagSpec{long: "--resident", takesValue: true, value: "<yes|no>", summary: "add: whether it keeps discoverable credentials"},
			flagSpec{long: "--wrong", summary: "totp fill: type a code that is wrong in every accepted time window"},
			flagSpec{long: "--timeout", takesValue: true, value: "<dur>", summary: "how long a command may wait on the page (default 30s)"},
		),
		run: runMfa,
	}
}

func runMfa(ctx context.Context, d deps, inv invocation) error {
	verb, inv, err := mfaVerb(inv)
	if err != nil {
		return err
	}
	return driveBrowser(ctx, d, verb, inv)
}

// mfaVerb maps `mfa <sub>` (and `mfa totp <sub>`) onto the daemon's verb.
func mfaVerb(inv invocation) (string, invocation, error) {
	if len(inv.args) == 0 {
		return "", inv, errors.New(mfaUsage)
	}
	sub, rest := inv.args[0], inv.args[1:]
	switch sub {
	case "add", "list", "remove", "uv":
	case "totp":
		if len(rest) == 0 || (rest[0] != "enroll" && rest[0] != "fill") {
			return "", inv, errors.New(mfaUsage)
		}
		sub, rest = "totp-"+rest[0], rest[1:]
	default:
		return "", inv, errors.New(mfaUsage)
	}
	if inv.has("--wrong") && sub != "totp-fill" {
		return "", inv, errors.New("--wrong is for totp fill only")
	}
	inv.args = append([]string{"mfa-" + sub}, rest...)
	return "mfa-" + sub, inv, nil
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

// mfaExtras adds add's options, uv's yes|no and fill's --wrong to the request.
func mfaExtras(verb string, inv invocation, req map[string]any) error {
	switch verb {
	case "mfa-add":
		options, err := authenticatorOptions(inv)
		if err != nil {
			return err
		}
		req["options"] = options
		req["kind"] = inv.value("--kind")
		if req["kind"] == "" {
			req["kind"] = "passkey"
		}
	case "mfa-uv":
		verified, err := yesNo("uv", fmt.Sprint(req["verified"]), false)
		if err != nil {
			return err
		}
		req["verified"] = verified
	case "mfa-totp-fill":
		req["wrong"] = inv.has("--wrong")
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
