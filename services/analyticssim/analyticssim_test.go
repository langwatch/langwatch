package analyticssim

import (
	"bytes"
	"compress/gzip"
	"encoding/base64"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"testing"
	"testing/fstest"
	"time"
)

func newTestServer(t *testing.T) (*Server, *httptest.Server, Client) {
	t.Helper()
	s := newServer(Config{Stack: "feat-x"}, fstest.MapFS{"index.html": {Data: []byte("<div id=root></div>")}})
	s.now = func() time.Time { return time.Date(2026, 9, 30, 10, 0, 0, 0, time.UTC) }
	srv := httptest.NewServer(s.Handler())
	t.Cleanup(srv.Close)
	return s, srv, Client{BaseURL: srv.URL}
}

func send(t *testing.T, method, target string, header http.Header, body []byte) *http.Response {
	t.Helper()
	req, err := http.NewRequestWithContext(t.Context(), method, target, bytes.NewReader(body))
	if err != nil {
		t.Fatal(err)
	}
	for key, values := range header {
		req.Header[key] = values
	}
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = resp.Body.Close() })
	return resp
}

func gzipped(t *testing.T, text string) []byte {
	t.Helper()
	var buf bytes.Buffer
	w := gzip.NewWriter(&buf)
	if _, err := w.Write([]byte(text)); err != nil {
		t.Fatal(err)
	}
	if err := w.Close(); err != nil {
		t.Fatal(err)
	}
	return buf.Bytes()
}

func records(t *testing.T, c Client, f Filter) []Record {
	t.Helper()
	list, err := c.Records(t.Context(), f)
	if err != nil {
		t.Fatal(err)
	}
	return list
}

// @scenario "PostHog calls from either client become records"
func TestNormalizePostHogKinds(t *testing.T) {
	body := `{"api_key":"phc","batch":[
		{"event":"scenario_created","distinct_id":"u1","properties":{"scenario_id":"s1"}},
		{"event":"$identify","distinct_id":"u1","properties":{"$set":{"email":"a@b.c"}}},
		{"event":"$create_alias","distinct_id":"u1","properties":{"alias":"anon"}},
		{"event":"$groupidentify","distinct_id":"u1","properties":{"$group_type":"organization","$group_key":"o1","$group_set":{"plan":"free"}}}
	]}`
	got, err := NormalizePostHog([]byte(body))
	if err != nil {
		t.Fatal(err)
	}
	want := []struct{ kind, id, name, key string }{
		{KindEvent, "u1", "scenario_created", "scenario_id"},
		{KindIdentify, "u1", "", "email"},
		{KindAlias, "u1", "", "alias"},
		{KindGroup, "u1", "organization", "plan"},
	}
	if len(got) != len(want) {
		t.Fatalf("got %d records, want %d", len(got), len(want))
	}
	for i, w := range want {
		r := got[i]
		if r.Provider != ProviderPostHog || r.Kind != w.kind || r.DistinctID != w.id || r.Name != w.name || !HasProperties(r, map[string]string{w.key: ""}) {
			t.Errorf("record %d = %+v, want %+v", i, r, w)
		}
	}
}

func TestNormalizePostHogBrowserShapes(t *testing.T) {
	// posthog-js: a bare array, distinct_id inside properties; and a single message.
	for _, body := range []string{
		`[{"event":"$pageview","properties":{"distinct_id":"anon-1","$current_url":"/x"}}]`,
		`{"event":"$pageview","properties":{"distinct_id":"anon-1","$current_url":"/x"}}`,
	} {
		got, err := NormalizePostHog([]byte(body))
		if err != nil {
			t.Fatal(err)
		}
		if len(got) != 1 || got[0].DistinctID != "anon-1" || got[0].Name != "$pageview" {
			t.Errorf("%s -> %+v", body, got)
		}
	}
}

