package access

import (
	"context"
	"crypto/ecdsa"
	"crypto/elliptic"
	"crypto/rand"
	"crypto/rsa"
	"encoding/base64"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	jose "github.com/go-jose/go-jose/v4"
	"github.com/go-jose/go-jose/v4/jwt"
	"go.uber.org/zap"
)

// testIssuer is an OIDC provider: discovery, a JWKS it can rotate, and a signer.
type testIssuer struct {
	server   *httptest.Server
	mu       sync.Mutex
	keys     []jose.JSONWebKey
	jwksHits atomic.Int32
}

func newTestIssuer(t *testing.T) *testIssuer {
	is := &testIssuer{}
	mux := http.NewServeMux()
	mux.HandleFunc("/.well-known/openid-configuration", func(w http.ResponseWriter, r *http.Request) {
		_ = json.NewEncoder(w).Encode(map[string]string{"issuer": is.server.URL, "jwks_uri": is.server.URL + "/keys"})
	})
	mux.HandleFunc("/keys", func(w http.ResponseWriter, r *http.Request) {
		is.jwksHits.Add(1)
		is.mu.Lock()
		defer is.mu.Unlock()
		_ = json.NewEncoder(w).Encode(jose.JSONWebKeySet{Keys: is.keys})
	})
	is.server = httptest.NewServer(mux)
	t.Cleanup(is.server.Close)
	return is
}

type signingKey struct {
	kid string
	alg jose.SignatureAlgorithm
	key any
}

func newECKey(t *testing.T, kid string) signingKey {
	priv, err := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	return signingKey{kid: kid, alg: jose.ES256, key: priv}
}

// publish replaces the issuer's key set with the public halves of keys.
func (is *testIssuer) publish(keys ...signingKey) {
	is.mu.Lock()
	defer is.mu.Unlock()
	is.keys = nil
	for _, k := range keys {
		var pub any
		switch priv := k.key.(type) {
		case *ecdsa.PrivateKey:
			pub = &priv.PublicKey
		case *rsa.PrivateKey:
			pub = &priv.PublicKey
		}
		is.keys = append(is.keys, jose.JSONWebKey{Key: pub, KeyID: k.kid, Algorithm: string(k.alg), Use: "sig"})
	}
}

func sign(t *testing.T, k signingKey, claims map[string]any) string {
	t.Helper()
	opts := (&jose.SignerOptions{}).WithType("JWT")
	if k.kid != "" {
		opts = opts.WithHeader("kid", k.kid)
	}
	signer, err := jose.NewSigner(jose.SigningKey{Algorithm: k.alg, Key: k.key}, opts)
	if err != nil {
		t.Fatal(err)
	}
	token, err := jwt.Signed(signer).Claims(claims).Serialize()
	if err != nil {
		t.Fatal(err)
	}
	return token
}

type verifyFixture struct {
	t        *testing.T
	issuer   *testIssuer
	other    *testIssuer
	key      signingKey
	clock    atomic.Int64 // UnixNano; key warm-ups read it from goroutines
	verifier *Verifier
}

func newVerifyFixture(t *testing.T) *verifyFixture {
	fx := &verifyFixture{t: t, issuer: newTestIssuer(t), other: newTestIssuer(t), key: newECKey(t, "k1")}
	fx.setClock(now)
	fx.issuer.publish(fx.key)
	fx.other.publish(newECKey(t, "k1"))
	fx.verifier = &Verifier{Now: fx.now, Log: zap.NewNop()}
	fx.load(`
issuers:
  - {name: staff, url: '` + fx.issuer.server.URL + `', required_claims: {email_verified: true}, username_claim: email}
  - {name: other, url: '` + fx.other.server.URL + `'}
users:
  - {name: alice, tier: read, databases: [analytics], login: {token: {issuer: staff, subject: alice@example.com}}}
  - {name: metabase, tier: read, databases: [analytics], login: {rolling: {dir: /secrets/metabase}}}
`)
	return fx
}

