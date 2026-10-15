package mcpsim

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestApprovedProjectIDLooksTheSlugUp(t *testing.T) {
	var auth string
	api := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		auth = r.Header.Get("Authorization")
		_ = json.NewEncoder(w).Encode(map[string]any{"data": []map[string]string{
			{"id": "project_other", "slug": "other"},
			{"id": "project_2Kq9", "slug": "local-dev-project"},
		}})
	}))
	t.Cleanup(api.Close)
	s := NewServer(Config{Endpoint: api.URL, ProjectSlug: "local-dev-project", AccessToken: "sk-lw-personal"})

	id, err := s.approvedProjectID(context.Background(), ConnectRequest{})
	if err != nil || id != "project_2Kq9" {
		t.Fatalf("approvedProjectID = %q, %v; want project_2Kq9", id, err)
	}
	if auth != "Bearer sk-lw-personal" {
		t.Errorf("lookup sent Authorization %q", auth)
	}
	if id, _ := s.approvedProjectID(context.Background(), ConnectRequest{ProjectID: "asked"}); id != "asked" {
		t.Errorf("a request naming its project got %q", id)
	}
}

func TestApprovedProjectIDRefusesAnUnknownSlug(t *testing.T) {
	api := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		_ = json.NewEncoder(w).Encode(map[string]any{"data": []map[string]string{}})
	}))
	t.Cleanup(api.Close)
	s := NewServer(Config{Endpoint: api.URL, ProjectSlug: "missing", AccessToken: "sk-lw-personal"})

	if _, err := s.approvedProjectID(context.Background(), ConnectRequest{}); err == nil {
		t.Fatal("an unknown slug resolved")
	}
}
