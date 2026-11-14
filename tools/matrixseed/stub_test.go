package matrixseed

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
)

const (
	instanceKey = "instance-admin-key-for-tests-only-0000"
	adminKey    = "sk-lw-org-admin"
	serviceKey  = "sk-lw-project-service"
)

// request is one call the stub control plane received.
type request struct {
	Method, Path, Bearer, IdempotencyKey string
	Body                                 map[string]any
}

// stubControlPlane answers the four routes the seed uses the way the api does,
// and refuses a path listed in refuse with that status.
type stubControlPlane struct {
	mu       sync.Mutex
	requests []request
	refuse   map[string]int
}

func newStub(t *testing.T, refuse map[string]int) (*stubControlPlane, *httptest.Server) {
	t.Helper()
	stub := &stubControlPlane{refuse: refuse}
	server := httptest.NewServer(http.HandlerFunc(stub.serve))
	t.Cleanup(server.Close)
	return stub, server
}

func (s *stubControlPlane) serve(w http.ResponseWriter, r *http.Request) {
	var body map[string]any
	_ = json.NewDecoder(r.Body).Decode(&body)
	s.mu.Lock()
	s.requests = append(s.requests, request{
		Method: r.Method, Path: r.URL.Path, Body: body,
		Bearer:         strings.TrimPrefix(r.Header.Get("Authorization"), "Bearer "),
		IdempotencyKey: r.Header.Get("Idempotency-Key"),
	})
	s.mu.Unlock()
	if status, ok := s.refuse[r.URL.Path]; ok {
		w.WriteHeader(status)
		_, _ = w.Write([]byte(`{"error":"refused by the stub"}`))
		return
	}
	switch {
	case r.Method == http.MethodPost && r.URL.Path == "/api/v1/organizations":
		reply(w, http.StatusCreated, map[string]any{
			"organization": map[string]any{"id": "org_1", "name": "Gateway matrix", "slug": "gateway-matrix"},
			"team":         map[string]any{"id": "team_1", "name": "Gateway matrix", "slug": "gateway-matrix"},
			"adminApiKey":  map[string]any{"id": "key_1", "token": adminKey},
		})
	case r.Method == http.MethodPost && r.URL.Path == "/api/v1/projects":
		reply(w, http.StatusCreated, map[string]any{"id": "project_1", "serviceApiKey": serviceKey, "serviceApiKeyId": "key_2"})
	case r.Method == http.MethodPut && strings.HasPrefix(r.URL.Path, "/api/v1/model-providers/"):
		provider := strings.TrimPrefix(r.URL.Path, "/api/v1/model-providers/")
		// The real route answers the project's whole provider map, registry defaults without ids.
		reply(w, http.StatusOK, map[string]any{
			provider: map[string]any{"id": "mp_" + provider, "provider": provider, "enabled": true},
			"groq":   map[string]any{"provider": "groq", "enabled": false},
		})
	case r.Method == http.MethodPost && r.URL.Path == "/api/gateway/v1/virtual-keys":
		name, _ := body["name"].(string)
		reply(w, http.StatusCreated, map[string]any{"virtual_key": map[string]any{"id": "vk_1"}, "secret": "lw_vk_" + name})
	default:
		w.WriteHeader(http.StatusNotFound)
	}
}

func reply(w http.ResponseWriter, status int, body any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(body)
}

// calls returns the requests to paths starting with prefix, in order.
func (s *stubControlPlane) calls(method, prefix string) []request {
	s.mu.Lock()
	defer s.mu.Unlock()
	var out []request
	for _, r := range s.requests {
		if r.Method == method && strings.HasPrefix(r.Path, prefix) {
			out = append(out, r)
		}
	}
	return out
}

func envOf(vars map[string]string) Getenv {
	return func(key string) string { return vars[key] }
}

func exported(r Result) map[string]string {
	out := map[string]string{}
	for _, e := range r.Exports {
		out[e.Name] = e.Value
	}
	return out
}
