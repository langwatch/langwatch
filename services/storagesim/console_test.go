package storagesim

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"testing/fstest"
)

func put(t *testing.T, base, target, body, contentType string) {
	t.Helper()
	resp, _ := doSigned(t, http.MethodPut, base+target, strings.NewReader(body), map[string]string{"Content-Type": contentType})
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("PUT %s = %d", target, resp.StatusCode)
	}
}

func getJSON(t *testing.T, url string, into any) int {
	t.Helper()
	resp, body := do(t, http.MethodGet, url, nil, nil)
	if err := json.Unmarshal([]byte(body), into); err != nil {
		t.Fatalf("%s answered %q: %v", url, body, err)
	}
	return resp.StatusCode
}

// @scenario "The console lists buckets and objects"
func TestConsoleListsBucketsAndObjects(t *testing.T) {
	srv := newTestServer(t)
	put(t, srv.URL, "/uploads/a/one.txt", "hello", "text/plain")
	put(t, srv.URL, "/uploads/two.png", "png!", "image/png")
	put(t, srv.URL, "/other/x", "z", "")

	var buckets struct{ Buckets []bucketInfo }
	getJSON(t, srv.URL+"/_sim/api/buckets", &buckets)
	if len(buckets.Buckets) != 2 || buckets.Buckets[0] != (bucketInfo{Name: "other", Objects: 1, Size: 1}) ||
		buckets.Buckets[1] != (bucketInfo{Name: "uploads", Objects: 2, Size: 9}) {
		t.Fatalf("buckets = %+v", buckets.Buckets)
	}

	var objects struct{ Objects []objectInfo }
	getJSON(t, srv.URL+"/_sim/api/objects?bucket=uploads", &objects)
	if len(objects.Objects) != 2 || objects.Objects[0].Key != "a/one.txt" || objects.Objects[0].Size != 5 ||
		objects.Objects[0].ContentType != "text/plain" || objects.Objects[0].ETag != `"5d41402abc4b2a76b9719d911017c592"` ||
		objects.Objects[0].LastModified.IsZero() {
		t.Fatalf("objects = %+v", objects.Objects)
	}
}

// @scenario "The console lists nothing for an empty store"
func TestConsoleListsEmptyArraysWhenNothingIsStored(t *testing.T) {
	srv := newTestServer(t)
	_, body := do(t, http.MethodGet, srv.URL+"/_sim/api/objects?bucket=nope", nil, nil)
	if strings.TrimSpace(body) != `{"objects":[]}` {
		t.Fatalf("body = %q", body)
	}
	_, body = do(t, http.MethodGet, srv.URL+"/_sim/api/buckets", nil, nil)
	if strings.TrimSpace(body) != `{"buckets":[]}` {
		t.Fatalf("body = %q", body)
	}
}

// @scenario "The console shows one object and downloads its bytes"
func TestConsoleObjectDetailAndRawDownload(t *testing.T) {
	srv := newTestServer(t)
	put(t, srv.URL, "/uploads/a/one.txt", "hello", "text/plain")
	query := "?bucket=uploads&key=a%2Fone.txt"

	var detail objectDetail
	if code := getJSON(t, srv.URL+"/_sim/api/object"+query, &detail); code != http.StatusOK ||
		detail.Headers["Content-Length"] != "5" || detail.Headers["Content-Type"] != "text/plain" {
		t.Fatalf("detail = %d %+v", code, detail)
	}

	resp, body := do(t, http.MethodGet, srv.URL+"/_sim/api/object/raw"+query+"&download=1", nil, nil)
	if body != "hello" || resp.Header.Get("Content-Type") != "text/plain" ||
		!strings.Contains(resp.Header.Get("Content-Disposition"), `filename=one.txt`) {
		t.Fatalf("raw = %q %v", body, resp.Header)
	}

	var missing struct{ Error string }
	if code := getJSON(t, srv.URL+"/_sim/api/object?bucket=uploads&key=nope", &missing); code != http.StatusNotFound || missing.Error == "" {
		t.Fatalf("missing = %d %+v", code, missing)
	}
	if code := getJSON(t, srv.URL+"/_sim/api/object?bucket=uploads", &missing); code != http.StatusBadRequest {
		t.Fatalf("no key = %d", code)
	}
}

// @scenario "The console remembers recent requests, newest first, up to a bound"
func TestConsoleRecordsRecentRequestsWithinTheBound(t *testing.T) {
	srv := newTestServer(t)
	put(t, srv.URL, "/uploads/k", "v", "text/plain")
	doSigned(t, http.MethodGet, srv.URL+"/uploads/missing", nil, nil)
	do(t, http.MethodGet, srv.URL+"/healthz", nil, nil)

	var recent struct{ Requests []requestEntry }
	getJSON(t, srv.URL+"/_sim/api/requests", &recent)
	if len(recent.Requests) != 2 || recent.Requests[0].Status != http.StatusNotFound || recent.Requests[0].Key != "missing" ||
		recent.Requests[1].Method != http.MethodPut || recent.Requests[1].Bucket != "uploads" || recent.Requests[1].Status != http.StatusOK {
		t.Fatalf("requests = %+v", recent.Requests)
	}

	log := newRequestLog()
	for i := range requestLogSize + 10 {
		log.add(requestEntry{Key: string(rune('a' + i%26)), Status: i})
	}
	got := log.recent()
	if len(got) != requestLogSize || got[0].Status != requestLogSize+9 {
		t.Fatalf("ring holds %d, newest %d", len(got), got[0].Status)
	}
}

// @scenario "The console serves its bundle beside the S3 paths"
func TestConsoleServesTheBundleAndNamesTheBuildWhenMissing(t *testing.T) {
	for name, bundle := range map[string]fstest.MapFS{
		"built":   {"index.html": {Data: []byte(`<div id="root"></div>`)}},
		"unbuilt": {},
	} {
		s, err := NewServer(Config{DataDir: t.TempDir()})
		if err != nil {
			t.Fatal(err)
		}
		s.console = newConsole(bundle)
		live := httptest.NewServer(s.Handler())
		resp, body := do(t, http.MethodGet, live.URL+"/_sim/", nil, nil)
		live.Close()
		built := resp.StatusCode == http.StatusOK && strings.Contains(body, `id="root"`)
		unbuilt := resp.StatusCode == http.StatusServiceUnavailable && strings.Contains(body, consoleBuildCommand)
		if (name == "built" && !built) || (name == "unbuilt" && !unbuilt) {
			t.Fatalf("%s console = %d %q", name, resp.StatusCode, body)
		}
	}
}
