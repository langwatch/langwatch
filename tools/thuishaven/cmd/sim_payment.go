package cmd

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/url"
	"strconv"
	"strings"
)

const paymentUsage = "usage: haven payment <status|events|usage|advance --seconds <n>|fail --customer <id> [--times <n>]|deliver --ids <a,b> [--secret <s>]|hold|release|reset> [--json]"

// runPayment is `haven payment <verb>`: paymentsim's control API from a terminal.
func runPayment(_ context.Context, d deps, inv invocation) error {
	if len(inv.args) == 0 {
		return errors.New(paymentUsage)
	}
	api, err := simAPI(d, inv, "payment")
	if err != nil {
		return err
	}
	asJSON := inv.has("--json") || d.isAgent
	post := func(path string, body any) error {
		var raw json.RawMessage
		if err := api.Post(path, body, &raw); err != nil {
			return err
		}
		return printSimRaw(raw)
	}
	switch inv.args[0] {
	case "status":
		return simGet(api, "/_sim/api/status", nil, asJSON, printOutboundDoc)
	case "events":
		return simGet(api, "/_sim/api/events", url.Values{"type": {inv.value("--type")}}, asJSON, printOutboundDoc)
	case "usage":
		return simGet(api, "/_sim/api/usage", url.Values{"customer": {inv.value("--customer")}}, asJSON, printOutboundDoc)
	case "advance":
		seconds, err := strconv.ParseInt(inv.value("--seconds"), 10, 64)
		if err != nil {
			return fmt.Errorf("advance needs --seconds <n>: %w", err)
		}
		return post("/_sim/api/clock/advance", map[string]int64{"seconds": seconds})
	case "fail":
		times, _ := strconv.Atoi(inv.value("--times"))
		return post("/_sim/api/payment-failures", map[string]any{"customer": inv.value("--customer"), "times": times})
	case "deliver":
		return post("/_sim/api/events/deliver", map[string]any{"ids": strings.Split(inv.value("--ids"), ","), "signingSecret": inv.value("--secret")})
	case "hold", "release":
		return post("/_sim/api/webhooks/hold", map[string]bool{"held": inv.args[0] == "hold"})
	case "reset":
		if err := api.Delete("/_sim/api/state"); err != nil {
			return err
		}
		return simDone(asJSON, "reset", "paymentsim state reset; the catalog stays")
	}
	return fmt.Errorf("unknown `haven payment` subcommand %q; %s", inv.args[0], paymentUsage)
}
