package providers

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"net"
	"net/http"
	"sort"
	"sync"
	"syscall"
	"time"

	"go.uber.org/zap"

	"github.com/langwatch/langwatch/services/aigateway/domain"
)

// modelsDiscoveryTimeout bounds a single /v1/models probe. Short on
// purpose: this feeds an interactive model-picker list, and a slow
// endpoint must not hold the response hostage — it just gets skipped
// this round.
const modelsDiscoveryTimeout = 5 * time.Second

// modelsDiscoveryConcurrency bounds how many /v1/models probes run at
// once per ListModels call. Fan-out is otherwise one goroutine + one
// outbound connection per credential with a base URL — uncapped, a
// bundle with many self-hosted endpoints (or a client polling this
// endpoint) can pile up unbounded concurrent 5s requests and starve
// normal dispatch. A small cap keeps discovery cheap without making
// wide bundles pay for it serially.
const modelsDiscoveryConcurrency = 8

// modelsDiscoveryTTL is how long a discovered catalog stays fresh.
// GET /v1/models sits outside the dispatch interceptor chain, so the
// per-VK rate limiter never sees it: without a cache one cheap inbound
// request fans out to every configured endpoint, and a client polling
// the model picker (OpenWebUI refreshes on every page load) turns into
// sustained outbound load on the customer's own servers. The TTL
// matches the auth cache's default ConfigTTL so a credential change
// takes effect on the model list about as fast as it does on dispatch.
const modelsDiscoveryTTL = 60 * time.Second

// modelsDiscoveryEmptyTTL is how long an empty catalog stays fresh. Short,
// because "no models" is far more often a transient upstream failure than
// an answer, and caching it for a full minute blanks the model list for
// every caller on that credential chain.
const modelsDiscoveryEmptyTTL = 5 * time.Second

// modelsDiscoveryProbeCeiling bounds one whole round of discovery. Each
// probe is already capped by the client's own timeout; this guards the
// pathological case of a bundle wide enough to need many batches through
// the concurrency semaphore. The round runs detached from the caller that
// happened to miss the cache, so a client hanging up mid-probe cannot
// abort the fetch that every other waiter is blocked on.
const modelsDiscoveryProbeCeiling = 30 * time.Second

// modelsDiscoveryCacheMaxEntries bounds the cache so a gateway serving
// many distinct credential chains cannot grow it without limit. Entries
// are small (a slice of model IDs) and expired ones are purged first.
const modelsDiscoveryCacheMaxEntries = 1024

// modelsDiscoveryMaxResponseBytes caps how much of an upstream /v1/models
// response discovery will read. The endpoint policy checks where the
// request is allowed to go, not whether the response is trustworthy — a
// misbehaving or compromised upstream could otherwise stream an
// arbitrarily large JSON array and let any virtual-key holder use this
// probe to run the gateway out of memory.
const modelsDiscoveryMaxResponseBytes = 1 << 20 // 1MiB

// modelsDiscoveryMaxModelIDs caps how many model IDs a single endpoint's
// response contributes, independent of the byte cap — a response that
// stays under the byte limit by using short, repeated IDs should still
// not be allowed to grow the result set without bound.
const modelsDiscoveryMaxModelIDs = 2000

// newModelsDiscoveryClient builds the HTTP client discovery probes use.
//
// It is deliberately stricter than a default client on two fronts that
// the pre-flight validateCustomerEndpoint check cannot cover:
//
//   - Redirects are never followed. validateCustomerEndpoint vets the
//     configured base URL, not wherever that URL points next; a 302 to
//     169.254.169.254 or to an internal service would otherwise be
//     followed with the credential's x-api-key attached (Go only strips
//     Authorization across hosts, not custom headers). A /v1/models
//     endpoint that redirects is treated as a failed probe.
//   - Every resolved address is re-checked against the same endpoint
//     policy immediately before connect. The pre-flight check resolves
//     the host itself, so a name that answers with a public address then
//     a private one (DNS rebinding) would otherwise slip past it.
func newModelsDiscoveryClient(policy customerEndpointPolicy) *http.Client {
	dialer := &net.Dialer{
		Timeout:   modelsDiscoveryTimeout,
		KeepAlive: 30 * time.Second,
		ControlContext: func(_ context.Context, _, address string, _ syscall.RawConn) error {
			return policy.allowsDialAddress(address)
		},
	}
	return &http.Client{
		Timeout:   modelsDiscoveryTimeout,
		Transport: &http.Transport{DialContext: dialer.DialContext},
		CheckRedirect: func(*http.Request, []*http.Request) error {
			return http.ErrUseLastResponse
		},
	}
}

