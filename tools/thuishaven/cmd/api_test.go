package cmd

import (
	"bytes"
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

const testAPIKey = "sk-lw-test-secret-key-0123456789"

func TestAPICallSendsTheKeyAndNeverPrintsIt(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("X-Auth-Token") != testAPIKey {
			w.WriteHeader(http.StatusUnauthorized)
			return
		}
		w.Header().Set("Set-Cookie", "session=abc")
		w.Header().Set("Authorization", "Bearer "+testAPIKey)
		w.Header().Set("X-Echo", testAPIKey)
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"apiKey":"` + testAPIKey + `","path":"` + r.URL.Path + `"}`))
	}))
	defer srv.Close()

	res, err := callAPI(context.Background(), apiCall{base: srv.URL, key: testAPIKey, method: "GET", path: "/api/prompts"})
	if err != nil {
		t.Fatal(err)
	}
	if res.Status != http.StatusOK {
		t.Fatalf("status = %d, want 200", res.Status)
	}
	for _, asJSON := range []bool{true, false} {
		var out bytes.Buffer
		if err := printAPIResult(&out, res, asJSON); err != nil {
			t.Fatal(err)
		}
		if strings.Contains(out.String(), testAPIKey) || strings.Contains(out.String(), "session=abc") {
			t.Errorf("json=%v: output leaks a secret:\n%s", asJSON, out.String())
		}
		if !strings.Contains(out.String(), "/api/prompts") {
			t.Errorf("json=%v: output lost the body:\n%s", asJSON, out.String())
		}
	}
}

func TestAPICallRefusesAPathThatLeavesTheStack(t *testing.T) {
	if _, err := callAPI(context.Background(), apiCall{base: "http://127.0.0.1:1", key: testAPIKey, method: "GET", path: "@evil.example/x"}); err == nil {
		t.Fatal("a path without a leading / was accepted")
	}
}
