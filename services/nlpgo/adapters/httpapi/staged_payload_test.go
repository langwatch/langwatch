package httpapi

import (
	"bytes"
	"context"
	"crypto/aes"
	"crypto/cipher"
	"encoding/base64"
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

	body, err := fetchStagedPayload(context.Background(), srv.Client(), srv.URL, 1<<20)
	if err != nil {
		t.Fatalf("fetchStagedPayload error: %v", err)
	}
	if string(body) != want {
		t.Fatalf("body mismatch: got %q want %q", body, want)
	}
}

// given an upstream body larger than the byte limit
// when fetchStagedPayload reads it
// then it errors instead of silently returning a truncated body
// (io.LimitReader truncates rather than erroring, so we read limit+1).
func TestFetchStagedPayload_OverLimitErrors(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte(strings.Repeat("x", 100)))
	}))
	defer srv.Close()

	if _, err := fetchStagedPayload(context.Background(), srv.Client(), srv.URL, 10); err == nil {
		t.Fatal("expected error when body exceeds the byte limit, got nil")
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

	if _, err := fetchStagedPayload(context.Background(), srv.Client(), srv.URL, 1<<20); err == nil {
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

// The test-only origin override. It exists so an integration test can drive
// the whole staging round trip against a fake object store on loopback; these
// cases pin that it admits exactly one origin and that a deployed environment
// ignores it entirely.
func TestStagedPayloadTestOnlyOrigin(t *testing.T) {
	const staged = "http://127.0.0.1:55615/bucket/nlpgo-staging/p1/body.json?sig=x"
	const awsStaged = "https://b.s3.eu-central-1.amazonaws.com/k?X-Amz-Signature=a"

	cases := []struct {
		name        string
		environment string
		origin      string
		url         string
		wantValid   bool
	}{
		{"admits the one origin it names", "test", "http://127.0.0.1:55615", staged, true},
		{"refuses another port on the same host", "test", "http://127.0.0.1:55615", "http://127.0.0.1:9999/k", false},
		{"refuses the metadata endpoint", "test", "http://127.0.0.1:55615", "http://169.254.169.254/latest/meta-data", false},
		{"ignores the variable in production", "production", "http://127.0.0.1:55615", staged, false},
		{"leaves the S3 rule alone when unset", "test", "", staged, false},
		{"still admits a real S3 host", "test", "http://127.0.0.1:55615", awsStaged, true},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			t.Setenv("ENVIRONMENT", tc.environment)
			t.Setenv(StagedPayloadTestOnlyOriginEnv, tc.origin)

			err := validateStagedPayloadURL(tc.url)
			if tc.wantValid && err != nil {
				t.Errorf("expected %q valid, got %v", tc.url, err)
			}
			if !tc.wantValid && err == nil {
				t.Errorf("expected %q rejected, got nil error", tc.url)
			}
		})
	}
}

// sealForTest mirrors the control plane's layout: nonce, then ciphertext and tag.
func sealForTest(t *testing.T, key, nonce, plain []byte) []byte {
	t.Helper()
	block, err := aes.NewCipher(key)
	if err != nil {
		t.Fatal(err)
	}
	gcm, err := cipher.NewGCM(block)
	if err != nil {
		t.Fatal(err)
	}
	return append(append([]byte{}, nonce...), gcm.Seal(nil, nonce, plain, nil)...)
}

// given a staged body sealed under a per-run key
// when the engine reads it with the key from the invoke header
// then the secret in the body round-trips, while the stored bytes never hold it.
func TestReadStudioRequestBody_OpensASealedStagedBody(t *testing.T) {
	const want = `{"workflow":{"secrets":{"PARTNER_TOKEN":"tok_live_123"}}}`
	key := bytes.Repeat([]byte{7}, 32)
	sealed := sealForTest(t, key, bytes.Repeat([]byte{1}, 12), []byte(want))
	if bytes.Contains(sealed, []byte("tok_live_123")) {
		t.Fatal("the sealed bytes still hold the secret")
	}
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		_, _ = w.Write(sealed)
	}))
	defer srv.Close()
	t.Setenv("ENVIRONMENT", "test")
	t.Setenv(StagedPayloadTestOnlyOriginEnv, srv.URL)

	r := httptest.NewRequest(http.MethodPost, "/go/studio/execute", nil)
	r.Header.Set(StagedPayloadHeader, srv.URL+"/object")
	r.Header.Set(StagedPayloadKeyHeader, base64.StdEncoding.EncodeToString(key))

	got, err := readStudioRequestBody(r, srv.Client())
	if err != nil {
		t.Fatalf("expected the body to open, got %v", err)
	}
	if string(got) != want {
		t.Errorf("got %q, want %q", got, want)
	}
}

// given a sealed body, a wrong key and a tampered object
// when the engine opens them
// then each is refused rather than executed.
func TestOpenStagedPayload_RefusesWrongKeyAndTampering(t *testing.T) {
	key := bytes.Repeat([]byte{7}, 32)
	sealed := sealForTest(t, key, bytes.Repeat([]byte{1}, 12), []byte(`{"a":1}`))

	other := base64.StdEncoding.EncodeToString(bytes.Repeat([]byte{9}, 32))
	if _, err := openStagedPayload(sealed, other); err == nil {
		t.Error("a wrong key must not open the body")
	}
	tampered := append([]byte{}, sealed...)
	tampered[len(tampered)-1] ^= 0xff
	if _, err := openStagedPayload(tampered, base64.StdEncoding.EncodeToString(key)); err == nil {
		t.Error("a tampered body must not open")
	}
	if _, err := openStagedPayload(sealed, "not-a-key"); err == nil {
		t.Error("a malformed key must be refused")
	}
}
