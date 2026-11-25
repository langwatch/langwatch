package cmd

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/url"
	"strconv"
	"time"

	"github.com/langwatch/langwatch/tools/thuishaven/cmd/viewer/sources"
)

const outboundUsage = "usage: haven sim outbound <status|list|deliveries|clear|wait --channel <name>|fault add|list|clear|receiver set <name> --secret <s>|urls> [--json]"

// outboundPollEvery is how often `wait` re-reads the records.
const outboundPollEvery = 250 * time.Millisecond

type outboundRecord struct {
	ID         string    `json:"id"`
	Channel    string    `json:"channel"`
	Target     string    `json:"target"`
	ReceivedAt time.Time `json:"receivedAt"`
}

type outboundRecords struct {
	Records []outboundRecord `json:"records"`
}

// outboundFault is the body of POST /_sim/api/faults.
type outboundFault struct {
	Channel    string `json:"channel"`
	Target     string `json:"target"`
	Status     int    `json:"status,omitempty"`
	Body       string `json:"body,omitempty"`
	RetryAfter int    `json:"retryAfter,omitempty"`
	LatencyMs  int    `json:"latencyMs,omitempty"`
	Drop       bool   `json:"drop,omitempty"`
	Times      int    `json:"times,omitempty"`
}

// outboundCLI is one `haven sim outbound` call: the sim, the words and the output mode.
type outboundCLI struct {
	api    sources.SimAPI
	inv    invocation
	asJSON bool
}

// runOutbound is `haven sim outbound <status|list|deliveries|clear|wait|fault|receiver|urls>`.
func runOutbound(ctx context.Context, d deps, inv invocation) error {
	if len(inv.args) == 0 {
		return errors.New(outboundUsage)
	}
	api, err := simAPI(d, inv, "outbound")
	if err != nil {
		return err
	}
	return outboundCommand(ctx, outboundCLI{api: api, inv: inv, asJSON: inv.has("--json") || d.isAgent})
}

func outboundCommand(ctx context.Context, c outboundCLI) error {
	switch c.inv.args[0] {
	case "status":
		return simGet(c.api, "/_sim/api/status", nil, c.asJSON, printOutboundDoc)
	case "records":
		return simGet(c.api, "/_sim/api/records", outboundFilter(c.inv), c.asJSON, printOutboundRecords)
	case "deliveries":
		return simGet(c.api, "/_sim/api/deliveries", outboundFilter(c.inv), c.asJSON, printOutboundDoc)
	case "urls":
		return simGet(c.api, "/_sim/api/setup", nil, c.asJSON, printOutboundDoc)
	case "clear":
		if err := c.api.Delete("/_sim/api/records"); err != nil {
			return err
		}
		return simDone(c.asJSON, "cleared", "records cleared")
	case "wait":
		return outboundWait(ctx, c)
	case "fault":
		return outboundFaultCommand(c)
	case "receiver":
		return outboundReceiver(c)
	}
	return fmt.Errorf("unknown `haven sim outbound` subcommand %q; %s", c.inv.args[0], outboundUsage)
}

// outboundFilter maps the flags onto the sim's query.
func outboundFilter(inv invocation) url.Values {
	q := url.Values{}
	for flag, key := range map[string]string{"--channel": "channel", "--target": "target", "--event-id": "eventId", "--since": "since"} {
		if v := inv.value(flag); v != "" {
			q.Set(key, v)
		}
	}
	return q
}

// printOutboundDoc shows a sim document as indented JSON; it has no table of its own.
func printOutboundDoc(raw json.RawMessage) { _ = printSimRaw(raw) }

func printOutboundRecords(v outboundRecords) {
	if len(v.Records) == 0 {
		fmt.Println("no records")
	}
	for _, r := range v.Records {
		fmt.Printf("%-14s %-36s %-28s %s\n", r.Channel, r.Target, r.ID, r.ReceivedAt.Format(time.RFC3339))
	}
}

type outboundWaitPlan struct {
	timeout time.Duration
	count   int
}

func outboundWaitFor(inv invocation) (outboundWaitPlan, error) {
	if !inv.has("--channel") {
		return outboundWaitPlan{}, errors.New("usage: haven sim outbound wait --channel <name> [--target] [--count] [--timeout 30s]")
	}
	timeout := mailWaitDefaultTimeout
	if raw := inv.value("--timeout"); raw != "" {
		parsed, err := time.ParseDuration(raw)
		if err != nil {
			return outboundWaitPlan{}, fmt.Errorf("--timeout %q is not a valid duration, e.g. 30s: %w", raw, err)
		}
		timeout = parsed
	}
	count, err := intFlag(inv, "--count", 1)
	return outboundWaitPlan{timeout: timeout, count: count}, err
}

