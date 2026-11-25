package sources

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"testing"
)

func TestSimAPIRoundTripsJSONAndRefusesNon2xx(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch {
		case r.Method == http.MethodGet && r.URL.Path == "/things":
			_, _ = w.Write([]byte(`{"q":"` + r.URL.Query().Get("q") + `"}`))
		case r.Method == http.MethodPut:
			var in map[string]int
			_ = json.NewDecoder(r.Body).Decode(&in)
			_ = json.NewEncoder(w).Encode(in)
		case r.Method == http.MethodDelete:
			w.WriteHeader(http.StatusNoContent)
		default:
			http.Error(w, "nope", http.StatusTeapot)
		}
	}))
	defer srv.Close()
	api := NewSimAPIAt(srv.URL + "/")

	var got map[string]string
	if err := api.Get("/things", url.Values{"q": {"x"}}, &got); err != nil || got["q"] != "x" {
		t.Fatalf("Get = %v, %v", got, err)
	}
	var echoed map[string]int
	if err := api.Put("/things", map[string]int{"n": 3}, &echoed); err != nil || echoed["n"] != 3 {
		t.Fatalf("Put = %v, %v", echoed, err)
	}
	if err := api.Delete("/things"); err != nil {
		t.Fatalf("Delete = %v", err)
	}
	err := api.Post("/things", nil, nil)
	if err == nil || !strings.Contains(err.Error(), "418") || !strings.Contains(err.Error(), "nope") {
		t.Fatalf("Post error = %v, want the status and the sim's body", err)
	}
	raw, err := api.GetRaw("/things", nil)
	if err != nil || string(raw) != `{"q":""}` {
		t.Fatalf("GetRaw = %q, %v", raw, err)
	}
}
