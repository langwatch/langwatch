package auth

import (
	"bytes"
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strconv"
	"sync/atomic"
	"testing"
	"time"

	"github.com/golang-jwt/jwt/v5"
)

// This file exercises the auth-cache ↔ control-plane flow end-to-end
// against an httptest server that behaves the way contract §4 describes.
// It's the closest we can get to integration testing without running
// Alexis's Hono stack. When that lands, the same assertions should
// continue to hold — swap the httptest.URL for the real base URL.

const itestSecret = "integration-test-shared-secret-!"

// controlPlaneMock implements just enough of the control plane for the
// Go gateway to drive: resolve-key / config/:vk_id / changes / health.
type controlPlaneMock struct {
	srv          *httptest.Server
	mux          *http.ServeMux
	revision     atomic.Int64
	resolveCalls atomic.Int32
	configCalls  atomic.Int32
	changesCalls atomic.Int32
	jwtSecret    []byte
	current      *Config
	mu           chan struct{} // unbuffered mutex: one mutation at a time
}

func newControlPlaneMock(t *testing.T) *controlPlaneMock {
	t.Helper()
	cp := &controlPlaneMock{
		mux:       http.NewServeMux(),
		jwtSecret: []byte(itestSecret),
		mu:        make(chan struct{}, 1),
	}
	cp.current = &Config{
		VirtualKeyID: "vk_01HZX9K3M000000000000001",
		Revision:     1,
		ProviderCreds: []ProviderCred{
			{ID: "pc_01", Type: "openai", Credentials: json.RawMessage(`{"api_key":"sk-test"}`)},
		},
		ModelAliases: map[string]string{"chat": "openai/gpt-5-mini"},
	}
	cp.revision.Store(1)
	cp.mux.Handle("/api/internal/gateway/resolve-key", cp.signed(t, cp.handleResolveKey))
	cp.mux.Handle("/api/internal/gateway/config/", cp.signed(t, cp.handleConfig))
	cp.mux.Handle("/api/internal/gateway/changes", cp.signed(t, cp.handleChanges))
	cp.srv = httptest.NewServer(cp.mux)
	t.Cleanup(cp.srv.Close)
	return cp
}

// signed verifies the incoming HMAC signature and enforces the 300s
// replay window — the same order Alexis's Hono middleware uses.
func (cp *controlPlaneMock) signed(t *testing.T, h http.HandlerFunc) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		sig := r.Header.Get("X-LangWatch-Gateway-Signature")
		ts := r.Header.Get("X-LangWatch-Gateway-Timestamp")
		if sig == "" || ts == "" {
			t.Errorf("missing sig/ts headers: sig=%q ts=%q", sig, ts)
			http.Error(w, "missing signature", http.StatusUnauthorized)
			return
		}
		// Drain body so we can sha256 + re-feed to handler.
		body, _ := io.ReadAll(r.Body)
		r.Body = io.NopCloser(bytes.NewReader(body))
		bodyHash := sha256.Sum256(body)
		canonical := r.Method + "\n" + r.URL.Path + "\n" + ts + "\n" + hex.EncodeToString(bodyHash[:])
		mac := hmac.New(sha256.New, []byte(itestSecret))
		mac.Write([]byte(canonical))
		want := hex.EncodeToString(mac.Sum(nil))
		if !hmac.Equal([]byte(want), []byte(sig)) {
			t.Errorf("signature mismatch for %s %s\n canonical: %q\n got:  %s\n want: %s",
				r.Method, r.URL.Path, canonical, sig, want)
			http.Error(w, "bad signature", http.StatusUnauthorized)
			return
		}
		tsI, _ := strconv.ParseInt(ts, 10, 64)
		if delta := time.Since(time.Unix(tsI, 0)); delta > 300*time.Second || delta < -300*time.Second {
			http.Error(w, "replay window exceeded", http.StatusUnauthorized)
			return
		}
		h(w, r)
	})
}

func (cp *controlPlaneMock) handleResolveKey(w http.ResponseWriter, r *http.Request) {
	cp.resolveCalls.Add(1)
	var req resolveReq
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "bad json", http.StatusBadRequest)
		return
	}
	cp.mu <- struct{}{}
	defer func() { <-cp.mu }()
	cur := cp.current
	claims := &JWTClaims{
		VirtualKeyID:   cur.VirtualKeyID,
		ProjectID:      "proj_01HZX",
		TeamID:         "team_01HZX",
		OrganizationID: "org_01HZX",
		PrincipalID:    "user_01HZX",
		Revision:       cp.revision.Load(),
		IssuedAt:       time.Now().Unix(),
		ExpiresAt:      time.Now().Add(15 * time.Minute).Unix(),
		Issuer:         "langwatch-control-plane",
		Audience:       "langwatch-gateway",
	}
	tok := jwt.NewWithClaims(jwt.SigningMethodHS256, claims)
	signed, _ := tok.SignedString(cp.jwtSecret)
	_ = json.NewEncoder(w).Encode(resolveResp{
		JWT: signed, Revision: claims.Revision,
		KeyID: cur.VirtualKeyID, DisplayPrefix: req.KeyPresented[:min(17, len(req.KeyPresented))],
	})
}

func (cp *controlPlaneMock) handleConfig(w http.ResponseWriter, r *http.Request) {
	cp.configCalls.Add(1)
	rev := cp.revision.Load()
	if etag := r.Header.Get("If-None-Match"); etag != "" {
		if etag == `"`+strconv.FormatInt(rev, 10)+`"` {
			w.WriteHeader(http.StatusNotModified)
			return
		}
	}
	cp.mu <- struct{}{}
	defer func() { <-cp.mu }()
	cur := *cp.current
	cur.Revision = rev
	w.Header().Set("ETag", `"`+strconv.FormatInt(rev, 10)+`"`)
	_ = json.NewEncoder(w).Encode(cur)
}