// allowsDialAddress applies the endpoint policy to a resolved
// "host:port" the dialer is about to connect to. Host allowlisting is
// intentionally not consulted here: the allowlist names hosts, and by
// this point the name is gone. The pre-flight check is where an
// allowlisted host earns its exemption.
func (p customerEndpointPolicy) allowsDialAddress(address string) error {
	host, _, err := net.SplitHostPort(address)
	if err != nil {
		return fmt.Errorf("customer endpoint address is not host:port")
	}
	ip := net.ParseIP(host)
	if ip == nil {
		return fmt.Errorf("customer endpoint did not resolve to an IP address")
	}
	// Same classifier the pre-flight check runs, so a dial cannot reach an
	// address the URL check would have refused. Not allowlisted: the
	// allowlist names hosts, and by this point the name is gone.
	return endpointAddressError(ip, p.blockLocal, false)
}

// modelsDiscoveryCache memoises discovered catalogs per credential chain
// and collapses concurrent misses onto a single probe, so a burst of
// GET /v1/models calls costs one round of upstream requests rather than
// one round per call.
type modelsDiscoveryCache struct {
	mu      sync.Mutex
	entries map[string]*modelsDiscoveryEntry
}

type modelsDiscoveryEntry struct {
	// done closes once models is populated. Waiters block on it, which
	// is what collapses a concurrent burst onto one probe.
	done      chan struct{}
	models    []domain.Model
	expiresAt time.Time
}

func (e *modelsDiscoveryEntry) fresh(now time.Time) bool {
	select {
	case <-e.done:
		return now.Before(e.expiresAt)
	default:
		// Still in flight: a waiter gets the result being fetched.
		return true
	}
}

// get returns the cached catalog for key, computing it with fetch on a
// miss. Concurrent callers for the same key share one fetch.
func (c *modelsDiscoveryCache) get(ctx context.Context, key string, fetch func() []domain.Model) ([]domain.Model, error) {
	now := time.Now()

	c.mu.Lock()
	if c.entries == nil {
		c.entries = make(map[string]*modelsDiscoveryEntry)
	}
	if existing, ok := c.entries[key]; ok && existing.fresh(now) {
		c.mu.Unlock()
		select {
		case <-existing.done:
			return existing.models, nil
		case <-ctx.Done():
			return nil, ctx.Err()
		}
	}
	entry := &modelsDiscoveryEntry{done: make(chan struct{})}
	c.evictLocked(now)
	c.entries[key] = entry
	c.mu.Unlock()

	// An entry nobody ever completes would block every later caller for
	// this key until their context expires, so the close has to happen
	// even when fetch panics, and a panicking entry is dropped so the
	// next caller retries instead of reading a result that never arrived.
	completed := false
	defer func() {
		if !completed {
			c.mu.Lock()
			if c.entries[key] == entry {
				delete(c.entries, key)
			}
			c.mu.Unlock()
		}
		close(entry.done)
	}()

	entry.models = fetch()
	// An empty catalog is usually a transient upstream failure rather than
	// a real answer (every endpoint down, or the probe cut short), and
	// holding it for the full TTL blanks the model list for everyone on
	// this credential chain for a minute. Let it expire quickly so the
	// next caller retries. A bundle with genuinely nothing to discover
	// re-probes nothing: with no base URLs there is no request to make.
	ttl := modelsDiscoveryTTL
	if len(entry.models) == 0 {
		ttl = modelsDiscoveryEmptyTTL
	}
	entry.expiresAt = time.Now().Add(ttl)
	completed = true
	return entry.models, nil
}

// evictLocked keeps the cache bounded: expired entries go first, and if
// that is not enough the oldest completed entries are dropped. In-flight
// entries are never dropped: a waiter is blocked on them.
func (c *modelsDiscoveryCache) evictLocked(now time.Time) {
	if len(c.entries) < modelsDiscoveryCacheMaxEntries {
		return
	}
	type aged struct {
		key       string
		expiresAt time.Time
	}
	var completed []aged
	for key, entry := range c.entries {
		select {
		case <-entry.done:
		default:
			continue
		}
		if now.After(entry.expiresAt) {
			delete(c.entries, key)
			continue
		}
		completed = append(completed, aged{key: key, expiresAt: entry.expiresAt})
	}
	if len(c.entries) < modelsDiscoveryCacheMaxEntries {
		return
	}
	sort.Slice(completed, func(i, j int) bool { return completed[i].expiresAt.Before(completed[j].expiresAt) })
	for _, a := range completed {
		if len(c.entries) < modelsDiscoveryCacheMaxEntries {
			return
		}
		delete(c.entries, a.key)
	}
}

// modelsDiscoveryCacheKey identifies a credential chain by everything
// that changes what discovery would return or how it authenticates. The
// API key is included so a rotated key invalidates the entry rather than
// serving a catalog fetched with the old one; it is hashed with the rest
// into an opaque key that is only ever compared, never logged.
func modelsDiscoveryCacheKey(creds []domain.Credential) string {
	sum := sha256.New()
	for _, cred := range creds {
		for _, field := range []string{
			cred.ID,
			string(cred.ProviderID),
			credBaseURL(cred),
			cred.APIKey,
		} {
			_, _ = sum.Write([]byte(field))
			_, _ = sum.Write([]byte{0x1f})
		}
		_, _ = sum.Write([]byte{0x1e})
	}
	return hex.EncodeToString(sum.Sum(nil))
}

