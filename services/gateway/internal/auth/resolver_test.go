package auth

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strconv"
	"testing"
	"time"

	"github.com/golang-jwt/jwt/v5"
)

const testSecret = "test-gateway-secret-32bytes-long!"

func signTestJWT(t *testing.T, claims JWTClaims) string {
	t.Helper()
	claims.IssuedAt = time.Now().Unix()
	if claims.ExpiresAt == 0 {
		claims.ExpiresAt = time.Now().Add(15 * time.Minute).Unix()
	}
	tok := jwt.NewWithClaims(jwt.SigningMethodHS256, &claims)
	signed, err := tok.SignedString([]byte(testSecret))
	if err != nil {
		t.Fatalf("sign: %v", err)
	}
	return signed
}

func TestResolveKeySuccess(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/api/internal/gateway/resolve-key" {
			t.Fatalf("path: %s", r.URL.Path)
		}
		if r.Header.Get("X-LangWatch-Gateway-Signature") == "" {
			t.Fatal("missing X-LangWatch-Gateway-Signature")
		}
		if r.Header.Get("X-LangWatch-Gateway-Node") != "gw-test-1" {
			t.Fatalf("node id: %q", r.Header.Get("X-LangWatch-Gateway-Node"))
		}
		var body resolveReq
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			t.Fatalf("decode req: %v", err)
		}
		if body.KeyPresented != "lw_vk_live_testkey" || body.GatewayNodeID != "gw-test-1" {
			t.Fatalf("req body: %+v", body)
		}
		jwtStr := signTestJWT(t, JWTClaims{
			VirtualKeyID:   "vk_123",
			ProjectID:      "proj_1",
			TeamID:         "team_1",
			OrganizationID: "org_1",
			PrincipalID:    "usr_1",
			Revision:       42,
		})
		_ = json.NewEncoder(w).Encode(resolveResp{
			JWT:           jwtStr,
			Revision:      42,
			KeyID:         "vk_123",
			DisplayPrefix: "lw_vk_live_testke",
		})
	}))
	defer srv.Close()
	r := NewHTTPResolver(HTTPResolverOptions{BaseURL: srv.URL, InternalSecret: testSecret, JWTSecret: testSecret, GatewayNodeID: "gw-test-1", Timeout: 2 * time.Second})
	b, err := r.ResolveKey(context.Background(), "lw_vk_live_testkey")
	if err != nil {
		t.Fatalf("resolve: %v", err)
	}
	if b.JWTClaims.VirtualKeyID != "vk_123" {
		t.Errorf("vk_id: %s", b.JWTClaims.VirtualKeyID)
	}
	if b.JWTClaims.Revision != 42 {
		t.Errorf("revision: %d", b.JWTClaims.Revision)
	}
	if b.Config != nil {
		t.Errorf("config should be nil after resolve-key (fetched separately via /config/:vk_id)")
	}
	if b.DisplayPrefix != "lw_vk_live_testke" {
		t.Errorf("display_prefix: %q", b.DisplayPrefix)
	}
	if b.Expired() {
		t.Error("bundle unexpectedly expired")
	}
}

func TestResolveKey401IsErrInvalidKey(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusUnauthorized)
	}))
	defer srv.Close()
	r := NewHTTPResolver(HTTPResolverOptions{BaseURL: srv.URL, InternalSecret: testSecret, JWTSecret: testSecret, GatewayNodeID: "n", Timeout: time.Second})
	_, err := r.ResolveKey(context.Background(), "bogus")
	if err != ErrInvalidKey {
		t.Fatalf("expected ErrInvalidKey, got %v", err)
	}
}

func TestResolveKey403IsErrKeyRevoked(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusForbidden)
	}))
	defer srv.Close()
	r := NewHTTPResolver(HTTPResolverOptions{BaseURL: srv.URL, InternalSecret: testSecret, JWTSecret: testSecret, GatewayNodeID: "n", Timeout: time.Second})
	_, err := r.ResolveKey(context.Background(), "revoked")
	if err != ErrKeyRevoked {
		t.Fatalf("expected ErrKeyRevoked, got %v", err)
	}
}

func TestFetchConfig304WithIfNoneMatch(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("If-None-Match") != `"42"` {
			t.Errorf("If-None-Match: %q", r.Header.Get("If-None-Match"))
		}
		w.WriteHeader(http.StatusNotModified)
	}))
	defer srv.Close()
	r := NewHTTPResolver(HTTPResolverOptions{BaseURL: srv.URL, InternalSecret: testSecret, JWTSecret: testSecret, GatewayNodeID: "n", Timeout: time.Second})
	cfg, changed, err := r.FetchConfig(context.Background(), "vk_x", 42)
	if err != nil {
		t.Fatalf("fetch-config: %v", err)
	}
	if cfg != nil || changed {
		t.Errorf("expected no change, got cfg=%v changed=%v", cfg, changed)
	}
}

func TestFetchConfig200ReturnsNewRevision(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_ = json.NewEncoder(w).Encode(Config{VirtualKeyID: "vk_y", Revision: 99})
	}))
	defer srv.Close()
	r := NewHTTPResolver(HTTPResolverOptions{BaseURL: srv.URL, InternalSecret: testSecret, JWTSecret: testSecret, GatewayNodeID: "n", Timeout: time.Second})
	cfg, changed, err := r.FetchConfig(context.Background(), "vk_y", 42)
	if err != nil || !changed {
		t.Fatalf("expected change, got changed=%v err=%v", changed, err)
	}
	if cfg.Revision != 99 {
		t.Errorf("revision: %d", cfg.Revision)
	}
}

