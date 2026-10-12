package diffkit

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

// fakeStack answers the org-per-tool ceremony: sign-up sets a session cookie,
// onboarding creates the org, apiKey.create mints the org key, and the REST
// project and api-key routes mint the rest.
func fakeStack(t *testing.T) *httptest.Server {
	t.Helper()
	trpc := func(w http.ResponseWriter, json string) { writeString(w, `{"result":{"data":{"json":`+json+`}}}`) }
	mux := http.NewServeMux()
	mux.HandleFunc("/api/auth/sign-in/email", func(w http.ResponseWriter, r *http.Request) {
		http.SetCookie(w, &http.Cookie{Name: "better-auth.session_token", Value: "session1", Path: "/"})
		writeString(w, `{}`)
	})
	mux.HandleFunc("/api/auth/session", func(w http.ResponseWriter, r *http.Request) {
		if _, err := r.Cookie("better-auth.session_token"); err != nil {
			w.WriteHeader(http.StatusUnauthorized)
			return
		}
		writeString(w, `{"user":{"id":"u1"}}`)
	})
	mux.HandleFunc("/api/trpc/organization.createAndAssign", func(w http.ResponseWriter, r *http.Request) {
		trpc(w, `{"organization":{"id":"org1","name":"fuzzer"},"team":{"id":"team1","slug":"t","name":"t"}}`)
	})
	mux.HandleFunc("/api/trpc/organization.getAll", func(w http.ResponseWriter, r *http.Request) {
		trpc(w, `[{"id":"org1","name":"fuzzer","teams":[{"id":"team1"}]}]`)
	})
	mux.HandleFunc("/api/trpc/apiKey.create", func(w http.ResponseWriter, r *http.Request) {
		trpc(w, `{"token":"orgkey1","apiKey":{"id":"k1","name":"n","createdAt":"2026-01-01T00:00:00Z"}}`)
	})
	mux.HandleFunc("/api/projects", func(w http.ResponseWriter, r *http.Request) {
		if r.Method == http.MethodGet {
			if r.Header.Get("Authorization") == "Bearer orgkey1" {
				writeString(w, `[]`)
				return
			}
			w.WriteHeader(http.StatusUnauthorized)
			return
		}
		writeString(w, `{"id":"proj1","serviceApiKey":"projkey1","teamId":"team1"}`)
	})
	mux.HandleFunc("/api/api-keys", func(w http.ResponseWriter, r *http.Request) {
		writeString(w, `{"token":"restricted1"}`)
	})
	server := httptest.NewServer(mux)
	t.Cleanup(server.Close)
	return server
}

func writeString(w http.ResponseWriter, body string) {
	w.Header().Set("Content-Type", "application/json")
	_, _ = w.Write([]byte(body))
}

func TestSeedToolOrgRunsTheCeremony(t *testing.T) {
	server := fakeStack(t)
	dir := t.TempDir()
	org, err := SeedToolOrg(context.Background(), SeedOptions{BaseURL: server.URL, Tool: "fuzzer", Projects: 1, Dir: dir})
	if err != nil {
		t.Fatal(err)
	}
	if org.OrgKey != "orgkey1" || org.OrgID != "org1" || org.TeamID != "team1" || !org.Separate {
		t.Fatalf("org not provisioned: %+v", org)
	}
	if len(org.Projects) != 1 || org.Projects[0].Key != "projkey1" || org.Projects[0].ID != "proj1" {
		t.Fatalf("project not seeded: %+v", org.Projects)
	}
	if org.Restricted != "restricted1" {
		t.Fatalf("restricted key not minted: %q", org.Restricted)
	}
}

func TestSeedToolOrgReusesTheRecord(t *testing.T) {
	server := fakeStack(t)
	dir := t.TempDir()
	if _, err := SeedToolOrg(context.Background(), SeedOptions{BaseURL: server.URL, Tool: "fuzzer", Projects: 1, Dir: dir}); err != nil {
		t.Fatal(err)
	}
	// A second call reuses the record: the org key still authenticates via GET /api/projects.
	again, err := SeedToolOrg(context.Background(), SeedOptions{BaseURL: server.URL, Tool: "fuzzer", Projects: 1, Dir: dir})
	if err != nil {
		t.Fatal(err)
	}
	if again.OrgKey != "orgkey1" {
		t.Fatalf("reuse lost the org key: %+v", again)
	}
}

func TestToolOrgRecordRoundTrips(t *testing.T) {
	org := ToolOrg{Name: "fuzzer", OrgKey: "k", Projects: []ToolProject{{Key: "p", ID: "i"}}, Separate: true}
	encoded, err := json.Marshal(org)
	if err != nil || !strings.Contains(string(encoded), `"separate":true`) {
		t.Fatalf("record shape wrong: %s (%v)", encoded, err)
	}
}