// records reads the filtered records once: the sim's own document and its decoded form.
func (c outboundCLI) records() (json.RawMessage, outboundRecords, error) {
	var raw json.RawMessage
	var found outboundRecords
	if err := c.api.Get("/_sim/api/records", outboundFilter(c.inv), &raw); err != nil {
		return nil, found, err
	}
	err := json.Unmarshal(raw, &found)
	return raw, found, err
}

// outboundWait polls until --count records match; no match in --timeout is an error.
func outboundWait(ctx context.Context, c outboundCLI) error {
	plan, err := outboundWaitFor(c.inv)
	if err != nil {
		return err
	}
	deadline := time.Now().Add(plan.timeout)
	for {
		raw, found, err := c.records()
		if err != nil {
			return err
		}
		if len(found.Records) >= plan.count {
			return outboundShow(c, raw, found)
		}
		if time.Now().After(deadline) {
			return fmt.Errorf("no record matched within %s", plan.timeout)
		}
		select {
		case <-ctx.Done():
			return ctx.Err()
		case <-time.After(outboundPollEvery):
		}
	}
}

func outboundShow(c outboundCLI, raw json.RawMessage, found outboundRecords) error {
	if c.asJSON {
		return printSimRaw(raw)
	}
	printOutboundRecords(found)
	return nil
}

func outboundArg(inv invocation, i int) string {
	if len(inv.args) > i {
		return inv.args[i]
	}
	return ""
}

// intFlag reads a whole-number flag, fallback when it is absent.
func intFlag(inv invocation, flag string, fallback int) (int, error) {
	raw := inv.value(flag)
	if raw == "" {
		return fallback, nil
	}
	n, err := strconv.Atoi(raw)
	if err != nil {
		return 0, fmt.Errorf("%s %q is not a whole number", flag, raw)
	}
	return n, nil
}

func outboundFaultCommand(c outboundCLI) error {
	switch outboundArg(c.inv, 1) {
	case "list":
		return simGet(c.api, "/_sim/api/faults", nil, c.asJSON, printOutboundDoc)
	case "add":
		return outboundFaultAdd(c)
	case "clear":
		return outboundFaultClear(c)
	}
	return errors.New("usage: haven sim outbound fault <add --channel <name> [--target <glob>] [--status <code>] [--body] [--retry-after] [--latency] [--drop] [--times]|list|clear [id]>")
}

func outboundFaultFrom(inv invocation) (outboundFault, error) {
	f := outboundFault{Channel: inv.value("--channel"), Target: inv.value("--target"), Body: inv.value("--body"), Drop: inv.has("--drop")}
	if f.Channel == "" {
		return f, errors.New("fault add needs --channel")
	}
	if f.Target == "" {
		f.Target = "*"
	}
	for _, n := range []struct {
		flag string
		into *int
	}{{"--status", &f.Status}, {"--retry-after", &f.RetryAfter}, {"--latency", &f.LatencyMs}, {"--times", &f.Times}} {
		v, err := intFlag(inv, n.flag, 0)
		if err != nil {
			return f, err
		}
		*n.into = v
	}
	return f, nil
}

func outboundFaultAdd(c outboundCLI) error {
	fault, err := outboundFaultFrom(c.inv)
	if err != nil {
		return err
	}
	var raw json.RawMessage
	if err := c.api.Post("/_sim/api/faults", fault, &raw); err != nil {
		return err
	}
	return printSimRaw(raw)
}

// outboundFaultClear removes one fault by id, or every fault when none is named.
func outboundFaultClear(c outboundCLI) error {
	path := "/_sim/api/faults"
	if id := outboundArg(c.inv, 2); id != "" {
		path += "/" + url.PathEscape(id)
	}
	if err := c.api.Delete(path); err != nil {
		return err
	}
	return simDone(c.asJSON, "cleared", "faults cleared")
}

// outboundReceiver is `receiver set <name> --secret <s>`: the secret a webhook receiver verifies with.
func outboundReceiver(c outboundCLI) error {
	name, secret := outboundArg(c.inv, 2), c.inv.value("--secret")
	if outboundArg(c.inv, 1) != "set" || name == "" || secret == "" {
		return errors.New("usage: haven sim outbound receiver set <name> --secret <secret>")
	}
	if err := c.api.Put("/_sim/api/receivers/"+url.PathEscape(name), map[string]string{"secret": secret}, nil); err != nil {
		return err
	}
	return simDone(c.asJSON, "set", "receiver "+name+" set")
}