func TestWaitForChangesReturnsEvents(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Query().Get("since") != "10" {
			t.Errorf("since: %s", r.URL.Query().Get("since"))
		}
		if r.URL.Query().Get("timeout_s") == "" {
			t.Errorf("missing timeout_s query param")
		}
		_ = json.NewEncoder(w).Encode(map[string]any{
			"current_revision": 11,
			"changes": []ChangeEvent{
				{VirtualKeyID: "vk_a", NewRevision: 11, Kind: "vk_config_updated"},
			},
		})
	}))
	defer srv.Close()
	r := NewHTTPResolver(HTTPResolverOptions{BaseURL: srv.URL, InternalSecret: testSecret, JWTSecret: testSecret, GatewayNodeID: "n", Timeout: time.Second})
	ev, err := r.WaitForChanges(context.Background(), "org_01", 10, 25*time.Second)
	if err != nil {
		t.Fatalf("wait: %v", err)
	}
	if len(ev) != 1 || ev[0].Kind != "vk_config_updated" {
		t.Errorf("events: %+v", ev)
	}
}

func TestWaitForChanges204NoMutations(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusNoContent)
	}))
	defer srv.Close()
	r := NewHTTPResolver(HTTPResolverOptions{BaseURL: srv.URL, InternalSecret: testSecret, JWTSecret: testSecret, GatewayNodeID: "n", Timeout: time.Second})
	ev, err := r.WaitForChanges(context.Background(), "org_01", 10, 25*time.Second)
	if err != nil || ev != nil {
		t.Fatalf("204 expected no events and no error, got err=%v ev=%v", err, ev)
	}
}

func TestVerifyJWTRejectsInvalidSignature(t *testing.T) {
	r := NewHTTPResolver(HTTPResolverOptions{BaseURL: "http://nowhere", InternalSecret: testSecret, JWTSecret: testSecret, GatewayNodeID: "n", Timeout: time.Second}).(*httpResolver)
	other := jwt.NewWithClaims(jwt.SigningMethodHS256, &JWTClaims{VirtualKeyID: "vk_1", ProjectID: "p", ExpiresAt: time.Now().Add(time.Minute).Unix()})
	token, _ := other.SignedString([]byte("wrong-secret"))
	_, err := r.VerifyJWT(token)
	if err == nil {
		t.Fatal("expected signature verify error")
	}
}

func TestVerifyJWTRejectsExpired(t *testing.T) {
	r := NewHTTPResolver(HTTPResolverOptions{BaseURL: "http://nowhere", InternalSecret: testSecret, JWTSecret: testSecret, GatewayNodeID: "n", Timeout: time.Second}).(*httpResolver)
	claims := &JWTClaims{VirtualKeyID: "vk_1", ProjectID: "p", ExpiresAt: time.Now().Add(-time.Minute).Unix()}
	tok := jwt.NewWithClaims(jwt.SigningMethodHS256, claims)
	token, _ := tok.SignedString([]byte(testSecret))
	_, err := r.VerifyJWT(token)
	if err == nil {
		t.Fatal("expected expired error")
	}
}

func TestVerifyJWTAcceptsPreviousSecretDuringRotation(t *testing.T) {
	// Rotation window: gateway was restarted with JWTSecret=new and
	// JWTSecretPrevious=old. Tokens signed with either should verify.
	prev := "previous-jwt-secret-32-bytes-!!!"
	curr := "current-jwt-secret-32-bytes-!!!!"
	r := NewHTTPResolver(HTTPResolverOptions{
		BaseURL:           "http://nowhere",
		InternalSecret:    testSecret,
		JWTSecret:         curr,
		JWTSecretPrevious: prev,
		GatewayNodeID:     "n",
		Timeout:           time.Second,
	}).(*httpResolver)

	claims := &JWTClaims{VirtualKeyID: "vk_1", ProjectID: "p", ExpiresAt: time.Now().Add(time.Minute).Unix()}
	tok := jwt.NewWithClaims(jwt.SigningMethodHS256, claims)
	signedCurrent, _ := tok.SignedString([]byte(curr))
	if _, err := r.VerifyJWT(signedCurrent); err != nil {
		t.Errorf("current-signed token should verify: %v", err)
	}

	tok2 := jwt.NewWithClaims(jwt.SigningMethodHS256, claims)
	signedPrev, _ := tok2.SignedString([]byte(prev))
	if _, err := r.VerifyJWT(signedPrev); err != nil {
		t.Errorf("previous-signed token should verify during rotation: %v", err)
	}

	tok3 := jwt.NewWithClaims(jwt.SigningMethodHS256, claims)
	signedOther, _ := tok3.SignedString([]byte("unrelated-secret-32-bytes-!!!!!!"))
	if _, err := r.VerifyJWT(signedOther); err == nil {
		t.Error("token signed by unrelated secret should be rejected even with previous set")
	}
}

func TestVerifyJWTStrictWhenPreviousEmpty(t *testing.T) {
	// Normal (non-rotation) posture: only JWTSecret is set. Tokens
	// signed with anything else — including what WAS the previous
	// secret before it was rotated out — must be rejected.
	r := NewHTTPResolver(HTTPResolverOptions{
		BaseURL:        "http://nowhere",
		InternalSecret: testSecret,
		JWTSecret:      testSecret,
		GatewayNodeID:  "n",
		Timeout:        time.Second,
	}).(*httpResolver)
	claims := &JWTClaims{VirtualKeyID: "vk_1", ProjectID: "p", ExpiresAt: time.Now().Add(time.Minute).Unix()}
	tok := jwt.NewWithClaims(jwt.SigningMethodHS256, claims)
	signed, _ := tok.SignedString([]byte("retired-previous-secret!!!"))
	if _, err := r.VerifyJWT(signed); err == nil {
		t.Error("expected rejection after rotation window closed (previous empty)")
	}
}

// used only to silence strconv lint if unused in future edits.
var _ = strconv.Itoa
