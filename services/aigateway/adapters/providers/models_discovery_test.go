package providers

import (
	"context"
	"net"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/langwatch/langwatch/services/aigateway/domain"
)

// @scenario "GET /v1/models discovers models from self-hosted endpoints"
// Credentials with a base URL are asked for their OpenAI-shape /v1/models
// list (vLLM, LiteLLM, and Anthropic-compatible servers all serve it);
// credentials without one are skipped — there is no catalog to query.
// Spec: specs/ai-gateway/provider-routing.feature
func TestListModels_QueriesBaseURLCredentials(t *testing.T) {
	var captured struct {
		path string
		auth string
	}
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		captured.path = r.URL.Path
		captured.auth = r.Header.Get("Authorization")
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"object":"list","data":[{"id":"qwen3-14b","object":"model"},{"id":"bge-m3","object":"model"}]}`))
	}))
	defer srv.Close()

	router := &BifrostRouter{}
	models, err := router.ListModels(context.Background(), []domain.Credential{
		// Conventional "/v1" suffix must not produce ".../v1/v1/models".
		{ID: "mp-1", ProviderID: domain.ProviderAnthropic, APIKey: "sk-local", Extra: map[string]string{"base_url": srv.URL + "/v1"}},
		{ID: "mp-2", ProviderID: domain.ProviderOpenAI, APIKey: "sk-hosted"}, // no base URL — skipped
	})
	if err != nil {
		t.Fatalf("ListModels returned error: %v", err)
	}

	if captured.path != "/v1/models" {
		t.Fatalf("upstream path = %q, want /v1/models", captured.path)
	}
	if captured.auth != "Bearer sk-local" {
		t.Fatalf("Authorization = %q, want the credential's key as bearer", captured.auth)
	}
	ids := make([]string, 0, len(models))
	for _, m := range models {
		ids = append(ids, m.ID)
		if m.ProviderID != domain.ProviderAnthropic {
			t.Fatalf("model %q attributed to %q, want the discovering credential's provider", m.ID, m.ProviderID)
		}
	}
	if len(ids) != 2 || ids[0] != "qwen3-14b" || ids[1] != "bge-m3" {
		t.Fatalf("models = %v, want [qwen3-14b bge-m3]", ids)
	}
}

// A server that fails to answer is skipped without failing the request —
// one dead endpoint must not blank out the whole model list.
// Spec: specs/ai-gateway/provider-routing.feature
func TestListModels_SkipsFailingEndpoint(t *testing.T) {
	dead := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusInternalServerError)
	}))
	defer dead.Close()
	alive := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		_, _ = w.Write([]byte(`{"data":[{"id":"qwen3-14b"}]}`))
	}))
	defer alive.Close()

	router := &BifrostRouter{}
	models, err := router.ListModels(context.Background(), []domain.Credential{
		{ID: "mp-dead", ProviderID: domain.ProviderCustom, Extra: map[string]string{"base_url": dead.URL}},
		{ID: "mp-alive", ProviderID: domain.ProviderCustom, Extra: map[string]string{"base_url": alive.URL}},
	})
	if err != nil {
		t.Fatalf("ListModels returned error: %v", err)
	}
	if len(models) != 1 || models[0].ID != "qwen3-14b" {
		t.Fatalf("models = %v, want only the live endpoint's model", models)
	}
}

// Unauthenticated self-hosted servers get no Authorization header, and the
// same model served by two endpoints appears once.
func TestListModels_NoAuthHeaderWhenKeyEmptyAndDedupes(t *testing.T) {
	var sawAuth bool
	handler := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("Authorization") != "" {
			sawAuth = true
		}
		_, _ = w.Write([]byte(`{"data":[{"id":"qwen3-14b"}]}`))
	})
	srv1 := httptest.NewServer(handler)
	defer srv1.Close()
	srv2 := httptest.NewServer(handler)
	defer srv2.Close()

	router := &BifrostRouter{}
	models, err := router.ListModels(context.Background(), []domain.Credential{
		{ID: "mp-1", ProviderID: domain.ProviderCustom, Extra: map[string]string{"base_url": srv1.URL}},
		{ID: "mp-2", ProviderID: domain.ProviderCustom, Extra: map[string]string{"api_base": srv2.URL}},
	})
	if err != nil {
		t.Fatalf("ListModels returned error: %v", err)
	}
	if sawAuth {
		t.Fatal("Authorization header sent for an empty API key")
	}
	if len(models) != 1 {
		t.Fatalf("models = %v, want the shared model deduped to one entry", models)
	}
}

// REPRO bug 1: discovery is serial — dead/slow endpoints stack their
// latency. Three 400ms endpoints must be queried concurrently (~400ms
// total), not serially (~1.2s).
func TestListModels_QueriesEndpointsConcurrently(t *testing.T) {
	slow := func() *httptest.Server {
		return httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
			time.Sleep(400 * time.Millisecond)
			_, _ = w.Write([]byte(`{"data":[{"id":"m"}]}`))
		}))
	}
	s1, s2, s3 := slow(), slow(), slow()
	defer s1.Close()
	defer s2.Close()
	defer s3.Close()

	router := &BifrostRouter{}
	start := time.Now()
	_, err := router.ListModels(context.Background(), []domain.Credential{
		{ID: "mp-1", ProviderID: domain.ProviderCustom, Extra: map[string]string{"base_url": s1.URL}},
		{ID: "mp-2", ProviderID: domain.ProviderCustom, Extra: map[string]string{"base_url": s2.URL}},
		{ID: "mp-3", ProviderID: domain.ProviderCustom, Extra: map[string]string{"base_url": s3.URL}},
	})
	elapsed := time.Since(start)
	if err != nil {
		t.Fatalf("ListModels returned error: %v", err)
	}
	if elapsed > 900*time.Millisecond {
		t.Fatalf("discovery took %v — endpoints are queried serially, not concurrently", elapsed)
	}
}

// REPRO bug 3: only Authorization: Bearer is sent. An Anthropic-style
// server that requires x-api-key rejects the probe and its models
// silently vanish from the list.
func TestListModels_SendsXAPIKeyForAnthropicStyleServers(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("x-api-key") == "" {
			w.WriteHeader(http.StatusUnauthorized)
			return
		}
		_, _ = w.Write([]byte(`{"data":[{"id":"qwen3-14b"}]}`))
	}))
	defer srv.Close()

	router := &BifrostRouter{}
	models, err := router.ListModels(context.Background(), []domain.Credential{
		{ID: "mp-1", ProviderID: domain.ProviderAnthropic, APIKey: "sk-local", Extra: map[string]string{"base_url": srv.URL}},
	})
	if err != nil {
		t.Fatalf("ListModels returned error: %v", err)
	}
	if len(models) != 1 {
		t.Fatalf("models = %v — x-api-key header not sent, server rejected the probe", models)
	}
}

// Fan-out is bounded: more base-URL credentials than
// modelsDiscoveryConcurrency must not all dial at once. With N slow
// endpoints and a cap of C, elapsed time is at least
// ceil(N/C) * requestDuration — a single unbounded batch would instead
// finish in ~requestDuration regardless of N.
func TestListModels_BoundsFanOutConcurrency(t *testing.T) {
	var mu sync.Mutex
	inFlight, peak := 0, 0
	n := modelsDiscoveryConcurrency + 4
	creds := make([]domain.Credential, 0, n)
	for i := 0; i < n; i++ {
		srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
			mu.Lock()
			inFlight++
			if inFlight > peak {
				peak = inFlight
			}
			mu.Unlock()

			time.Sleep(100 * time.Millisecond)

			mu.Lock()
			inFlight--
			mu.Unlock()
			_, _ = w.Write([]byte(`{"data":[{"id":"m"}]}`))
		}))
		t.Cleanup(srv.Close)
		creds = append(creds, domain.Credential{
			ID: srv.URL, ProviderID: domain.ProviderCustom, Extra: map[string]string{"base_url": srv.URL},
		})
	}

	router := &BifrostRouter{}
	_, err := router.ListModels(context.Background(), creds)
	if err != nil {
		t.Fatalf("ListModels returned error: %v", err)
	}

	mu.Lock()
	defer mu.Unlock()
	if peak > modelsDiscoveryConcurrency {
		t.Fatalf("peak concurrent requests = %d, want <= %d (modelsDiscoveryConcurrency)", peak, modelsDiscoveryConcurrency)
	}
}

// An oversized upstream response must not be fully buffered into memory —
// the endpoint policy validates where the request is allowed to go, not
// whether the response can be trusted, so a misbehaving upstream must be
// treated as a skipped endpoint rather than an OOM risk.
func TestListModels_RejectsOversizedResponse(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"data":[`))
		entry := `{"id":"` + strings.Repeat("x", 1024) + `"},`
		for i := 0; i < modelsDiscoveryMaxResponseBytes/len(entry)+10; i++ {
			_, _ = w.Write([]byte(entry))
		}
		_, _ = w.Write([]byte(`{"id":"z"}]}`))
	}))
	defer srv.Close()

	router := &BifrostRouter{}
	models, err := router.ListModels(context.Background(), []domain.Credential{
		{ID: "mp-huge", ProviderID: domain.ProviderCustom, Extra: map[string]string{"base_url": srv.URL}},
	})
	if err != nil {
		t.Fatalf("ListModels returned error: %v", err)
	}
	if len(models) != 0 {
		t.Fatalf("models = %v, want an oversized response to be skipped entirely, not partially decoded", models)
	}
}

