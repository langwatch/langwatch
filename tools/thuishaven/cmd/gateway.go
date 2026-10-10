package cmd

import (
	"context"
	"errors"
	"net/http"
	"os"
	"strings"
)

// `haven gateway` calls this stack's AI gateway (the `+gateway` add-on) with a
// virtual key for local-dev-project that haven mints through the product's
// virtual-key route and holds beside its other keys. The secret never prints.

const defaultVirtualKey = "default"

func gatewaySpec() commandSpec {
	return commandSpec{
		name:    "gateway",
		summary: "call this stack's AI gateway with a virtual key haven mints and holds, which is never printed: <METHOD> <path>",
		args:    "<METHOD> <path>",
		maxArgs: 2,
		flags: []flagSpec{
			{long: "--vk", takesValue: true, value: "<name>", summary: "the named virtual key to use, minted on first use (default " + defaultVirtualKey + ")"},
			{long: "--body", takesValue: true, value: "<file>|-", summary: "request body from a file, or - for stdin (Content-Type defaults to application/json)"},
			{long: "--header", takesValue: true, value: "<k:v>", summary: "an extra request header (repeatable)"},
			{long: "--json", summary: "one JSON object: status, headers, body"},
			{long: "--stack", takesValue: true, value: "<slug>", summary: "another worktree's stack by slug"},
		},
		run: runGateway,
	}
}

func runGateway(ctx context.Context, d deps, inv invocation) error {
	if len(inv.args) != 2 {
		return errors.New("usage: haven gateway <METHOD> <path> [--vk name] [--body file|-] [--header k:v] [--json]")
	}
	ring, err := stackKeyring(d, inv)
	if err != nil {
		return err
	}
	overlay := telemetryOverlay(d, inv)
	base := telemetryOverlayValue(overlay, "LW_GATEWAY_INTERNAL_URL")
	if base == "" {
		base = telemetryOverlayValue(overlay, "LW_GATEWAY_PUBLIC_URL")
	}
	if base == "" {
		return errors.New("haven gateway: this stack runs no AI gateway; start it with haven up +gateway --agent -d")
	}
	body, err := apiBody(inv.value("--body"))
	if err != nil {
		return err
	}
	vk := inv.value("--vk")
	if vk == "" {
		vk = defaultVirtualKey
	}
	res, err := ring.callGateway(ctx, vk, apiCall{
		base: base, method: strings.ToUpper(inv.args[0]), path: inv.args[1],
		headers: repeatedValues(inv.raw, "--header"), body: body, bearer: true,
	})
	if err != nil {
		return err
	}
	return printAPIResult(os.Stdout, res, inv.has("--json") || d.isAgent)
}

// callGateway makes c with the virtual key held as vk, minting it on first use
// and once more on a 401 (the stack was reseeded or reset since).
func (k keyring) callGateway(ctx context.Context, vk string, c apiCall) (apiResult, error) {
	name := "vk:" + vk
	for attempt := 0; ; attempt++ {
		held, err := k.held(name, func() (heldKey, error) { return k.mintVirtualKey(ctx, vk) })
		if err != nil {
			return apiResult{}, err
		}
		c.key, c.scrubs = held.Secret, k.secrets()
		res, err := callAPI(ctx, c)
		if err != nil || res.Status != http.StatusUnauthorized || attempt > 0 {
			return res, err
		}
		if err := k.forget(name); err != nil {
			return apiResult{}, err
		}
	}
}

// mintVirtualKey creates a virtual key scoped to local-dev-project through
// POST /api/gateway/v1/virtual-keys, called with the seeded project key.
func (k keyring) mintVirtualKey(ctx context.Context, vk string) (heldKey, error) {
	var minted struct {
		Secret     string `json:"secret"`
		VirtualKey struct {
			ID string `json:"id"`
		} `json:"virtual_key"`
	}
	if err := k.request(ctx, http.MethodPost, k.api+"/api/gateway/v1/virtual-keys", k.seeded, map[string]any{"name": "haven " + vk}, &minted); err != nil {
		return heldKey{}, err
	}
	if minted.Secret == "" {
		return heldKey{}, errors.New("haven gateway: the virtual-key route minted no secret")
	}
	return heldKey{Secret: minted.Secret, ID: minted.VirtualKey.ID}, nil
}