func (fx *verifyFixture) now() time.Time { return time.Unix(0, fx.clock.Load()) }

func (fx *verifyFixture) setClock(at time.Time) { fx.clock.Store(at.UnixNano()) }

func (fx *verifyFixture) load(raw string) {
	fx.t.Helper()
	fx.verifier.SetFile(context.Background(), mustParse(fx.t, raw))
}

// claims are a valid set for alice, changed by edit.
func (fx *verifyFixture) claims(edit func(map[string]any)) map[string]any {
	c := map[string]any{
		"iss":            fx.issuer.server.URL,
		"aud":            "clickhouse",
		"sub":            "1234567890",
		"email":          "alice@example.com",
		"email_verified": true,
		"exp":            fx.now().Add(time.Hour).Unix(),
		"iat":            fx.now().Unix(),
	}
	if edit != nil {
		edit(c)
	}
	return c
}

func (fx *verifyFixture) serve(user, token string) int {
	req := httptest.NewRequest(http.MethodGet, "/verify", nil)
	req.SetBasicAuth(user, token)
	rec := httptest.NewRecorder()
	fx.verifier.Handler().ServeHTTP(rec, req)
	return rec.Code
}

func codeOf(err error) string {
	var ve *VerifyError
	if errors.As(err, &ve) {
		return ve.Code
	}
	return ""
}

// @scenario "A token login is accepted for the user its claim names"
func TestVerifier_AcceptsTheNamedUser(t *testing.T) {
	fx := newVerifyFixture(t)
	if code := fx.serve("alice", sign(t, fx.key, fx.claims(nil))); code != http.StatusOK {
		t.Errorf("valid token answered %d, want 200", code)
	}

	t.Run("with an RSA key and an array audience", func(t *testing.T) {
		priv, err := rsa.GenerateKey(rand.Reader, 2048)
		if err != nil {
			t.Fatal(err)
		}
		rsaKey := signingKey{kid: "r1", alg: jose.RS256, key: priv}
		fx.issuer.publish(fx.key, rsaKey)
		fx.setClock(fx.now().Add(KeyRefetchMinInterval))
		token := sign(t, rsaKey, fx.claims(func(c map[string]any) { c["aud"] = []string{"grafana", "clickhouse"} }))
		if err := fx.verifier.Verify(context.Background(), "alice", token); err != nil {
			t.Errorf("RSA token refused: %v", err)
		}
	})
}