// @scenario "Customer.io calls become records"
func TestNormalizeCustomerIOCDP(t *testing.T) {
	got, err := NormalizeCustomerIOCDP("batch", []byte(`{"batch":[
		{"type":"identify","userId":"u1","traits":{"scenario_count":2}},
		{"type":"track","userId":"u1","event":"scenario_created","properties":{"scenario_id":"s1"}},
		{"type":"group","userId":"u1","groupId":"o1","traits":{"plan":"free"}}
	]}`))
	if err != nil {
		t.Fatal(err)
	}
	if len(got) != 3 || got[0].Kind != KindIdentify || got[1].Name != "scenario_created" || got[2].Kind != KindGroup || got[2].Name != "o1" {
		t.Fatalf("got %+v", got)
	}
	single, err := NormalizeCustomerIOCDP("identify", []byte(`{"userId":"u2","traits":{"email":"a@b.c"}}`))
	if err != nil {
		t.Fatal(err)
	}
	if single[0].Provider != ProviderCustomerIO || single[0].Kind != KindIdentify || single[0].DistinctID != "u2" {
		t.Errorf("got %+v", single[0])
	}
}

func TestPostHogNodeGzipBatchIsListed(t *testing.T) {
	_, srv, c := newTestServer(t)
	body := gzipped(t, `{"api_key":"phc","batch":[{"event":"signed_up","distinct_id":"u1","properties":{"projectId":"p1"}}]}`)
	resp := send(t, http.MethodPost, srv.URL+"/batch/", http.Header{"Content-Encoding": {"gzip"}, "Content-Type": {"application/json"}}, body)
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("status %d", resp.StatusCode)
	}
	got := records(t, c, Filter{Provider: ProviderPostHog, Name: "signed_up"})
	if len(got) != 1 || !HasProperties(got[0], map[string]string{"projectId": "p1"}) || got[0].ReceivedAt.IsZero() {
		t.Fatalf("got %+v", got)
	}
}

func TestPostHogJSEncodingsAreListed(t *testing.T) {
	_, srv, c := newTestServer(t)
	event := `[{"event":"$pageview","properties":{"distinct_id":"anon-1"}}]`
	send(t, http.MethodPost, srv.URL+"/e/?compression=gzip-js", http.Header{"Content-Type": {"text/plain"}}, gzipped(t, event))
	form := url.Values{"data": {base64.StdEncoding.EncodeToString([]byte(event))}}.Encode()
	send(t, http.MethodPost, srv.URL+"/i/v0/e/?compression=base64", http.Header{"Content-Type": {"application/x-www-form-urlencoded"}}, []byte(form))
	if got := records(t, c, Filter{ID: "anon-1", Kind: KindEvent}); len(got) != 2 {
		t.Fatalf("got %d records, want 2", len(got))
	}
}

// @scenario "The records can be listed, filtered and cleared"
func TestCustomerIOCallsAreListedAndFiltered(t *testing.T) {
	_, srv, c := newTestServer(t)
	jsonHeader := http.Header{"Content-Type": {"application/json"}}
	send(t, http.MethodPost, srv.URL+"/v1/identify", jsonHeader, []byte(`{"userId":"u1","traits":{"scenario_count":1}}`))
	send(t, http.MethodPost, srv.URL+"/v1/track", jsonHeader, []byte(`{"userId":"u1","event":"scenario_created","properties":{"scenario_id":"s1"}}`))
	send(t, http.MethodPut, srv.URL+"/api/v1/customers/u2", jsonHeader, []byte(`{"email":"a@b.c"}`))
	send(t, http.MethodPost, srv.URL+"/api/v1/customers/u2/events", jsonHeader, []byte(`{"name":"invited","data":{"role":"admin"}}`))

	all := records(t, c, Filter{Provider: ProviderCustomerIO})
	if len(all) != 4 || all[0].Name != "invited" {
		t.Fatalf("want 4 records newest first, got %+v", all)
	}
	if got := records(t, c, Filter{Kind: KindIdentify}); len(got) != 2 {
		t.Errorf("identify filter: got %d, want 2", len(got))
	}
	if got := records(t, c, Filter{ID: "u1", Name: "scenario_created"}); len(got) != 1 || !HasProperties(got[0], map[string]string{"scenario_id": "s1"}) {
		t.Errorf("id+name filter: got %+v", got)
	}
	if got := records(t, c, Filter{Provider: ProviderPostHog}); len(got) != 0 {
		t.Errorf("provider filter: got %d, want 0", len(got))
	}
	if err := c.Clear(t.Context()); err != nil {
		t.Fatal(err)
	}
	if got := records(t, c, Filter{}); len(got) != 0 {
		t.Errorf("after clear: got %d, want 0", len(got))
	}
}

