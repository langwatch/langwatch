package access

import (
	"context"
	"crypto/sha256"
	"errors"
	"fmt"
	"net/http"
	"sort"
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

// Warm-up retries for an issuer whose keys could not be fetched at load.
const (
	warmRetryFirst = 5 * time.Second
	warmRetryMax   = 30 * time.Second
)

// Verifier decides token logins for the users of the current access file.
type Verifier struct {
	Now func() time.Time
	Log *zap.Logger

	state atomic.Pointer[verifierState]
	// retryFirst and retryMax override the warm-up backoff in tests.
	retryFirst, retryMax time.Duration
}

type verifierState struct {
	file  *File
	keys  map[string]*keySource // by issuer name
	cache *tokenCache
	// heldUntil refuses a user whose token binding changed until ClickHouse has
	// loaded the rights rendered for the new binding.
	heldUntil map[string]time.Time
}

// RebindHold outlasts ClickHouse's users.d reload (2 s by default) several times over.
const RebindHold = 30 * time.Second

// SetFile switches to a newly loaded access file. Verified tokens are
// forgotten, so a removed user or a changed subject takes effect at once.
// Call it only once the users file for f is written.
func (v *Verifier) SetFile(ctx context.Context, f *File) {
	old := v.state.Load()
	st := &verifierState{file: f, keys: map[string]*keySource{}, cache: &tokenCache{entries: map[[32]byte]time.Time{}},
		heldUntil: rebound(old, f, v.Now())}
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
	retry := backoff{next: orDuration(v.retryFirst, warmRetryFirst), max: orDuration(v.retryMax, warmRetryMax)}
	for name, ks := range st.keys {
		go v.warm(ctx, st, name, ks, v.Now, retry)
	}
}

// warm fetches an issuer's keys, retrying with backoff until it has them,
// ctx ends, or a newer SetFile replaces st. Without it, an issuer down at
// pod start keeps the pod unready: no login arrives to trigger a refetch.
func (v *Verifier) warm(ctx context.Context, st *verifierState, name string, ks *keySource, now func() time.Time, retry backoff) {
	for failed := false; ; failed = true {
		err := ks.warm(ctx, now())
		if err == nil {
			if failed {
				v.Log.Info("issuer keys fetched", zap.String("issuer", name))
			}
			return
		}
		wait := retry.step()
		v.Log.Warn("issuer keys not fetched yet, retrying", zap.String("issuer", name), zap.Duration("retry_in", wait), zap.Error(err))
		select {
		case <-ctx.Done():
			return
		case <-time.After(wait):
		}
		if v.state.Load() != st {
			return
		}
	}
}

// backoff doubles from next up to max.
type backoff struct{ next, max time.Duration }

func (b *backoff) step() time.Duration {
	d := b.next
	b.next = min(2*b.next, b.max)
	return d
}

func orDuration(a, b time.Duration) time.Duration {
	if a > 0 {
		return a
	}
	return b
}

// rebound holds every token user whose binding differs from the previous file's,
// and keeps holds that have not yet run out.
func rebound(old *verifierState, f *File, now time.Time) map[string]time.Time {
	held := map[string]time.Time{}
	if old == nil {
		return held
	}
	for name, until := range old.heldUntil {
		if now.Before(until) {
			held[name] = until
		}
	}
	for _, u := range f.Users {
		prev, ok := old.file.User(u.Name)
		if ok && prev.Login.Token != nil && tokenBinding(old.file, *prev) != tokenBinding(f, u) {
			held[u.Name] = now.Add(RebindHold)
		}
	}
	return held
}

// tokenBinding is everything that decides which tokens may log in as u.
func tokenBinding(f *File, u User) string {
	if u.Login.Token == nil {
		return ""
	}
	is, _ := f.Issuer(u.Login.Token.Issuer)
	return fmt.Sprintf("%s|%s|%s|%s|%s|%s|%v", u.Login.Token.Subject, is.Name, is.URL, is.JWKSURL,
		is.Audience, is.UsernameClaim, is.RequiredClaims)
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
	now := v.Now()
	if until, held := st.heldUntil[user]; held && now.Before(until) {
		return refuse("rebinding", "%q changed its token binding; logins resume at %s", user, until.UTC().Format(time.RFC3339))
	}
	if len(token) > MaxTokenBytes {
		return refuse("too_large", "token of %d bytes exceeds %d", len(token), MaxTokenBytes)
	}
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
	// No leeway on exp: a token stops working the moment it expires, here
	// and in the cache. Leeway covers nbf and iat only.
	if !now.Before(std.Expiry.Time()) {
		return refuse("expired", "token expired at %s", std.Expiry.Time().UTC().Format(time.RFC3339))
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
	mux.HandleFunc("GET /readyz", func(w http.ResponseWriter, _ *http.Request) {
		if err := v.Ready(); err != nil {
			http.Error(w, err.Error(), http.StatusServiceUnavailable)
			return
		}
		_, _ = w.Write([]byte("ok"))
	})
	return mux
}

// Ready reports whether the verifier can decide token logins: an access file
// is loaded and every issuer's keys have been fetched at least once. Keys
// already fetched are kept when a refresh fails, so a pod that was ready
// stays ready while an issuer is briefly unreachable.
func (v *Verifier) Ready() error {
	st := v.state.Load()
	if st == nil {
		return errors.New("no access file loaded")
	}
	var missing []string
	for name, ks := range st.keys {
		if !ks.hasKeys() {
			missing = append(missing, name)
		}
	}
	if len(missing) > 0 {
		sort.Strings(missing)
		return fmt.Errorf("no keys fetched yet from issuers %v", missing)
	}
	return nil
}

// tokenCache remembers verified (user, token) pairs until the token expires.
type tokenCache struct {
	mu      sync.Mutex
	entries map[[32]byte]time.Time
	max     int // maxCacheItems when 0
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
	if len(c.entries) >= c.limit() {
		// Expired entries go first; if none has, the one expiring soonest.
		var soonest [32]byte
		var soonestExp time.Time
		for k, e := range c.entries {
			if !now.Before(e) {
				delete(c.entries, k)
			} else if soonestExp.IsZero() || e.Before(soonestExp) {
				soonest, soonestExp = k, e
			}
		}
		if len(c.entries) >= c.limit() {
			delete(c.entries, soonest)
		}
	}
	c.entries[key] = exp
}

func (c *tokenCache) limit() int {
	if c.max > 0 {
		return c.max
	}
	return maxCacheItems
}