func (cp *controlPlaneMock) handleChanges(w http.ResponseWriter, r *http.Request) {
	cp.changesCalls.Add(1)
	sinceStr := r.URL.Query().Get("since")
	since, _ := strconv.ParseInt(sinceStr, 10, 64)
	if cp.revision.Load() == since {
		w.WriteHeader(http.StatusNoContent)
		return
	}
	_ = json.NewEncoder(w).Encode(map[string]any{
		"current_revision": cp.revision.Load(),
		"changes": []ChangeEvent{
			{VirtualKeyID: cp.current.VirtualKeyID, NewRevision: cp.revision.Load(), Kind: "vk_config_updated"},
		},
	})
}

// bumpRevision simulates a VK mutation on the control-plane side.
func (cp *controlPlaneMock) bumpRevision() { cp.revision.Add(1) }

func min(a, b int) int {
	if a < b {
		return a
	}
	return b
}

// --- The actual integration scenarios. ---

func TestIntegrationResolveKeyThenCachedHotPath(t *testing.T) {
	cp := newControlPlaneMock(t)
	resolver := NewHTTPResolver(HTTPResolverOptions{
		BaseURL:        cp.srv.URL,
		InternalSecret: itestSecret,
		JWTSecret:      itestSecret,
		GatewayNodeID:  "gw-int-test",
		Timeout:        2 * time.Second,
	})
	c, err := NewCache(resolver, quietLogger(), CacheOptions{LRUSize: 100})
	if err != nil {
		t.Fatal(err)
	}
	// First request: resolve-key round trip.
	b1, err := c.Resolve(context.Background(), "lw_vk_live_01HZX9K3M000000000000001")
	if err != nil {
		t.Fatalf("first resolve: %v", err)
	}
	if b1.JWTClaims.VirtualKeyID != "vk_01HZX9K3M000000000000001" {
		t.Errorf("vk_id: %q", b1.JWTClaims.VirtualKeyID)
	}
	// Second request: cached, no round trip.
	b2, err := c.Resolve(context.Background(), "lw_vk_live_01HZX9K3M000000000000001")
	if err != nil {
		t.Fatalf("second resolve: %v", err)
	}
	if b2.JWT != b1.JWT {
		t.Error("second resolve did not return cached bundle")
	}
	if got := cp.resolveCalls.Load(); got != 1 {
		t.Errorf("expected 1 control-plane call, got %d", got)
	}
}

func TestIntegrationConfigFetchIfNoneMatch(t *testing.T) {
	cp := newControlPlaneMock(t)
	resolver := NewHTTPResolver(HTTPResolverOptions{
		BaseURL:        cp.srv.URL,
		InternalSecret: itestSecret,
		JWTSecret:      itestSecret,
		GatewayNodeID:  "gw-int-test",
		Timeout:        2 * time.Second,
	})
	// First fetch: no revision → full body.
	cfg, changed, err := resolver.FetchConfig(context.Background(), "vk_01HZX", 0)
	if err != nil || !changed || cfg == nil {
		t.Fatalf("first fetch: err=%v changed=%v cfg=%v", err, changed, cfg)
	}
	// Second fetch with same revision → 304.
	cfg2, changed2, err := resolver.FetchConfig(context.Background(), "vk_01HZX", cfg.Revision)
	if err != nil {
		t.Fatalf("second fetch: %v", err)
	}
	if changed2 || cfg2 != nil {
		t.Errorf("expected 304 no-change, got changed=%v cfg=%v", changed2, cfg2)
	}
	// Bump on server → third fetch returns updated.
	cp.bumpRevision()
	cfg3, changed3, err := resolver.FetchConfig(context.Background(), "vk_01HZX", cfg.Revision)
	if err != nil || !changed3 {
		t.Fatalf("post-bump fetch: err=%v changed=%v", err, changed3)
	}
	if cfg3.Revision <= cfg.Revision {
		t.Errorf("revision did not advance: %d -> %d", cfg.Revision, cfg3.Revision)
	}
}

func TestIntegrationChangesLongPollReturns204WhenQuiet(t *testing.T) {
	cp := newControlPlaneMock(t)
	resolver := NewHTTPResolver(HTTPResolverOptions{
		BaseURL:        cp.srv.URL,
		InternalSecret: itestSecret,
		JWTSecret:      itestSecret,
		GatewayNodeID:  "gw-int-test",
		Timeout:        2 * time.Second,
	})
	ev, err := resolver.WaitForChanges(context.Background(), "org_01", cp.revision.Load(), time.Second)
	if err != nil {
		t.Fatalf("wait: %v", err)
	}
	if ev != nil {
		t.Errorf("expected no events (204), got %+v", ev)
	}
}

func TestIntegrationChangesReturnsEventWhenMutated(t *testing.T) {
	cp := newControlPlaneMock(t)
	resolver := NewHTTPResolver(HTTPResolverOptions{
		BaseURL:        cp.srv.URL,
		InternalSecret: itestSecret,
		JWTSecret:      itestSecret,
		GatewayNodeID:  "gw-int-test",
		Timeout:        2 * time.Second,
	})
	cp.bumpRevision()
	ev, err := resolver.WaitForChanges(context.Background(), "org_01", 1, time.Second)
	if err != nil {
		t.Fatalf("wait: %v", err)
	}
	if len(ev) != 1 || ev[0].Kind != "vk_config_updated" {
		t.Errorf("events: %+v", ev)
	}
}
