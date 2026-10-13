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

func simInv(args ...string) invocation { return invocation{flags: map[string]string{}, args: args} }

func stubSim(t *testing.T, routes map[string]string) (sources.SimAPI, *[]string) {
	t.Helper()
	var seen []string
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		key := r.Method + " " + r.URL.Path
		seen = append(seen, key+"?"+r.URL.RawQuery)
		body, ok := routes[key]
		if !ok {
			http.Error(w, `{"error":"no such route"}`, http.StatusNotFound)
			return
		}
		_, _ = w.Write([]byte(body))
	}))
	t.Cleanup(srv.Close)
	return sources.NewSimAPIAt(srv.URL), &seen
}

func TestLLMSetKeepsTheSettingsItWasNotAskedToChange(t *testing.T) {
	var put llmSettings
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method == http.MethodPut {
			_ = json.NewDecoder(r.Body).Decode(&put)
		}
		_, _ = w.Write([]byte(`{"forcedError":0,"seed":"keep"}`))
	}))
	defer srv.Close()
	inv := simInv("set")
	inv.flags["--error"] = "429"
	if err := llmCommand(sources.NewSimAPIAt(srv.URL), inv, true); err != nil {
		t.Fatal(err)
	}
	if put.ForcedError != 429 || put.Seed != "keep" {
		t.Fatalf("PUT body = %+v, want forcedError 429 and the seed kept", put)
	}
	inv.flags["--error"] = "x"
	if err := llmCommand(sources.NewSimAPIAt(srv.URL), inv, true); err == nil {
		t.Fatal("a non-numeric --error was accepted")
	}
}

func TestLLMCallRefusesAnUnknownIDWithTheSimsBody(t *testing.T) {
	api, _ := stubSim(t, nil)
	err := llmCommand(api, simInv("call", "nope"), true)
	if err == nil || !strings.Contains(err.Error(), "no such route") {
		t.Fatalf("error = %v, want the sim's own refusal", err)
	}
}

func TestAnalyticsRecordsMapsEventToTheSimsNameFilter(t *testing.T) {
	api, seen := stubSim(t, map[string]string{"GET /_sim/api/records": `{"records":[]}`})
	inv := simInv("records")
	inv.flags["--event"], inv.flags["--provider"] = "signup", "posthog"
	if err := analyticsCommand(context.Background(), api, inv, true); err != nil {
		t.Fatal(err)
	}
	if got := (*seen)[0]; !strings.Contains(got, "name=signup") || !strings.Contains(got, "provider=posthog") {
		t.Fatalf("request = %s", got)
	}
}

func TestAnalyticsWaitTimesOutWithAnError(t *testing.T) {
	api, _ := stubSim(t, map[string]string{"GET /_sim/api/records": `{"records":[]}`})
	inv := simInv("wait")
	inv.flags["--event"], inv.flags["--timeout"] = "never", "10ms"
	if err := analyticsCommand(context.Background(), api, inv, true); err == nil {
		t.Fatal("wait succeeded with no matching record")
	}
}

func TestStorageObjectNeedsBucketAndKey(t *testing.T) {
	api, seen := stubSim(t, map[string]string{"GET /_sim/api/object": `{"bucket":"b","key":"k/1","size":3,"headers":{}}`})
	if err := storageCommand(api, simInv("object", "b"), true); err == nil {
		t.Fatal("object without a key was accepted")
	}
	if err := storageCommand(api, simInv("object", "b", "k/1"), true); err != nil {
		t.Fatal(err)
	}
	if !strings.Contains((*seen)[0], "bucket=b&key=k%2F1") {
		t.Fatalf("request = %s", (*seen)[0])
	}
}

func TestVoiceCallRefusesAnUnknownID(t *testing.T) {
	api, _ := stubSim(t, map[string]string{"GET /_sim/api/calls": `{"calls":[{"id":"c1","turns":[]}]}`})
	if err := voiceCommand(api, simInv("call", "c1"), true); err != nil {
		t.Fatal(err)
	}
	if err := voiceCommand(api, simInv("call", "zz"), true); err == nil {
		t.Fatal("an unknown call id was accepted")
	}
}

func TestMailDeleteAndLinks(t *testing.T) {
	var deleted string
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch {
		case r.Method == http.MethodDelete && r.URL.Path == "/api/messages/m1":
			deleted = r.URL.Path
			w.WriteHeader(http.StatusNoContent)
		case r.Method == http.MethodGet && r.URL.Path == "/api/messages/m1":
			_, _ = w.Write([]byte(`{"id":"m1","links":["https://x.test/verify"]}`))
		default:
			w.WriteHeader(http.StatusNotFound)
		}
	}))
	defer srv.Close()
	sink := mailSink{baseURL: srv.URL, asJSON: true}
	if err := runMailSubcommand(context.Background(), simInv("links", "m1"), sink); err != nil {
		t.Fatal(err)
	}
	if err := runMailSubcommand(context.Background(), simInv("delete", "m1"), sink); err != nil || deleted == "" {
		t.Fatalf("delete = %v, deleted %q", err, deleted)
	}
	if err := runMailSubcommand(context.Background(), simInv("delete", "gone"), sink); err == nil || !strings.Contains(err.Error(), "not in this stack's inbox") {
		t.Fatalf("delete of a missing id = %v", err)
	}
}
