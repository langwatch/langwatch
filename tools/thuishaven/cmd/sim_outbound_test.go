package cmd

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/langwatch/langwatch/tools/thuishaven/cmd/viewer/sources"
)

func outboundCall(api sources.SimAPI, inv invocation) outboundCLI {
	return outboundCLI{api: api, inv: inv, asJSON: true}
}

// @scenario "The agent CLI reads and waits on records"
func TestOutboundRecordsMapsFlagsOntoTheSimsFilter(t *testing.T) {
	api, seen := stubSim(t, map[string]string{"GET /_sim/api/records": `{"records":[]}`})
	inv := simInv("records")
	inv.flags["--channel"], inv.flags["--event-id"] = "webhook", "evt_1"
	if err := outboundCommand(context.Background(), outboundCall(api, inv)); err != nil {
		t.Fatal(err)
	}
	if got := (*seen)[0]; !strings.Contains(got, "channel=webhook") || !strings.Contains(got, "eventId=evt_1") {
		t.Fatalf("request = %s", got)
	}
}

// @scenario "The agent CLI reads and waits on records"
func TestOutboundWaitNeedsAChannelAndTimesOutWithAnError(t *testing.T) {
	api, _ := stubSim(t, map[string]string{"GET /_sim/api/records": `{"records":[]}`})
	if err := outboundCommand(context.Background(), outboundCall(api, simInv("wait"))); err == nil {
		t.Fatal("wait without --channel was accepted")
	}
	inv := simInv("wait")
	inv.flags["--channel"], inv.flags["--timeout"] = "slack-webhook", "10ms"
	if err := outboundCommand(context.Background(), outboundCall(api, inv)); err == nil {
		t.Fatal("wait succeeded with no matching record")
	}
}

// @scenario "The agent CLI sets and clears faults"
func TestOutboundFaultAddPostsTheFaultAndClearDeletesIt(t *testing.T) {
	var posted outboundFault
	var deleted string
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.Method {
		case http.MethodPost:
			_ = json.NewDecoder(r.Body).Decode(&posted)
		case http.MethodDelete:
			deleted = r.URL.Path
		}
		_, _ = w.Write([]byte(`{"id":"f1"}`))
	}))
	defer srv.Close()
	api := sources.NewSimAPIAt(srv.URL)
	inv := simInv("fault", "add")
	inv.flags["--channel"], inv.flags["--target"], inv.flags["--status"], inv.flags["--times"] = "webhook", "ok", "503", "1"
	if err := outboundCommand(context.Background(), outboundCall(api, inv)); err != nil {
		t.Fatal(err)
	}
	if posted.Channel != "webhook" || posted.Target != "ok" || posted.Status != 503 || posted.Times != 1 {
		t.Fatalf("posted fault = %+v", posted)
	}
	if err := outboundCommand(context.Background(), outboundCall(api, simInv("fault", "clear"))); err != nil {
		t.Fatal(err)
	}
	if deleted != "/_sim/api/faults" {
		t.Fatalf("clear deleted %q, want every fault", deleted)
	}
}

func TestOutboundFaultAddRefusesAMissingChannelOrANonNumericStatus(t *testing.T) {
	api, _ := stubSim(t, nil)
	if err := outboundCommand(context.Background(), outboundCall(api, simInv("fault", "add"))); err == nil {
		t.Fatal("fault add without --channel was accepted")
	}
	inv := simInv("fault", "add")
	inv.flags["--channel"], inv.flags["--status"] = "webhook", "x"
	if err := outboundCommand(context.Background(), outboundCall(api, inv)); err == nil {
		t.Fatal("a non-numeric --status was accepted")
	}
}

func TestOutboundReceiverSetPutsTheSecret(t *testing.T) {
	api, seen := stubSim(t, map[string]string{"PUT /_sim/api/receivers/ok": `{}`})
	inv := simInv("receiver", "set", "ok")
	inv.flags["--secret"] = "s3"
	if err := outboundCommand(context.Background(), outboundCall(api, inv)); err != nil {
		t.Fatal(err)
	}
	if len(*seen) != 1 {
		t.Fatalf("requests = %v", *seen)
	}
	if err := outboundCommand(context.Background(), outboundCall(api, simInv("receiver", "set", "ok"))); err == nil {
		t.Fatal("receiver set without --secret was accepted")
	}
}
