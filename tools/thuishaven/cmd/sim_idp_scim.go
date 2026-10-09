package cmd

import (
	"errors"
	"fmt"
	"net/url"
	"os"
	"strconv"
	"strings"
)

// The SCIM, legacy-provider and Auth0-webhook verbs of `haven idp`.

// scimReceiver is the body that points a push, pull, sync or event at a SCIM
// service provider other than the tenant's own connection; empty keeps the connection.
func scimReceiver(c idpCall) (map[string]any, error) {
	body := map[string]any{}
	if !c.inv.has("--target") {
		return body, nil
	}
	token, err := envSecret(c.inv, "--token-env")
	if err != nil {
		return nil, err
	}
	body["target"], body["token"] = c.inv.value("--target"), token
	return body, nil
}

func idpSCIMTargetSet(c idpCall) error {
	token, err := envSecret(c.inv, "--token-env")
	if err != nil {
		return err
	}
	t, err := c.tenant()
	if err != nil {
		return err
	}
	if !c.inv.has("--url") || token == "" {
		return errors.New("usage: haven idp scim target set <tenant> --url <scim-base> --token-env <VAR>")
	}
	return c.put("/control/t/"+t+"/scim-target", map[string]string{"baseUrl": c.inv.value("--url"), "token": token})
}

func idpSCIMTargetClear(c idpCall) error {
	t, err := c.tenant()
	if err != nil {
		return err
	}
	if err := c.api.Delete("/control/t/" + t + "/scim-target"); err != nil {
		return err
	}
	return simDone(c.asJSON, "cleared", "SCIM target cleared")
}

func idpSCIMPush(c idpCall) error { return scimDrive(c, "scim-push") }

func idpSCIMPull(c idpCall) error { return scimDrive(c, "scim-pull") }

// scimDrive posts the receiver body to a tenant's scim-<leaf> endpoint.
func scimDrive(c idpCall, leaf string) error {
	body, err := scimReceiver(c)
	if err != nil {
		return err
	}
	return c.postTenant(leaf, body)
}

func idpSCIMSync(c idpCall) error {
	body, err := scimReceiver(c)
	if err != nil {
		return err
	}
	t, err := c.tenant()
	if err != nil {
		return err
	}
	params := url.Values{}
	for flag, key := range map[string]string{"--mode": "mode", "--concurrency": "concurrency"} {
		if c.inv.has(flag) {
			params.Set(key, c.inv.value(flag))
		}
	}
	for flag, key := range map[string]string{"--with-groups": "groups", "--dry-run": "dryRun"} {
		if c.inv.has(flag) {
			params.Set(key, "1")
		}
	}
	return c.post("/control/t/"+t+"/scim-sync?"+params.Encode(), body)
}

func idpSCIMEvent(c idpCall) error {
	body, err := scimReceiver(c)
	if err != nil {
		return err
	}
	set, err := setPairs(c.inv)
	if err != nil {
		return err
	}
	body["kind"], body["set"] = c.rest[1], set
	for flag, key := range map[string]string{
		"--style": "style", "--user": "user", "--group": "group", "--id": "id", "--member-id": "memberId",
	} {
		if c.inv.has(flag) {
			body[key] = c.inv.value(flag)
		}
	}
	body["inactive"], body["noExternalId"] = c.inv.has("--inactive"), c.inv.has("--no-external-id")
	if enterprise := enterpriseAttrs(c); len(enterprise) > 0 {
		body["enterprise"] = enterprise
	}
	return c.postTenant("scim-event", body)
}

func enterpriseAttrs(c idpCall) map[string]string {
	out := map[string]string{}
	for flag, key := range map[string]string{"--department": "department", "--cost-center": "costCenter", "--manager": "manager"} {
		if c.inv.has(flag) {
			out[key] = c.inv.value(flag)
		}
	}
	return out
}

// setPairs reads every --set k=v. The flag parser keeps only the last
// occurrence of a repeated flag, so the raw arguments are scanned instead.
func setPairs(inv invocation) (map[string]any, error) {
	out := map[string]any{}
	for i, arg := range inv.raw {
		pair, ok := strings.CutPrefix(arg, "--set=")
		if arg == "--set" && i+1 < len(inv.raw) {
			pair, ok = inv.raw[i+1], true
		}
		if !ok {
			continue
		}
		key, value, found := strings.Cut(pair, "=")
		if !found || key == "" {
			return nil, fmt.Errorf("--set needs key=value, got %q", pair)
		}
		out[key] = typedValue(value)
	}
	return out, nil
}

// typedValue reads true and false as booleans, as the active attribute needs.
func typedValue(raw string) any {
	if b, err := strconv.ParseBool(raw); err == nil && (raw == "true" || raw == "false") {
		return b
	}
	return raw
}

func idpLegacyProvider(c idpCall) error {
	body := map[string]string{}
	if c.rest[1] != "show" {
		body["provider"] = c.rest[1]
	}
	return c.postTenant("legacy-provider", body)
}

// idpLegacyEnv prints the env lines that make a stack use the tenant's legacy provider.
func idpLegacyEnv(c idpCall) error {
	t, err := c.tenant()
	if err != nil {
		return err
	}
	raw, err := c.api.GetRaw("/control/t/"+t+"/legacy-env", nil)
	if err != nil {
		return err
	}
	_, err = os.Stdout.Write(raw)
	return err
}

func idpTamper(c idpCall) error {
	return c.postTenant("tamper", map[string]string{"mode": c.rest[1]})
}

// idpAuth0Webhook sends one signed Auth0 log-stream event; the secret comes from the
// environment only and idpsim never echoes it.
func idpAuth0Webhook(c idpCall) error {
	secret, err := envSecret(c.inv, "--secret-env")
	if err != nil {
		return err
	}
	token, err := envSecret(c.inv, "--token-env")
	if err != nil {
		return err
	}
	if secret == "" || !c.inv.has("--target") || !c.inv.has("--event") || !c.inv.has("--user") {
		return errors.New("usage: haven idp auth0-webhook <tenant> --event create|deactivate --user <u> --target <stack-url> --secret-env <VAR>")
	}
	return c.postTenant("auth0-webhook", map[string]string{
		"target": c.inv.value("--target"), "secret": secret, "token": token,
		"event": c.inv.value("--event"), "user": c.inv.value("--user"),
	})
}
