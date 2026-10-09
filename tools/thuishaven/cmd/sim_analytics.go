package cmd

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"maps"
	"net/url"
	"slices"
	"time"

	"github.com/langwatch/langwatch/tools/thuishaven/cmd/viewer/sources"
)

const analyticsUsage = "usage: haven analytics <status|records [--provider] [--kind] [--event|--name] [--id]|record <id>|clear|wait --event <name> [--timeout]> [--json]"

// analyticsPollEvery is how often `wait` re-reads the records.
const analyticsPollEvery = 250 * time.Millisecond

type analyticsRecord struct {
	ID         string    `json:"id"`
	Provider   string    `json:"provider"`
	Kind       string    `json:"kind"`
	DistinctID string    `json:"distinctId"`
	Name       string    `json:"name"`
	ReceivedAt time.Time `json:"receivedAt"`
}

// analyticsStatus is the sim's status, activity included: seeded records are left out of it.
type analyticsStatus struct {
	Stack    string `json:"stack"`
	Records  int    `json:"records"`
	BaseURL  string `json:"baseUrl"`
	Activity struct {
		Total           int        `json:"total"`
		LastFiveMinutes int        `json:"lastFiveMinutes"`
		DistinctIDs     int        `json:"distinctIds"`
		LastReceivedAt  *time.Time `json:"lastReceivedAt"`
		LastName        string     `json:"lastName"`
	} `json:"activity"`
}

// runAnalytics is `haven analytics <status|records|clear|wait>`.
func runAnalytics(ctx context.Context, d deps, inv invocation) error {
	if len(inv.args) == 0 {
		return errors.New(analyticsUsage)
	}
	api, err := simAPI(d, inv, "analytics")
	if err != nil {
		return err
	}
	return analyticsCommand(ctx, api, inv, inv.has("--json") || d.isAgent)
}

// analyticsFilter maps the flags onto the sim's query: --event and --name are the record's name.
func analyticsFilter(inv invocation) url.Values {
	q := url.Values{}
	for flag, key := range map[string]string{"--provider": "provider", "--kind": "kind", "--event": "name", "--name": "name", "--id": "id"} {
		if v := inv.value(flag); v != "" {
			q.Set(key, v)
		}
	}
	return q
}

func analyticsCommand(ctx context.Context, api sources.SimAPI, inv invocation, asJSON bool) error {
	switch inv.args[0] {
	case "status":
		return simGet(api, "/_sim/api/status", nil, asJSON, printAnalyticsStatus)
	case "records":
		return simGet(api, "/_sim/api/records", analyticsFilter(inv), asJSON, printAnalyticsRecords)
	case "record":
		return analyticsOneRecord(api, inv, asJSON)
	case "clear":
		if err := api.Delete("/_sim/api/records"); err != nil {
			return err
		}
		return simDone(asJSON, "cleared", "records cleared")
	case "wait":
		return analyticsWait(ctx, api, inv, asJSON)
	}
	return fmt.Errorf("unknown `haven analytics` subcommand %q; %s", inv.args[0], analyticsUsage)
}

func printAnalyticsStatus(v analyticsStatus) {
	fmt.Printf("stack: %s\nrecords: %d\nbase URL: %s\n", v.Stack, v.Records, v.BaseURL)
	a := v.Activity
	fmt.Printf("activity: %d since start, %d in the last five minutes from %d distinct ids\n", a.Total, a.LastFiveMinutes, a.DistinctIDs)
	if a.LastReceivedAt != nil {
		fmt.Printf("last call: %s at %s\n", a.LastName, a.LastReceivedAt.Format(time.RFC3339))
	}
}

// analyticsOneRecord picks a record out of the list, properties and raw call
// included: the sim has no per-record endpoint.
func analyticsOneRecord(api sources.SimAPI, inv invocation, asJSON bool) error {
	if err := needArgs(inv, 2, "haven analytics record <id>"); err != nil {
		return err
	}
	var all struct {
		Records []json.RawMessage `json:"records"`
	}
	if err := api.Get("/_sim/api/records", nil, &all); err != nil {
		return err
	}
	for _, raw := range all.Records {
		var r struct {
			analyticsRecord
			Properties map[string]any  `json:"properties"`
			Raw        json.RawMessage `json:"raw"`
		}
		if err := json.Unmarshal(raw, &r); err != nil || r.ID != inv.args[1] {
			continue
		}
		if asJSON {
			return printSimRaw(raw)
		}
		fmt.Printf("%s %s %s %s\ndistinct id: %s\nreceived: %s\n", r.ID, r.Provider, r.Kind, r.Name, r.DistinctID, r.ReceivedAt.Format(time.RFC3339))
		for _, key := range slices.Sorted(maps.Keys(r.Properties)) {
			value, _ := json.Marshal(r.Properties[key])
			fmt.Printf("  %s: %s\n", key, value)
		}
		fmt.Printf("raw: %s\n", r.Raw)
		return nil
	}
	return fmt.Errorf("no analytics record %q; list them with `haven analytics records`", inv.args[1])
}

func printAnalyticsRecords(v struct{ Records []analyticsRecord }) {
	if len(v.Records) == 0 {
		fmt.Println("no records")
	}
	for _, r := range v.Records {
		fmt.Printf("%-12s %-10s %-32s %-28s %s\n", r.Provider, r.Kind, r.Name, r.DistinctID, r.ReceivedAt.Format(time.RFC3339))
	}
}

// analyticsWait polls until a record matches the filter; no match in --timeout is an error.
func analyticsWait(ctx context.Context, api sources.SimAPI, inv invocation, asJSON bool) error {
	if !inv.has("--event") && !inv.has("--name") && !inv.has("--kind") && !inv.has("--provider") && !inv.has("--id") {
		return errors.New("usage: haven analytics wait --event <name> [--provider] [--kind] [--id] [--timeout 30s]")
	}
	timeout := mailWaitDefaultTimeout
	if raw := inv.value("--timeout"); raw != "" {
		parsed, err := time.ParseDuration(raw)
		if err != nil {
			return fmt.Errorf("--timeout %q is not a valid duration, e.g. 30s: %w", raw, err)
		}
		timeout = parsed
	}
	deadline := time.Now().Add(timeout)
	for {
		var found struct {
			Records []analyticsRecord `json:"records"`
		}
		if err := api.Get("/_sim/api/records", analyticsFilter(inv), &found); err != nil {
			return err
		}
		if len(found.Records) > 0 {
			if asJSON {
				return printMailJSON(found.Records[0])
			}
			printAnalyticsRecords(struct{ Records []analyticsRecord }{found.Records[:1]})
			return nil
		}
		if time.Now().After(deadline) {
			return fmt.Errorf("no record matched within %s", timeout)
		}
		select {
		case <-ctx.Done():
			return ctx.Err()
		case <-time.After(analyticsPollEvery):
		}
	}
}