// @scenario "GET /v1/models does not follow redirects away from the configured endpoint"
// The endpoint policy vets the configured base URL, not wherever that
// URL points next. A discovery endpoint that answers 302 must be treated
// as a failed probe: following it would reach an address the policy never
// saw, with the credential's x-api-key attached (Go only strips
// Authorization across hosts, not custom headers).
// Spec: specs/ai-gateway/provider-routing.feature
func TestListModels_DoesNotFollowRedirects(t *testing.T) {
	var redirectTargetHit atomic.Bool
	target := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		redirectTargetHit.Store(true)
		_, _ = w.Write([]byte(`{"data":[{"id":"internal-only"}]}`))
	}))
	defer target.Close()

	entry := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		http.Redirect(w, &http.Request{}, target.URL+"/v1/models", http.StatusFound)
	}))
	defer entry.Close()

	router := &BifrostRouter{}
	models, err := router.ListModels(context.Background(), []domain.Credential{
		{ID: "mp-redirect", ProviderID: domain.ProviderCustom, APIKey: "sk-secret", Extra: map[string]string{"base_url": entry.URL}},
	})
	if err != nil {
		t.Fatalf("ListModels returned error: %v", err)
	}
	if redirectTargetHit.Load() {
		t.Fatal("discovery followed a redirect to an address the endpoint policy never validated")
	}
	if len(models) != 0 {
		t.Fatalf("models = %v, want a redirecting endpoint treated as a failed probe", models)
	}
}

