package httpapi

import (
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

// given various candidate staged-payload URLs
// when validateStagedPayloadURL inspects them
// then only https URLs whose host is an AWS S3 host are accepted, closing the
// SSRF surface while allowing both path-style and virtual-hosted S3 URLs
// (presigned signature in the query string is intentionally not restricted).
func TestValidateStagedPayloadURL(t *testing.T) {
	valid := []string{
		"https://s3.amazonaws.com/bucket/key?X-Amz-Signature=abc",
		"https://s3.us-east-1.amazonaws.com/bucket/key?X-Amz-Signature=abc",
		"https://s3-us-west-2.amazonaws.com/bucket/key?X-Amz-Signature=abc",
		"https://my-bucket.s3.amazonaws.com/key?X-Amz-Signature=abc",
		"https://my-bucket.s3.eu-central-1.amazonaws.com/langevals-staging/p/x.json?X-Amz-Algorithm=AWS4-HMAC-SHA256&X-Amz-Signature=def",
		"https://my-bucket.s3-eu-central-1.amazonaws.com/key?X-Amz-Signature=def",
	}
	for _, u := range valid {
		if err := validateStagedPayloadURL(u); err != nil {
			t.Errorf("expected %q valid, got %v", u, err)
		}
	}

	invalid := []string{
		"",                                      // empty
		"http://my-bucket.s3.amazonaws.com/key", // not https
		"https://169.254.169.254/latest/meta-data",           // instance metadata
		"https://127.0.0.1:8080/key",                         // loopback
		"https://internal-service.local/key",                 // internal host
		"https://evil.com/key",                               // arbitrary external
		"https://lambda.us-east-1.amazonaws.com/2015-03-31/", // non-S3 AWS service
		"https://s3.amazonaws.com.evil.com/key",              // suffix spoof
		"https://evil-s3.com/key",                            // s3 in name but not amazonaws
		"not a url at all ::::",                              // unparseable
	}
	for _, u := range invalid {
		if err := validateStagedPayloadURL(u); err == nil {
			t.Errorf("expected %q rejected, got nil error", u)
		}
	}
}

// given a presigned URL that serves a body
// when fetchStagedPayload GETs it
// then it returns the full body. (Host validation is the caller's job, so an
// httptest host is fine here — this exercises the transport only.)
func TestFetchStagedPayload_ReturnsBody(t *testing.T) {
	const want = `{"trace_id":"t1","workflow":{"big":"payload"}}`
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte(want))
	}))
	defer srv.Close()

	body, err := fetchStagedPayload(context.Background(), srv.Client(), srv.URL)
	if err != nil {
		t.Fatalf("fetchStagedPayload error: %v", err)
	}
	if string(body) != want {
		t.Fatalf("body mismatch: got %q want %q", body, want)
	}
}

// given an upstream that returns a non-2xx status
// when fetchStagedPayload GETs it
// then it surfaces an error rather than treating the error page as the body.
func TestFetchStagedPayload_Non2xxIsError(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusForbidden)
		_, _ = w.Write([]byte("AccessDenied"))
	}))
	defer srv.Close()

	if _, err := fetchStagedPayload(context.Background(), srv.Client(), srv.URL); err == nil {
		t.Fatal("expected error on non-2xx, got nil")
	}
}

// given a request carrying the staged-payload header with an untrusted URL
// when readStudioRequestBody runs
// then it rejects the request (SSRF guard) instead of fetching it.
func TestReadStudioRequestBody_RejectsUntrustedStagedURL(t *testing.T) {
	req := httptest.NewRequest(http.MethodPost, "/go/studio/execute", strings.NewReader(""))
	req.Header.Set(StagedPayloadHeader, "https://169.254.169.254/latest/meta-data")

	if _, err := readStudioRequestBody(req, http.DefaultClient); err == nil {
		t.Fatal("expected SSRF rejection for untrusted staged url, got nil error")
	}
}

// given a request with NO staged-payload header
// when readStudioRequestBody runs
// then it reads the inline body verbatim (the common, non-offloaded path).
func TestReadStudioRequestBody_InlineBodyWhenNoHeader(t *testing.T) {
	const want = `{"type":"is_alive"}`
	req := httptest.NewRequest(http.MethodPost, "/go/studio/execute", strings.NewReader(want))

	body, err := readStudioRequestBody(req, http.DefaultClient)
	if err != nil {
		t.Fatalf("readStudioRequestBody error: %v", err)
	}
	if string(body) != want {
		t.Fatalf("inline body mismatch: got %q want %q", body, want)
	}
}