// @scenario "A token is refused unless every check passes"
func TestVerifier_RefusesUnlessEveryCheckPasses(t *testing.T) {
	fx := newVerifyFixture(t)
	valid := func(edit func(map[string]any)) string { return sign(t, fx.key, fx.claims(edit)) }
	unsigned := func() string {
		token := valid(nil)
		parts := strings.Split(token, ".")
		return "eyJhbGciOiJub25lIn0." + parts[1] + "."
	}
	hmac := func() string {
		signer, err := jose.NewSigner(jose.SigningKey{Algorithm: jose.HS256, Key: []byte("0123456789abcdef0123456789abcdef")}, (&jose.SignerOptions{}).WithHeader("kid", "k1"))
		if err != nil {
			t.Fatal(err)
		}
		token, _ := jwt.Signed(signer).Claims(fx.claims(nil)).Serialize()
		return token
	}
	tampered := func() string {
		parts := strings.Split(valid(nil), ".")
		payload, _ := json.Marshal(fx.claims(func(c map[string]any) { c["email"] = "mallory@example.com" }))
		parts[1] = base64.RawURLEncoding.EncodeToString(payload)
		return strings.Join(parts, ".")
	}

	cases := []struct {
		name, user, token, code string
	}{
		{"expired", "alice", valid(func(c map[string]any) { c["exp"] = fx.now().Add(-time.Minute).Unix() }), "claims"},
		{"not yet valid", "alice", valid(func(c map[string]any) { c["nbf"] = fx.now().Add(time.Minute).Unix() }), "claims"},
		{"without exp", "alice", valid(func(c map[string]any) { delete(c, "exp") }), "claims"},
		{"for another audience", "alice", valid(func(c map[string]any) { c["aud"] = "grafana" }), "claims"},
		{"naming another issuer", "alice", valid(func(c map[string]any) { c["iss"] = fx.other.server.URL }), "claims"},
		{"signed by another issuer", "alice", sign(t, newECKey(t, "k1"), fx.claims(nil)), "bad_signature"},
		{"signed by an unknown key", "alice", sign(t, newECKey(t, "k9"), fx.claims(nil)), "unknown_key"},
		{"for another subject", "alice", valid(func(c map[string]any) { c["email"] = "alice@evil.example" }), "wrong_subject"},
		{"missing a required claim", "alice", valid(func(c map[string]any) { c["email_verified"] = false }), "required_claim"},
		{"unsigned", "alice", unsigned(), "malformed"},
		{"HMAC-signed", "alice", hmac(), "malformed"},
		{"with a tampered payload", "alice", tampered(), "bad_signature"},
		{"too large", "alice", strings.Repeat("a", MaxTokenBytes+1), "too_large"},
		{"presented for a password user", "metabase", valid(nil), "not_token_user"},
		{"presented for an unknown user", "mallory", valid(nil), "not_token_user"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			err := fx.verifier.Verify(context.Background(), tc.user, tc.token)
			if got := codeOf(err); got != tc.code {
				t.Errorf("Verify = %v (code %q), want code %q", err, got, tc.code)
			}
			if code := fx.serve(tc.user, tc.token); code != http.StatusUnauthorized {
				t.Errorf("handler answered %d, want 401", code)
			}
		})
	}

	t.Run("without Basic credentials", func(t *testing.T) {
		rec := httptest.NewRecorder()
		fx.verifier.Handler().ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/verify", nil))
		if rec.Code != http.StatusUnauthorized {
			t.Errorf("answered %d, want 401", rec.Code)
		}
	})
}

// @scenario "A rotated issuer signing key is picked up without a restart"
func TestVerifier_PicksUpARotatedKey(t *testing.T) {
	fx := newVerifyFixture(t)
	if err := fx.verifier.Verify(context.Background(), "alice", sign(t, fx.key, fx.claims(nil))); err != nil {
		t.Fatalf("first token refused: %v", err)
	}
	hits := fx.issuer.jwksHits.Load()

	next := newECKey(t, "k2")
	fx.issuer.publish(next)
	fx.setClock(fx.now().Add(KeyRefetchMinInterval))
	if err := fx.verifier.Verify(context.Background(), "alice", sign(t, next, fx.claims(nil))); err != nil {
		t.Fatalf("token signed by the rotated key refused: %v", err)
	}
	if got := fx.issuer.jwksHits.Load() - hits; got != 1 {
		t.Errorf("rotation cost %d key fetches, want 1", got)
	}

	hits = fx.issuer.jwksHits.Load()
	for i := range 50 {
		forged := sign(t, newECKey(t, "forged-"+string(rune('a'+i%26))), fx.claims(nil))
		if err := fx.verifier.Verify(context.Background(), "alice", forged); codeOf(err) != "unknown_key" {
			t.Fatalf("forged kid: %v", err)
		}
	}
	if got := fx.issuer.jwksHits.Load() - hits; got != 0 {
		t.Errorf("unknown key ids inside the refetch interval caused %d fetches, want 0", got)
	}
}