// @scenario "GET /v1/models re-checks the resolved address before connecting"
// The pre-flight policy check resolves the host itself, so a name that
// answers with a public address on that lookup and a private one when the
// connection is made (DNS rebinding) would slip past it. Every resolved
// address must be re-checked immediately before connect.
// Spec: specs/ai-gateway/provider-routing.feature
func TestListModels_RejectsRebindingToLocalAddress(t *testing.T) {
	var hit atomic.Bool
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		hit.Store(true)
		_, _ = w.Write([]byte(`{"data":[{"id":"internal-only"}]}`))
	}))
	defer srv.Close()

	// "localhost" really resolves to loopback, but the pre-flight check
	// uses the policy's resolver, stubbed here to answer with a public
	// address, which is exactly what a rebinding host does on the first
	// lookup.
	policy := newCustomerEndpointPolicy(true, false, nil)
	policy.resolve = func(context.Context, string) ([]net.IP, error) {
		return []net.IP{net.ParseIP("93.184.216.34")}, nil
	}

	_, port, err := net.SplitHostPort(strings.TrimPrefix(srv.URL, "http://"))
	if err != nil {
		t.Fatalf("parsing test server address: %v", err)
	}

	router := &BifrostRouter{endpointPolicy: policy}
	models, err := router.ListModels(context.Background(), []domain.Credential{
		{ID: "mp-rebind", ProviderID: domain.ProviderCustom, Extra: map[string]string{"base_url": "http://localhost:" + port}},
	})
	if err != nil {
		t.Fatalf("ListModels returned error: %v", err)
	}
	if hit.Load() {
		t.Fatal("discovery connected to a loopback address that passed the pre-flight check by rebinding")
	}
	if len(models) != 0 {
		t.Fatalf("models = %v, want none from a rebound endpoint", models)
	}
}

