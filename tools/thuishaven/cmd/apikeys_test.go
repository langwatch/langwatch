package cmd

import (
	"bytes"
	"context"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"sync/atomic"
	"testing"
)

const (
	testPersonalToken = "sk-lw-test-personal-token-abcdef"
	testOrgToken      = "sk-lw-test-minted-org-token-xyz"
	testVirtualKey    = "vk-lw-test-minted-virtual-key-123"
)

// fakeStack answers the routes haven mints through, echoing every credential
// it is sent so a test can prove none reaches the output.
func fakeStack(t *testing.T, mints *atomic.Int32, mintStatus int) *httptest.Server {
	t.Helper()
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		auth := r.Header.Get("X-Auth-Token") + r.Header.Get("Authorization")
		w.Header().Set("Content-Type", "application/json")
		switch r.URL.Path {
		case "/api/api-keys":
			mints.Add(1)
			w.WriteHeader(mintStatus)
			_, _ = w.Write([]byte(`{"token":"` + testOrgToken + `","apiKey":{"id":"key_1"},"echo":"` + auth + `"}`))
		case "/api/gateway/v1/virtual-keys":
			mints.Add(1)
			w.WriteHeader(mintStatus)
			_, _ = w.Write([]byte(`{"secret":"` + testVirtualKey + `","virtual_key":{"id":"vk_1"}}`))
		default:
			_, _ = w.Write([]byte(`{"echo":"` + auth + `"}`))
		}
	}))
	t.Cleanup(srv.Close)
	return srv
}

func testKeyring(t *testing.T, api string) keyring {
	return keyring{api: api, seeded: testAPIKey, personal: testPersonalToken, file: filepath.Join(t.TempDir(), "keys", "stack.json")}
}

func TestKeyringRefusesAnUnknownKeyKind(t *testing.T) {
	ring := testKeyring(t, "http://127.0.0.1:1")
	_, err := ring.resolve(context.Background(), "admin", "")
	if err == nil || !strings.Contains(err.Error(), `unknown key kind "admin"`) {
		t.Fatalf("err = %v, want an unknown key kind refusal", err)
	}
}

func TestOrgKeyIsMintedOnceThenReusedFromAnOwnerOnlyFile(t *testing.T) {
	var mints atomic.Int32
	ring := testKeyring(t, fakeStack(t, &mints, http.StatusCreated).URL)
	for range 2 {
		key, err := ring.resolve(context.Background(), "org", "")
		if err != nil {
			t.Fatal(err)
		}
		if key.secret != testOrgToken {
			t.Fatal("resolved a key other than the one minted")
		}
	}
	if got := mints.Load(); got != 1 {
		t.Fatalf("minted %d times, want once", got)
	}
	info, err := os.Stat(ring.file)
	if err != nil {
		t.Fatal(err)
	}
	if info.Mode().Perm() != 0o600 {
		t.Fatalf("key file mode = %v, want 0600", info.Mode().Perm())
	}
}

func TestNoKeyReachesTheOutputEvenOnError(t *testing.T) {
	var mints atomic.Int32
	failing := testKeyring(t, fakeStack(t, &mints, http.StatusInternalServerError).URL)
	_, err := failing.resolve(context.Background(), "org", "")
	if err == nil {
		t.Fatal("a failed mint was accepted")
	}
	if strings.Contains(err.Error(), testPersonalToken) || strings.Contains(err.Error(), testOrgToken) {
		t.Fatalf("the mint error leaks a key: %v", err)
	}

	ring := testKeyring(t, fakeStack(t, &mints, http.StatusCreated).URL)
	res, err := ring.call(context.Background(), "org", "", func(key resolvedKey) apiCall {
		return apiCall{base: ring.api, key: key.secret, method: "GET", path: "/api/echo"}
	})
	if err != nil {
		t.Fatal(err)
	}
	for _, asJSON := range []bool{true, false} {
		var out bytes.Buffer
		if err := printAPIResult(&out, res, asJSON); err != nil {
			t.Fatal(err)
		}
		for _, secret := range []string{testOrgToken, testPersonalToken, testAPIKey} {
			if strings.Contains(out.String(), secret) {
				t.Errorf("json=%v: output leaks a key:\n%s", asJSON, out.String())
			}
		}
	}
	var who bytes.Buffer
	key, _ := ring.resolve(context.Background(), "org", "")
	if err := printWhoami(&who, key, true); err != nil || strings.Contains(who.String(), testOrgToken) {
		t.Fatalf("whoami leaks the key or failed (%v):\n%s", err, who.String())
	}
}

func TestGatewayReusesItsVirtualKey(t *testing.T) {
	var mints atomic.Int32
	srv := fakeStack(t, &mints, http.StatusCreated)
	ring := testKeyring(t, srv.URL)
	for range 2 {
		res, err := ring.callGateway(context.Background(), "walk", apiCall{base: srv.URL, method: "POST", path: "/v1/chat/completions", bearer: true})
		if err != nil {
			t.Fatal(err)
		}
		if strings.Contains(string(res.Body), testVirtualKey) || !strings.Contains(string(res.Body), redacted) {
			t.Fatalf("the virtual key was not sent, or was printed: %s", res.Body)
		}
	}
	if got := mints.Load(); got != 1 {
		t.Fatalf("minted %d virtual keys, want one reused", got)
	}
}