// @scenario "A verified token is answered from cache until it expires"
func TestVerifier_CachesUntilExpiry(t *testing.T) {
	fx := newVerifyFixture(t)
	token := sign(t, fx.key, fx.claims(func(c map[string]any) { c["exp"] = fx.now().Add(time.Minute).Unix() }))
	if err := fx.verifier.Verify(context.Background(), "alice", token); err != nil {
		t.Fatalf("first verify: %v", err)
	}

	// From here a fresh verification would fail: the issuer publishes no keys
	// and the refetch interval has not passed.
	fx.issuer.publish()
	st := fx.verifier.state.Load()
	ks := st.keys["staff"]
	ks.mu.Lock()
	ks.keys, ks.lastAttempt = nil, fx.now()
	ks.mu.Unlock()

	fx.setClock(fx.now().Add(20 * time.Second))
	if err := fx.verifier.Verify(context.Background(), "alice", token); err != nil {
		t.Errorf("cached token refused before it expired: %v", err)
	}
	if err := fx.verifier.Verify(context.Background(), "mallory", token); codeOf(err) != "not_token_user" {
		t.Errorf("the cache answered for another user: %v", err)
	}

	t.Run("after it expires", func(t *testing.T) {
		fx.setClock(now.Add(time.Minute))
		if err := fx.verifier.Verify(context.Background(), "alice", token); err == nil {
			t.Error("an expired token was answered from cache")
		}
	})

	t.Run("after the access file changes", func(t *testing.T) {
		fx.setClock(now)
		fx.issuer.publish(fx.key)
		fx.verifier.SetFile(context.Background(), st.file)
		if n := len(fx.verifier.state.Load().cache.entries); n != 0 {
			t.Errorf("cache holds %d tokens after a reload, want 0", n)
		}
		fx.load("users: []\n")
		if err := fx.verifier.Verify(context.Background(), "alice", token); codeOf(err) != "not_token_user" {
			t.Errorf("a removed user still logs in: %v", err)
		}
	})
}

func TestVerifier_DiscoveryMustNameTheIssuer(t *testing.T) {
	is := newTestIssuer(t)
	key := newECKey(t, "k1")
	is.publish(key)
	v := &Verifier{Now: func() time.Time { return now }, Log: zap.NewNop()}
	// The configured URL differs from what discovery reports (trailing slash).
	v.SetFile(context.Background(), mustParse(t, "issuers: [{name: s, url: '"+is.server.URL+"/'}]\nusers: [{name: alice, tier: inspect, login: {token: {issuer: s}}}]\n"))
	token := sign(t, key, map[string]any{"iss": is.server.URL + "/", "aud": "clickhouse", "sub": "alice", "exp": now.Add(time.Hour).Unix()})
	if err := v.Verify(context.Background(), "alice", token); codeOf(err) != "unknown_key" || !strings.Contains(err.Error(), "discovery names issuer") {
		t.Errorf("Verify = %v, want a discovery issuer mismatch", err)
	}
}

func TestVerifier_JWKSURLSkipsDiscovery(t *testing.T) {
	is := newTestIssuer(t)
	key := newECKey(t, "")
	is.publish(key)
	v := &Verifier{Now: func() time.Time { return now }, Log: zap.NewNop()}
	v.SetFile(context.Background(), mustParse(t, "issuers: [{name: k8s, url: 'https://kubernetes.default.svc', jwks_url: '"+is.server.URL+"/keys'}]\n"+
		"users: [{name: grafana, tier: inspect, login: {token: {issuer: k8s, subject: 'system:serviceaccount:monitoring:grafana'}}}]\n"))
	token := sign(t, key, map[string]any{"iss": "https://kubernetes.default.svc", "aud": []string{"clickhouse"}, "sub": "system:serviceaccount:monitoring:grafana", "exp": now.Add(time.Hour).Unix()})
	if err := v.Verify(context.Background(), "grafana", token); err != nil {
		t.Errorf("token without kid from a single-key JWKS refused: %v", err)
	}
}

func TestVerifier_Healthz(t *testing.T) {
	rec := httptest.NewRecorder()
	(&Verifier{Log: zap.NewNop()}).Handler().ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/healthz", nil))
	if rec.Code != http.StatusOK {
		t.Errorf("healthz = %d", rec.Code)
	}
}