// GET /v1/models is outside the dispatch interceptor chain, so the per-VK
// rate limiter never sees it. Without a cache every call fans out to every
// configured endpoint, and a polling model picker becomes sustained load on
// the customer's own servers.
func TestListModels_CachesDiscoveryBetweenCalls(t *testing.T) {
	var mu sync.Mutex
	probes := 0
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		mu.Lock()
		probes++
		mu.Unlock()
		_, _ = w.Write([]byte(`{"data":[{"id":"qwen3-14b"}]}`))
	}))
	defer srv.Close()

	creds := []domain.Credential{
		{ID: "mp-1", ProviderID: domain.ProviderCustom, Extra: map[string]string{"base_url": srv.URL}},
	}
	router := &BifrostRouter{}
	for i := 0; i < 5; i++ {
		models, err := router.ListModels(context.Background(), creds)
		if err != nil {
			t.Fatalf("ListModels returned error: %v", err)
		}
		if len(models) != 1 || models[0].ID != "qwen3-14b" {
			t.Fatalf("call %d: models = %v, want the cached catalog", i, models)
		}
	}

	mu.Lock()
	defer mu.Unlock()
	if probes != 1 {
		t.Fatalf("upstream probed %d times across 5 calls, want 1; discovery is not cached", probes)
	}
}

// A rotated API key must not keep serving a catalog fetched with the old
// one, so the cache key covers everything that changes what discovery
// would return or how it authenticates.
func TestListModels_CacheKeyedByCredentialChain(t *testing.T) {
	var mu sync.Mutex
	probes := 0
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		mu.Lock()
		probes++
		mu.Unlock()
		_, _ = w.Write([]byte(`{"data":[{"id":"qwen3-14b"}]}`))
	}))
	defer srv.Close()

	router := &BifrostRouter{}
	for _, key := range []string{"sk-old", "sk-rotated"} {
		if _, err := router.ListModels(context.Background(), []domain.Credential{
			{ID: "mp-1", ProviderID: domain.ProviderCustom, APIKey: key, Extra: map[string]string{"base_url": srv.URL}},
		}); err != nil {
			t.Fatalf("ListModels returned error: %v", err)
		}
	}

	mu.Lock()
	defer mu.Unlock()
	if probes != 2 {
		t.Fatalf("upstream probed %d times, want 2; a rotated key must not hit the previous key's cache entry", probes)
	}
}

// A burst of concurrent model-list calls must collapse onto one round of
// probes. Without in-flight deduplication, N callers arriving before the
// first result lands each fan out on their own.
func TestListModels_CollapsesConcurrentDiscovery(t *testing.T) {
	var mu sync.Mutex
	probes := 0
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		mu.Lock()
		probes++
		mu.Unlock()
		time.Sleep(150 * time.Millisecond)
		_, _ = w.Write([]byte(`{"data":[{"id":"qwen3-14b"}]}`))
	}))
	defer srv.Close()

	creds := []domain.Credential{
		{ID: "mp-1", ProviderID: domain.ProviderCustom, Extra: map[string]string{"base_url": srv.URL}},
	}
	router := &BifrostRouter{}
	var wg sync.WaitGroup
	for i := 0; i < 20; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			models, err := router.ListModels(context.Background(), creds)
			if err != nil {
				t.Errorf("ListModels returned error: %v", err)
				return
			}
			if len(models) != 1 {
				t.Errorf("models = %v, want the shared catalog", models)
			}
		}()
	}
	wg.Wait()

	mu.Lock()
	defer mu.Unlock()
	if probes != 1 {
		t.Fatalf("upstream probed %d times for 20 concurrent calls, want 1", probes)
	}
}

