package visualdiff

import (
	"context"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestAScimSetupStepSendsTheSeededTokenAsABearerAndFillsItAsAFixture(t *testing.T) {
	var got []http.Header
	var bodies []string
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		raw, _ := io.ReadAll(r.Body)
		got, bodies = append(got, r.Header.Clone()), append(bodies, string(raw))
		_, _ = w.Write([]byte(`{"id":"u1"}`))
	}))
	t.Cleanup(server.Close)
	flows := []Flow{{ID: "push", Setup: []SetupStep{
		{Post: "/api/scim/v2/Users", Auth: SetupAuthScim, Body: map[string]any{"userName": "vd-{uid}", "token": "{scimToken}"}, As: map[string]string{"userId": "id"}},
	}}}

	captured, warnings := runFlowSetups(context.Background(), setupRequest{
		client: server.Client(), apiURL: server.URL, key: "sk-project", flows: flows, scimToken: "scim-secret",
	})

	if len(warnings) != 0 || captured["push/userId"] != "u1" {
		t.Fatalf("captured %v, warnings %v", captured, warnings)
	}
	if got[0].Get("Authorization") != "Bearer scim-secret" || got[0].Get("X-Auth-Token") != "" {
		t.Errorf("headers %v", got[0])
	}
	if !strings.Contains(bodies[0], `"token":"scim-secret"`) {
		t.Errorf("body %s", bodies[0])
	}
	if _, kept := captured["push/scimToken"]; kept {
		t.Error("the token must never be captured into the run's fixtures")
	}
}

func TestAScimSetupStepWithoutASeededTokenOrWithAnUnknownAuthWarnsAndPostsNothing(t *testing.T) {
	posted := false
	server := httptest.NewServer(http.HandlerFunc(func(http.ResponseWriter, *http.Request) { posted = true }))
	t.Cleanup(server.Close)

	for _, step := range []SetupStep{{Post: "/x", Auth: SetupAuthScim}, {Post: "/x", Auth: "other"}} {
		_, warnings := runFlowSetups(context.Background(), setupRequest{
			client: server.Client(), apiURL: server.URL, flows: []Flow{{ID: "push", Setup: []SetupStep{step}}},
		})
		if len(warnings) != 1 {
			t.Errorf("auth %q: warnings %v", step.Auth, warnings)
		}
	}
	if posted {
		t.Error("a refused step must not post")
	}
}

func TestTheSeededScimTokenIsReadFromHavensOverlayEvenAfterLogLines(t *testing.T) {
	output := []byte("haven: resolving\n{\"A\":\"b\",\"HAVEN_SEED_SCIM_TOKEN\":\"tok\"}\n")
	if got := scimTokenIn(output); got != "tok" {
		t.Errorf("got %q", got)
	}
	if got := scimTokenIn([]byte("no json")); got != "" {
		t.Errorf("got %q", got)
	}
}
