package cmd

import (
	"context"
	"strings"
	"testing"
)

const analyticsTwoRecords = `{"records":[
	{"id":"rec_000002","provider":"customerio","kind":"event","distinctId":"u1","name":"scenario_created","properties":{"scenario_id":"s1"},"receivedAt":"2026-09-30T10:00:02Z","raw":{"event":"scenario_created"}},
	{"id":"rec_000001","provider":"posthog","kind":"identify","distinctId":"u1","properties":{},"receivedAt":"2026-09-30T10:00:01Z","raw":null}
]}`

// @scenario "haven analytics shows one record in full"
func TestAnalyticsRecordShowsOneAndRefusesAnUnknownID(t *testing.T) {
	api, _ := stubSim(t, map[string]string{"GET /_sim/api/records": analyticsTwoRecords})
	for _, asJSON := range []bool{true, false} {
		if err := analyticsCommand(context.Background(), api, simInv("record", "rec_000002"), asJSON); err != nil {
			t.Fatalf("asJSON=%v: %v", asJSON, err)
		}
	}
	if err := analyticsCommand(context.Background(), api, simInv("record", "rec_999999"), true); err == nil {
		t.Fatal("an unknown record id was accepted")
	}
	if err := analyticsCommand(context.Background(), api, simInv("record"), true); err == nil {
		t.Fatal("record without an id was accepted")
	}
}

// @scenario "haven analytics status reports the activity and records filter by name"
func TestAnalyticsStatusReadsActivityAndNameFilters(t *testing.T) {
	api, seen := stubSim(t, map[string]string{
		"GET /_sim/api/status":  `{"stack":"s","records":2,"baseUrl":"http://a","activity":{"total":2,"lastFiveMinutes":1,"distinctIds":1,"lastReceivedAt":"2026-09-30T10:00:02Z","lastName":"scenario_created"}}`,
		"GET /_sim/api/records": analyticsTwoRecords,
	})
	if err := analyticsCommand(context.Background(), api, simInv("status"), false); err != nil {
		t.Fatal(err)
	}
	inv := simInv("records")
	inv.flags["--name"] = "scenario_created"
	if err := analyticsCommand(context.Background(), api, inv, true); err != nil {
		t.Fatal(err)
	}
	if got := (*seen)[1]; !strings.Contains(got, "name=scenario_created") {
		t.Fatalf("request = %s", got)
	}
}