// Whoever misses the cache probes on behalf of every concurrent waiter,
// so their client hanging up must not abort the fetch the others are
// blocked on, nor cache the empty catalog that abort would produce.
func TestListModels_ProbeSurvivesCallerCancellation(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		time.Sleep(200 * time.Millisecond)
		_, _ = w.Write([]byte(`{"data":[{"id":"qwen3-14b"}]}`))
	}))
	defer srv.Close()

	ctx, cancel := context.WithCancel(context.Background())
	go func() {
		time.Sleep(50 * time.Millisecond)
		cancel()
	}()

	router := &BifrostRouter{}
	models, err := router.ListModels(ctx, []domain.Credential{
		{ID: "mp-1", ProviderID: domain.ProviderCustom, Extra: map[string]string{"base_url": srv.URL}},
	})
	if err != nil {
		t.Fatalf("ListModels returned error: %v", err)
	}
	if len(models) != 1 || models[0].ID != "qwen3-14b" {
		t.Fatalf("models = %v, want the probe to finish despite the caller canceling", models)
	}
}

// An empty catalog is usually a transient upstream failure, so it must not
// hold the full TTL and blank the model list for a minute.
func TestModelsDiscoveryCache_ExpiresEmptyResultsQuickly(t *testing.T) {
	cache := &modelsDiscoveryCache{}

	before := time.Now()
	if _, err := cache.get(context.Background(), "empty", func() []domain.Model { return nil }); err != nil {
		t.Fatalf("get returned error: %v", err)
	}
	if _, err := cache.get(context.Background(), "full", func() []domain.Model {
		return []domain.Model{{ID: "qwen3-14b"}}
	}); err != nil {
		t.Fatalf("get returned error: %v", err)
	}

	// The entries stamp their own time.Now(), so compare against the
	// window the calls ran in rather than a single instant.
	elapsed := time.Since(before)
	emptyTTL := cache.entries["empty"].expiresAt.Sub(before)
	fullTTL := cache.entries["full"].expiresAt.Sub(before)
	if emptyTTL > modelsDiscoveryEmptyTTL+elapsed {
		t.Fatalf("empty catalog cached for %v, want at most %v", emptyTTL, modelsDiscoveryEmptyTTL)
	}
	if fullTTL < modelsDiscoveryTTL {
		t.Fatalf("populated catalog cached for %v, want the full %v", fullTTL, modelsDiscoveryTTL)
	}
}

// A cache entry nobody completes would block every later caller for that
// key until their context expires. A panicking discovery must release its
// waiters and drop the entry so the next call retries.
func TestModelsDiscoveryCache_RecoversFromPanickingFetch(t *testing.T) {
	cache := &modelsDiscoveryCache{}

	func() {
		defer func() {
			if recover() == nil {
				t.Error("panic did not propagate to the caller")
			}
		}()
		_, _ = cache.get(context.Background(), "key", func() []domain.Model {
			panic("discovery blew up")
		})
	}()

	done := make(chan []domain.Model, 1)
	go func() {
		models, err := cache.get(context.Background(), "key", func() []domain.Model {
			return []domain.Model{{ID: "qwen3-14b"}}
		})
		if err != nil {
			t.Errorf("second call returned error: %v", err)
		}
		done <- models
	}()

	select {
	case models := <-done:
		if len(models) != 1 || models[0].ID != "qwen3-14b" {
			t.Fatalf("models = %v, want the retried catalog", models)
		}
	case <-time.After(2 * time.Second):
		t.Fatal("a later call blocked on an entry the panicking fetch never completed")
	}
}

// Discovery must honor the same customer-endpoint policy Dispatch applies:
// a base URL that BlockLocalHTTPCalls would reject at dispatch time must
// not be contacted by the model probe either (SSRF + key exfiltration).
func TestListModels_HonorsCustomerEndpointPolicy(t *testing.T) {
	var hit atomic.Bool
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		hit.Store(true)
		_, _ = w.Write([]byte(`{"data":[{"id":"m"}]}`))
	}))
	defer srv.Close()

	router := &BifrostRouter{
		endpointPolicy: newCustomerEndpointPolicy(true, false, nil),
	}
	models, err := router.ListModels(context.Background(), []domain.Credential{
		{ID: "mp-local", ProviderID: domain.ProviderCustom, APIKey: "sk-secret", Extra: map[string]string{"base_url": srv.URL}},
	})
	if err != nil {
		t.Fatalf("ListModels returned error: %v", err)
	}
	if hit.Load() {
		t.Fatal("local endpoint was contacted despite BlockLocalHTTPCalls — discovery bypasses the SSRF policy")
	}
	if len(models) != 0 {
		t.Fatalf("models = %v, want none from a policy-blocked endpoint", models)
	}
}