// ListModels discovers models from credentials that carry a base URL
// (self-hosted vLLM / LiteLLM / Anthropic-compatible servers — all serve
// the OpenAI-shape GET /v1/models). Hosted credentials without a base URL
// have no catalog to query and are skipped. A failing endpoint is skipped
// too: one dead server must not blank out the whole list.
func (r *BifrostRouter) ListModels(ctx context.Context, creds []domain.Credential) ([]domain.Model, error) {
	return r.discoveryCache().get(ctx, modelsDiscoveryCacheKey(creds), func() []domain.Model {
		// Detached from the calling request: whoever misses the cache runs
		// the probe on behalf of every concurrent waiter, so their client
		// hanging up must not cancel it out from under the others (and
		// cache the resulting empty catalog). Values still ride along, only
		// the cancellation is dropped.
		probeCtx, cancel := context.WithTimeout(
			context.WithoutCancel(ctx), modelsDiscoveryProbeCeiling)
		defer cancel()
		return r.discoverModels(probeCtx, creds)
	})
}

func (r *BifrostRouter) discoveryCache() *modelsDiscoveryCache {
	r.discoveryOnce.Do(func() {
		r.discoveryModels = &modelsDiscoveryCache{}
		r.discoveryHTTP = newModelsDiscoveryClient(r.endpointPolicy)
	})
	return r.discoveryModels
}

func (r *BifrostRouter) discoverModels(ctx context.Context, creds []domain.Credential) []domain.Model {
	// Query endpoints concurrently, bounded by a semaphore: latency is
	// max(endpoint) up to the cap, not sum(endpoint) — one slow or dead
	// server must not stack its timeout onto the others, and no single
	// bundle can spawn unbounded outbound requests. Results keep
	// credential order for determinism.
	perCred := make([][]string, len(creds))
	sem := make(chan struct{}, modelsDiscoveryConcurrency)
	var wg sync.WaitGroup
	for i, cred := range creds {
		base := normalizeOpenAICompatBaseURL(credBaseURL(cred))
		if base == "" {
			continue
		}
		wg.Add(1)
		go func(i int, cred domain.Credential, base string) {
			defer wg.Done()
			sem <- struct{}{}
			defer func() { <-sem }()

			// Same customer-endpoint policy Dispatch applies before using
			// base_url (local-address blocking, HTTPS requirement, host
			// allowlist) — discovery contacts the same customer-controlled
			// URL and carries the credential's key, so it must not reach
			// endpoints normal traffic would reject.
			if err := r.validateCredentialEndpoints(ctx, cred); err != nil {
				if r.logger != nil {
					r.logger.Warn("model discovery blocked by endpoint policy, skipping",
						zap.String("credential_id", cred.ID), zap.Error(err))
				}
				return
			}
			ids, err := fetchUpstreamModels(ctx, r.discoveryHTTP, base, cred.APIKey)
			if err != nil {
				if r.logger != nil {
					r.logger.Warn("model discovery failed for endpoint, skipping",
						zap.String("credential_id", cred.ID), zap.Error(err))
				}
				return
			}
			perCred[i] = ids
		}(i, cred, base)
	}
	wg.Wait()

	var out []domain.Model
	seen := make(map[string]bool)
	for i, ids := range perCred {
		for _, id := range ids {
			if id == "" || seen[id] {
				continue
			}
			seen[id] = true
			out = append(out, domain.Model{ID: id, Name: id, ProviderID: creds[i].ProviderID})
		}
	}
	return out
}

// fetchUpstreamModels GETs an endpoint's OpenAI-shape model list.
func fetchUpstreamModels(ctx context.Context, client *http.Client, baseURL, apiKey string) ([]string, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, baseURL+"/v1/models", nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("Accept", "application/json")
	if apiKey != "" {
		// Both header conventions: OpenAI-compatible servers (vLLM,
		// LiteLLM) read the bearer token, Anthropic-style servers read
		// x-api-key. Sending both means neither kind rejects the probe.
		req.Header.Set("Authorization", "Bearer "+apiKey)
		req.Header.Set("x-api-key", apiKey)
	}
	resp, err := client.Do(req)
	if err != nil {
		return nil, err
	}
	defer func() { _ = resp.Body.Close() }()
	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("upstream /v1/models returned status %d", resp.StatusCode)
	}
	var parsed struct {
		Data []struct {
			ID string `json:"id"`
		} `json:"data"`
	}
	limited := http.MaxBytesReader(nil, resp.Body, modelsDiscoveryMaxResponseBytes)
	if err := json.NewDecoder(limited).Decode(&parsed); err != nil {
		return nil, err
	}
	if len(parsed.Data) > modelsDiscoveryMaxModelIDs {
		parsed.Data = parsed.Data[:modelsDiscoveryMaxModelIDs]
	}
	ids := make([]string, 0, len(parsed.Data))
	for _, m := range parsed.Data {
		ids = append(ids, m.ID)
	}
	return ids, nil
}
