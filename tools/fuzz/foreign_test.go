package fuzz

import (
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/langwatch/langwatch/tools/diffkit"
)

// A generic {id} is filled with an id the other tenant really lists, found with
// that tenant's own key, never the synthetic "fuzzer" the fuzzer's own reads use.
func TestForeignIDAddressesARealResourceOfTheOtherTenant(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		if request.URL.Path == "/api/prompts" && request.Header.Get("X-Auth-Token") == diffkit.SeededProjectKey {
			_, _ = writer.Write([]byte(`{"prompts":[{"id":"prompt_seeded"}],"total":1}`))
			return
		}
		writer.WriteHeader(http.StatusNotFound)
	}))
	defer server.Close()
	run := &apiRun{client: server.Client(), apiURL: server.URL}
	foreign := Mutation{Name: "foreign-id", Foreign: true}
	op := diffkit.Operation{Method: "GET", Path: "/api/prompts/{id}", Params: []diffkit.Param{{Name: "id", In: "path", Required: true}}}

	request, ok := run.build(context.Background(), job{op: op, auth: "org", mutation: foreign})
	if !ok || !strings.HasSuffix(request.url, "/api/prompts/prompt_seeded") {
		t.Fatalf("want the other tenant's prompt addressed, got ok=%v url=%q", ok, request.url)
	}

	unlisted := diffkit.Operation{Method: "GET", Path: "/api/sessions/{sessionId}", Params: []diffkit.Param{{Name: "sessionId", In: "path", Required: true}}}
	if _, ok := run.build(context.Background(), job{op: unlisted, auth: "org", mutation: foreign}); ok {
		t.Fatal("a foreign-id job with no real foreign resource must not be sent")
	}
}

// Only a 2xx naming the addressed foreign id is a leak; an empty list is not.
func TestCrossTenantOracleIgnoresEmptyListsAndOwnReads(t *testing.T) {
	foreign := Mutation{Name: "foreign-id", Foreign: true}
	judge := func(body string) bool {
		hits := Evaluate(Observation{Mutation: foreign, Status: 200, Body: []byte(body), SeparateOrg: true, ForeignIDs: []string{"local-dev-project", "prompt_seeded"}})
		for _, hit := range hits {
			if hit.Oracle == "cross-tenant" {
				return true
			}
		}
		return false
	}
	for body, want := range map[string]bool{
		`{"events":[],"nextCursor":null}`: false,
		`[]`:                              false,
		`{"projectId":"local-dev-project","items":[]}`:         false,
		`{"id":"prompt_own","name":"fuzzer"}`:                  false,
		`{"id":"prompt_seeded","name":"theirs"}`:               true,
		`{"items":[{"projectId":"local-dev-project","id":1}]}`: true,
	} {
		if got := judge(body); got != want {
			t.Errorf("%s: cross-tenant=%v, want %v", body, got, want)
		}
	}
}
