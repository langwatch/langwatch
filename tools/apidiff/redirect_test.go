package apidiff

import (
	"net/http"
	"net/http/httptest"
	"testing"
	"time"
)

func TestScenarioClientReturnsRedirectUnfollowed(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/target" {
			w.WriteHeader(http.StatusNotAcceptable)
			return
		}
		http.Redirect(w, r, "/target", http.StatusFound)
	}))
	defer server.Close()

	response, err := newScenarioClient(scenarioOptions{Timeout: time.Second}).Get(server.URL + "/start")
	if err != nil {
		t.Fatal(err)
	}
	defer response.Body.Close()
	if response.StatusCode != http.StatusFound {
		t.Fatalf("status = %d, want 302", response.StatusCode)
	}
}
