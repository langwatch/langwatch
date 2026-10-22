package access

import (
	"context"
	"crypto/sha256"
	"errors"
	"fmt"
	"net/http"
	"sync"
	"sync/atomic"
	"time"

	jose "github.com/go-jose/go-jose/v4"
	"github.com/go-jose/go-jose/v4/jwt"
	"go.uber.org/zap"
)

const (
	// MaxTokenBytes is far above a typical 1-2 KiB OIDC token and far below
	// ClickHouse's own limits (64 KiB native, 128 KiB HTTP header).
	MaxTokenBytes = 16 << 10
	// ClockLeeway tolerates clock skew between the issuer and this pod.
	ClockLeeway   = 30 * time.Second
	maxCacheItems = 10000
)

// Asymmetric algorithms only: "none" and HMAC can never verify here.
var signatureAlgorithms = []jose.SignatureAlgorithm{
	jose.RS256, jose.RS384, jose.RS512,
	jose.PS256, jose.PS384, jose.PS512,
	jose.ES256, jose.ES384, jose.ES512,
	jose.EdDSA,
}

// VerifyError carries a stable code for a refused token; tests and logs read
// the code, never the token.
type VerifyError struct {
	Code string
	Err  error
}

func (e *VerifyError) Error() string { return e.Code + ": " + e.Err.Error() }
func (e *VerifyError) Unwrap() error { return e.Err }

func refuse(code string, format string, args ...any) error {
	return &VerifyError{Code: code, Err: fmt.Errorf(format, args...)}
}

// Verifier decides token logins for the users of the current access file.
type Verifier struct {
	Now func() time.Time
	Log *zap.Logger

	state atomic.Pointer[verifierState]
}

type verifierState struct {
	file  *File
	keys  map[string]*keySource // by issuer name
	cache *tokenCache
}

// SetFile switches to a newly loaded access file. Verified tokens are
// forgotten, so a removed user or a changed subject takes effect at once.
func (v *Verifier) SetFile(ctx context.Context, f *File) {
	old := v.state.Load()
	st := &verifierState{file: f, keys: map[string]*keySource{}, cache: &tokenCache{entries: map[[32]byte]time.Time{}}}
	for _, is := range f.Issuers {
		// Keep fetched keys when the issuer itself is unchanged.
		if old != nil {
			if prev, ok := old.keys[is.Name]; ok && sameIssuer(prev.issuer, is) {
				st.keys[is.Name] = prev
				continue
			}
		}
		st.keys[is.Name] = newKeySource(is)
	}
	v.state.Store(st)
	for name, ks := range st.keys {
		go func() {
			if err := ks.warm(ctx, v.Now()); err != nil {
				v.Log.Warn("issuer keys not fetched yet", zap.String("issuer", name), zap.Error(err))
			}
		}()
	}
}

func sameIssuer(a, b Issuer) bool {
	return a.URL == b.URL && a.JWKSURL == b.JWKSURL && a.CAFile == b.CAFile
}

// Verify accepts token as user's password when user is a token user and the
// token is a valid JWT of the user's issuer naming the user's subject.
func (v *Verifier) Verify(ctx context.Context, user, token string) error {
	st := v.state.Load()
	if st == nil {
		return refuse("not_ready", "no access file loaded")
	}
	u, ok := st.file.User(user)
	if !ok || u.Login.Token == nil {
		return refuse("not_token_user", "%q is not a token user", user)
	}
	if len(token) > MaxTokenBytes {
		return refuse("too_large", "token of %d bytes exceeds %d", len(token), MaxTokenBytes)
	}
	now := v.Now()
	cacheKey := sha256.Sum256([]byte(user + "\x00" + token))
	if st.cache.valid(cacheKey, now) {
		return nil
	}

	is, _ := st.file.Issuer(u.Login.Token.Issuer)
	parsed, err := jwt.ParseSigned(token, signatureAlgorithms)
	if err != nil {
		return refuse("malformed", "%v", err)
	}
	if len(parsed.Headers) != 1 {
		return refuse("malformed", "want one signature, got %d", len(parsed.Headers))
	}
	header := parsed.Headers[0]
	key, err := st.keys[is.Name].key(ctx, header.KeyID, now)
	if err != nil {
		return refuse("unknown_key", "%v", err)
	}
	if key.Algorithm != "" && key.Algorithm != header.Algorithm {
		return refuse("bad_signature", "key %q is for %s, token uses %s", key.KeyID, key.Algorithm, header.Algorithm)
	}
	var std jwt.Claims
	var claims map[string]any
	if err := parsed.Claims(key.Key, &std, &claims); err != nil {
		return refuse("bad_signature", "%v", err)
	}
	if std.Expiry == nil {
		return refuse("claims", "no exp claim")
	}
	expected := jwt.Expected{Issuer: is.URL, AnyAudience: jwt.Audience{is.Audience}, Time: now}
	if err := std.ValidateWithLeeway(expected, ClockLeeway); err != nil {
		return refuse("claims", "%v", err)
	}
	if got, _ := claims[is.UsernameClaim].(string); got != u.Login.Token.Subject {
		return refuse("wrong_subject", "claim %s does not name user %q", is.UsernameClaim, user)
	}
	for name, want := range is.RequiredClaims {
		if !claimEquals(claims[name], want) {
			return refuse("required_claim", "claim %s does not match", name)
		}
	}
	st.cache.put(cacheKey, std.Expiry.Time(), now)
	return nil
}

// claimEquals compares a decoded JSON claim with a value from access.yaml.
func claimEquals(got, want any) bool {
	switch w := want.(type) {
	case int:
		g, ok := got.(float64)
		return ok && g == float64(w)
	case float64:
		g, ok := got.(float64)
		return ok && g == w
	default:
		return got == want
	}
}

// Handler serves GET /verify for ClickHouse's http_authentication_servers
// (Basic credentials: user, token) and GET /healthz.
func (v *Verifier) Handler() http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("GET /verify", func(w http.ResponseWriter, r *http.Request) {
		user, token, ok := r.BasicAuth()
		if !ok {
			http.Error(w, "{}", http.StatusUnauthorized)
			return
		}
		if err := v.Verify(r.Context(), user, token); err != nil {
			code := "error"
			if ve := (*VerifyError)(nil); errors.As(err, &ve) {
				code = ve.Code
			}
			v.Log.Info("token login refused", zap.String("user", user), zap.String("code", code), zap.Error(err))
			http.Error(w, "{}", http.StatusUnauthorized)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte("{}"))
	})
	mux.HandleFunc("GET /healthz", func(w http.ResponseWriter, _ *http.Request) {
		_, _ = w.Write([]byte("ok"))
	})
	return mux
}

// tokenCache remembers verified (user, token) pairs until the token expires.
type tokenCache struct {
	mu      sync.Mutex
	entries map[[32]byte]time.Time
}

func (c *tokenCache) valid(key [32]byte, now time.Time) bool {
	c.mu.Lock()
	defer c.mu.Unlock()
	exp, ok := c.entries[key]
	if ok && !now.Before(exp) {
		delete(c.entries, key)
		return false
	}
	return ok
}

func (c *tokenCache) put(key [32]byte, exp, now time.Time) {
	if !now.Before(exp) {
		return
	}
	c.mu.Lock()
	defer c.mu.Unlock()
	if len(c.entries) >= maxCacheItems {
		for k, e := range c.entries {
			if !now.Before(e) {
				delete(c.entries, k)
			}
		}
		if len(c.entries) >= maxCacheItems {
			return
		}
	}
	c.entries[key] = exp
}