func TestUnfakedPathsAndBadBodies(t *testing.T) {
	_, srv, _ := newTestServer(t)
	if resp := send(t, http.MethodPost, srv.URL+"/v1/unknown", nil, []byte(`{}`)); resp.StatusCode != http.StatusNotFound {
		t.Errorf("unknown CDP call: status %d, want 404", resp.StatusCode)
	}
	if resp := send(t, http.MethodPost, srv.URL+"/batch/", nil, []byte(`not json`)); resp.StatusCode != http.StatusBadRequest {
		t.Errorf("bad body: status %d, want 400", resp.StatusCode)
	}
	resp := send(t, http.MethodPost, srv.URL+"/flags/?v=2", nil, []byte(`{}`))
	if resp.StatusCode != http.StatusOK {
		t.Errorf("flags: status %d", resp.StatusCode)
	}
	ext := send(t, http.MethodGet, srv.URL+"/static/exception-autocapture.js?v=1", nil, nil)
	if ext.StatusCode != http.StatusOK || ext.Header.Get("Content-Type") != "application/javascript" {
		t.Errorf("posthog-js extension: status %d, type %q", ext.StatusCode, ext.Header.Get("Content-Type"))
	}
}

func TestBrowserPreflightIsAllowed(t *testing.T) {
	_, srv, _ := newTestServer(t)
	resp := send(t, http.MethodOptions, srv.URL+"/e/", http.Header{
		"Origin": {"https://app.x.langwatch.localhost"}, "Access-Control-Request-Headers": {"content-type"},
	}, nil)
	if resp.StatusCode != http.StatusNoContent || !strings.Contains(resp.Header.Get("Access-Control-Allow-Origin"), "app.x") {
		t.Fatalf("preflight: %d %v", resp.StatusCode, resp.Header)
	}
}

func TestHasProperties(t *testing.T) {
	r := Record{Properties: map[string]any{"n": float64(2), "s": "x", "b": true}}
	if !HasProperties(r, map[string]string{"n": "2", "s": "x", "b": "true"}) {
		t.Error("exact values should match")
	}
	if !HasProperties(r, map[string]string{"s": ""}) {
		t.Error("an empty wanted value should ask only for the key")
	}
	if HasProperties(r, map[string]string{"s": "y"}) || HasProperties(r, map[string]string{"missing": ""}) {
		t.Error("a different value or a missing key should not match")
	}
}

func TestRingKeepsNewestAndCapsRawBodies(t *testing.T) {
	s := newStore(3, 10)
	for range 5 {
		s.add([]Record{{Provider: ProviderPostHog, Kind: KindEvent, Raw: []byte(`{"big":"0123456789"}`)}}, time.Time{})
	}
	got := s.list(Filter{})
	if len(got) != 3 || got[0].ID != "rec_000005" || got[2].ID != "rec_000003" {
		t.Fatalf("ring should hold the newest three, newest first: %+v", got)
	}
	if string(got[0].Raw) != `{"truncated":true,"bytes":20}` {
		t.Fatalf("an oversized raw body should be replaced by a marker, got %s", got[0].Raw)
	}
	s.clear()
	if s.count() != 0 {
		t.Fatal("clear should empty the ring")
	}
}

func TestSeedLoadsSampleRecordsFromBothProviders(t *testing.T) {
	s := newServer(Config{Seed: true}, fstest.MapFS{"index.html": {Data: []byte("x")}})
	providers := map[string]bool{}
	for _, r := range s.records.list(Filter{}) {
		providers[r.Provider] = true
	}
	if !providers[ProviderPostHog] || !providers[ProviderCustomerIO] {
		t.Fatalf("seed should load both providers, got %v", providers)
	}
}
