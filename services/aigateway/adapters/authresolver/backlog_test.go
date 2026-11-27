package authresolver

import (
	"context"
	"errors"
	"strconv"
	"sync"
	"testing"
	"time"

	"go.uber.org/zap"
	"go.uber.org/zap/zaptest/observer"

	"github.com/langwatch/langwatch/pkg/herr"
	"github.com/langwatch/langwatch/services/aigateway/domain"
)

// pagedPoller answers each poll with the next queued page; an empty queue is
// the long poll's 204.
type pagedPoller struct {
	mu    sync.Mutex
	pages []feedPage
}

type feedPage struct {
	changes []CacheChange
	err     error
}

func (p *pagedPoller) queue(pages ...feedPage) {
	p.mu.Lock()
	defer p.mu.Unlock()
	p.pages = append(p.pages, pages...)
}

func (p *pagedPoller) PollChanges(_ context.Context, _, since string) ([]CacheChange, string, error) {
	p.mu.Lock()
	defer p.mu.Unlock()
	if len(p.pages) == 0 {
		return nil, since, nil
	}
	page := p.pages[0]
	p.pages = p.pages[1:]
	if page.err != nil {
		return nil, since, page.err
	}
	return page.changes, page.changes[len(page.changes)-1].Revision, nil
}

// revisions numbers the events every page in a test carries.
var revisions struct {
	mu   sync.Mutex
	next int
}

func stamped(chs []CacheChange) []CacheChange {
	revisions.mu.Lock()
	defer revisions.mu.Unlock()
	for i := range chs {
		revisions.next++
		chs[i].Revision = strconv.Itoa(revisions.next)
	}
	return chs
}

// fullPage pads events with key creations to one full /changes page.
func fullPage(events ...CacheChange) feedPage {
	chs := append([]CacheChange{}, events...)
	for len(chs) < changeFeedPageSize {
		chs = append(chs, CacheChange{Kind: ChangeKindVirtualKeyCreated, VirtualKeyID: "vk_filler_" + strconv.Itoa(len(chs))})
	}
	return feedPage{changes: stamped(chs)}
}

// lastPage is a page shorter than a full one: the end of the backlog.
func lastPage(events ...CacheChange) feedPage {
	chs := append([]CacheChange{}, events...)
	if len(chs) == 0 {
		chs = append(chs, CacheChange{Kind: ChangeKindVirtualKeyCreated, VirtualKeyID: "vk_filler_last"})
	}
	return feedPage{changes: stamped(chs)}
}

func disabledEvent(vkID string) CacheChange {
	return CacheChange{Kind: ChangeKindVirtualKeyDisabled, VirtualKeyID: vkID}
}

func enabledEvent(vkID string) CacheChange {
	return CacheChange{Kind: ChangeKindVirtualKeyEnabled, VirtualKeyID: vkID}
}

func feedCursor(t *testing.T, svc *Service, orgID string) *orgCursor {
	t.Helper()
	v, ok := svc.activeOrgs.Load(orgID)
	if !ok {
		t.Fatalf("no change-feed cursor for %s", orgID)
	}
	c, _ := v.(*orgCursor)
	return c
}

func pollOnce(t *testing.T, svc *Service, cursor *orgCursor) {
	t.Helper()
	if err := svc.pollOrgChanges(context.Background(), "org_1", cursor); err != nil {
		t.Fatalf("poll: %v", err)
	}
}

func mustServe(t *testing.T, svc *Service, key domain.PresentedKey, why string) {
	t.Helper()
	if _, err := svc.Resolve(context.Background(), key); err != nil {
		t.Fatalf("%s: %v", why, err)
	}
}

func mustBeDisabled(t *testing.T, svc *Service, key domain.PresentedKey, why string) {
	t.Helper()
	if _, err := svc.Resolve(context.Background(), key); !errors.Is(err, domain.ErrKeyDisabled) {
		t.Fatalf("%s: want virtual_key_disabled, got %v", why, err)
	}
}

// keyedResolver answers each token on its own, so one test can hold an
// active key and a disabled one; down answers every call as an outage.
type keyedResolver struct {
	mu      sync.Mutex
	answers map[string]resolverReturn
	down    bool
	calls   map[string]int
}

func (r *keyedResolver) ResolveKey(_ context.Context, key domain.PresentedKey) (*domain.Bundle, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.calls[key.Token]++
	if r.down {
		return nil, errControlPlaneDown
	}
	a := r.answers[key.Token]
	return a.bundle, a.err
}

func (r *keyedResolver) FetchConfig(_ context.Context, _, _ string) (domain.ConfigFetchResult, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	if r.down {
		return domain.ConfigFetchResult{}, errControlPlaneDown
	}
	return domain.ConfigFetchResult{}, nil
}

func (r *keyedResolver) set(token string, a resolverReturn) {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.answers[token] = a
}

func (r *keyedResolver) setDown() {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.down = true
}

func (r *keyedResolver) callsFor(token string) int {
	r.mu.Lock()
	defer r.mu.Unlock()
	return r.calls[token]
}

func newKeyedResolver() *keyedResolver {
	return &keyedResolver{answers: map[string]resolverReturn{}, calls: map[string]int{}}
}

func controlPlaneDisabled() error {
	return herr.New(context.Background(), domain.ErrKeyDisabled, herr.M{"message": domain.KeyDisabledMessage})
}

// @scenario "a key disabled and re-enabled on different pages of a replayed history keeps serving"
func TestBacklog_DisableAndEnableOnDifferentPagesKeepServing(t *testing.T) {
	res := newKeyedResolver()
	poller := &pagedPoller{}
	svc, _ := newService(t, Options{Resolver: res, ConfigFetcher: res, ChangePoller: poller})
	key := domain.PresentedKey{Token: "vk-lw-flip"}
	res.set(key.Token, resolverReturn{bundle: orgBundle("vk_flip", time.Now().Add(time.Hour))})
	mustServe(t, svc, key, "the first request caches the key")
	cursor := feedCursor(t, svc, "org_1")

	poller.queue(fullPage(disabledEvent("vk_flip")))
	pollOnce(t, svc, cursor)
	mustServe(t, svc, key, "a disable that an unread page may undo must not refuse an active key")

	poller.queue(feedPage{err: errControlPlaneDown})
	if err := svc.pollOrgChanges(context.Background(), "org_1", cursor); err == nil {
		t.Fatal("the failing page must fail the poll")
	}
	mustServe(t, svc, key, "the key keeps serving while the page with the enable fails to load")

	poller.queue(lastPage(enabledEvent("vk_flip")))
	pollOnce(t, svc, cursor)
	mustServe(t, svc, key, "the key serves once the enable arrives")
	res.setDown()
	mustServe(t, svc, key, "an outage after the replay must not refuse the re-enabled key")
}

// @scenario "a disable at the head of a replayed history is refused once the replay ends"
func TestBacklog_DisableAtTheHeadIsRefusedOnceTheReplayEnds(t *testing.T) {
	res := newKeyedResolver()
	poller := &pagedPoller{}
	svc, _ := newService(t, Options{Resolver: res, ConfigFetcher: res, ChangePoller: poller})
	key := domain.PresentedKey{Token: "vk-lw-head"}
	res.set(key.Token, resolverReturn{bundle: orgBundle("vk_head", time.Now().Add(time.Hour))})
	mustServe(t, svc, key, "the first request caches the key")
	cursor := feedCursor(t, svc, "org_1")

	poller.queue(fullPage(disabledEvent("vk_head")), fullPage(enabledEvent("vk_head")), lastPage(disabledEvent("vk_head")))
	pollOnce(t, svc, cursor)
	mustServe(t, svc, key, "the control plane confirms the key while the replay is still paging")
	pollOnce(t, svc, cursor)
	mustServe(t, svc, key, "the re-enabled key serves")
	pollOnce(t, svc, cursor)

	res.setDown()
	before := res.callsFor(key.Token)
	for i := 0; i < 3; i++ {
		mustBeDisabled(t, svc, key, "the disable at the head of the history refuses the key through an outage")
	}
	if n := res.callsFor(key.Token) - before; n != 0 {
		t.Fatalf("the key must be refused locally once the replay ends; got %d control-plane calls", n)
	}
}

// @scenario "a disable and an enable on the page that ends a replay never refuse the key between them"
func TestBacklog_DisableAndEnableOnTheLastPageNeverRefuseBetweenThem(t *testing.T) {
	res := newKeyedResolver()
	poller := &pagedPoller{}
	core, logs := observer.New(zap.InfoLevel)
	svc, _ := newService(t, Options{Resolver: res, ConfigFetcher: res, ChangePoller: poller, Logger: zap.New(core)})
	key := domain.PresentedKey{Token: "vk-lw-blip"}
	res.set(key.Token, resolverReturn{bundle: orgBundle("vk_blip", time.Now().Add(time.Hour))})
	mustServe(t, svc, key, "the first request caches the key")
	cursor := feedCursor(t, svc, "org_1")

	poller.queue(lastPage(disabledEvent("vk_blip"), enabledEvent("vk_blip")))
	pollOnce(t, svc, cursor)
	denials := logs.FilterMessage("auth_cache_key_denied").All()
	if len(denials) == 0 {
		t.Fatal("the disable must be recorded")
	}
	for _, e := range denials {
		if e.ContextMap()["pending"] != true {
			t.Fatal("a disable the same page re-enables must stay pending while the page is applied")
		}
	}
	mustServe(t, svc, key, "the re-enabled key serves")
	res.setDown()
	mustServe(t, svc, key, "an outage after the page must not refuse the re-enabled key")
}

// @scenario "a key cached before a reconnect is refused by a disable in the backlog it missed"
func TestBacklog_KeyCachedBeforeReconnectIsRefusedByMissedDisable(t *testing.T) {
	res := newKeyedResolver()
	poller := &pagedPoller{}
	svc, _ := newService(t, Options{Resolver: res, ConfigFetcher: res, ChangePoller: poller})
	back := domain.PresentedKey{Token: "vk-lw-back"}
	gone := domain.PresentedKey{Token: "vk-lw-gone"}
	res.set(back.Token, resolverReturn{bundle: orgBundle("vk_back", time.Now().Add(time.Hour))})
	res.set(gone.Token, resolverReturn{bundle: orgBundle("vk_gone", time.Now().Add(time.Hour))})
	mustServe(t, svc, back, "the first key caches")
	mustServe(t, svc, gone, "the second key caches")
	cursor := feedCursor(t, svc, "org_1")
	poller.queue(lastPage())
	pollOnce(t, svc, cursor)

	poller.queue(feedPage{err: errControlPlaneDown})
	if err := svc.pollOrgChanges(context.Background(), "org_1", cursor); err == nil {
		t.Fatal("the outage must fail the poll")
	}
	res.set(gone.Token, resolverReturn{err: controlPlaneDisabled()})
	poller.queue(fullPage(disabledEvent("vk_back"), disabledEvent("vk_gone")), fullPage(enabledEvent("vk_back")), lastPage())

	pollOnce(t, svc, cursor)
	mustServe(t, svc, back, "a key the backlog re-enables later serves while the backlog pages")
	callsBefore := res.callsFor(gone.Token)
	mustBeDisabled(t, svc, gone, "the disabled key is not served from its cached copy")
	if res.callsFor(gone.Token) == callsBefore {
		t.Fatal("the disabled key must be checked with the control plane, not served from cache")
	}
	pollOnce(t, svc, cursor)
	mustServe(t, svc, back, "the re-enabled key serves")
	pollOnce(t, svc, cursor)

	res.setDown()
	mustBeDisabled(t, svc, gone, "the key the backlog left disabled is refused through an outage")
	mustServe(t, svc, back, "the re-enabled key keeps serving through the outage")
}

// stepResolver answers resolve-key from steps in order, keeping the last; the
// first call runs during before it answers, so a test can land a page then.
type stepResolver struct {
	mu     sync.Mutex
	steps  []resolverReturn
	during func()
	calls  int
}

func (r *stepResolver) ResolveKey(_ context.Context, _ domain.PresentedKey) (*domain.Bundle, error) {
	r.mu.Lock()
	r.calls++
	during := r.during
	r.during = nil
	step := r.steps[0]
	if len(r.steps) > 1 {
		r.steps = r.steps[1:]
	}
	r.mu.Unlock()
	if during != nil {
		during()
	}
	return step.bundle, step.err
}

func (r *stepResolver) FetchConfig(_ context.Context, _, _ string) (domain.ConfigFetchResult, error) {
	return domain.ConfigFetchResult{}, nil
}

func (r *stepResolver) callCount() int {
	r.mu.Lock()
	defer r.mu.Unlock()
	return r.calls
}

// replayingService is a gateway whose org feed is paging a backlog, with a
// resolve for vk_mid that lands a pending disable while it is in flight.
func replayingService(t *testing.T, steps ...resolverReturn) (*Service, *stepResolver, *pagedPoller, *orgCursor) {
	t.Helper()
	res := &stepResolver{steps: steps}
	poller := &pagedPoller{}
	svc, _ := newService(t, Options{Resolver: res, ConfigFetcher: res, ChangePoller: poller})
	seedL1(svc, hashKey(domain.PresentedKey{Token: "vk-lw-other"}), orgBundle("vk_other", time.Now().Add(time.Hour)), "")
	cursor := feedCursor(t, svc, "org_1")
	poller.queue(fullPage())
	pollOnce(t, svc, cursor)
	res.during = func() {
		poller.queue(fullPage(disabledEvent("vk_mid")))
		pollOnce(t, svc, cursor)
	}
	return svc, res, poller, cursor
}

// @scenario "an answer read before a pending denial is re-asked, not served"
func TestBacklog_AnswerVoidedByPendingDenialIsReasked(t *testing.T) {
	key := domain.PresentedKey{Token: "vk-lw-mid"}
	active := resolverReturn{bundle: orgBundle("vk_mid", time.Now().Add(time.Hour))}

	t.Run("the control plane answers again", func(t *testing.T) {
		svc, res, _, _ := replayingService(t, active, active)
		mustServe(t, svc, key, "the control plane's current answer serves")
		if n := res.callCount(); n != 2 {
			t.Fatalf("the voided answer must be re-asked once; got %d calls", n)
		}
	})

	t.Run("the second call fails", func(t *testing.T) {
		svc, _, _, _ := replayingService(t, active, resolverReturn{err: errControlPlaneDown})
		_, err := svc.Resolve(context.Background(), key)
		var refusal herr.E
		if !errors.Is(err, domain.ErrAuthUpstream) || !errors.As(err, &refusal) || !refusal.Retryable {
			t.Fatalf("want a retryable auth_upstream_unavailable, got %v", err)
		}
	})
}

// @scenario "a disable that lands while the replay is in flight is refused"
func TestBacklog_DisableLandingDuringTheReplayIsRefused(t *testing.T) {
	key := domain.PresentedKey{Token: "vk-lw-mid"}
	disabled := resolverReturn{err: controlPlaneDisabled()}
	svc, res, poller, cursor := replayingService(t,
		resolverReturn{bundle: orgBundle("vk_mid", time.Now().Add(time.Hour))}, disabled, disabled)

	mustBeDisabled(t, svc, key, "the re-asked control plane refuses the key")
	if n := res.callCount(); n != 2 {
		t.Fatalf("the answer read before the disable must be re-asked; got %d calls", n)
	}
	if svc.l1.Len() != 1 {
		t.Fatalf("the racing answer must not be cached; L1 holds %d entries", svc.l1.Len())
	}
	mustBeDisabled(t, svc, key, "the control plane refuses the disabled key")
	if n := res.callCount(); n != 3 {
		t.Fatalf("while the replay pages, the key is checked with the control plane; got %d calls", n)
	}

	poller.queue(lastPage())
	pollOnce(t, svc, cursor)
	res.mu.Lock()
	res.steps = []resolverReturn{{err: errControlPlaneDown}}
	res.mu.Unlock()
	mustBeDisabled(t, svc, key, "once the replay ends, the disable refuses the key through an outage")
	if n := res.callCount(); n != 3 {
		t.Fatalf("once the replay ends, the key is refused without a control-plane call; got %d calls", n)
	}
}

// @scenario "a held session survives an outage between backlog pages"
func TestBacklog_HeldSessionSurvivesOutageBetweenBacklogPages(t *testing.T) {
	fetcher := &heldKeyFetcher{err: errControlPlaneDown}
	svc, _ := newService(t, Options{Resolver: &fetcher.fakeResolver, ConfigFetcher: fetcher})
	svc.denyPending("vk_held", ChangeKindVirtualKeyDisabled)

	got, err := svc.ReadHeldKey(context.Background(), heldBundle(), "42")

	if got.Revoked {
		t.Fatal("a pending denial must not end the session of a key a later page may re-enable")
	}
	if !errors.Is(err, errControlPlaneDown) {
		t.Fatalf("the read must fail as the outage it is, got %v", err)
	}
}

// @scenario "a stale denied-list entry never refuses a key whose denial is pending"
func TestBacklog_StaleDeniedEntryDoesNotRefuseAPendingDenial(t *testing.T) {
	res := newKeyedResolver()
	poller := &pagedPoller{}
	svc, _ := newService(t, Options{Resolver: res, ConfigFetcher: res, ChangePoller: poller})
	key := domain.PresentedKey{Token: "vk-lw-stale"}
	res.set(key.Token, resolverReturn{bundle: orgBundle("vk_stale", time.Now().Add(time.Hour))})
	mustServe(t, svc, key, "the first request caches the key")
	svc.deniedKeys.Add(hashKey(key), "vk_stale")

	poller.queue(fullPage(disabledEvent("vk_stale")))
	pollOnce(t, svc, feedCursor(t, svc, "org_1"))
	before := res.callsFor(key.Token)
	mustServe(t, svc, key, "a pending denial must not refuse the key through a stale index entry")
	if res.callsFor(key.Token) == before {
		t.Fatal("the key must be checked with the control plane")
	}
}

// @scenario "a key that leaves the revocation list leaves the credential index too"
func TestBacklog_KeyOffTheRevocationListLeavesTheIndex(t *testing.T) {
	res := newKeyedResolver()
	svc, _ := newService(t, Options{Resolver: res, ConfigFetcher: res})
	key := domain.PresentedKey{Token: "vk-lw-pushed"}
	h := hashKey(key)
	seedL1(svc, h, orgBundle("vk_pushed", time.Now().Add(time.Hour)), "")
	svc.applyChange("org_1", disabledEvent("vk_pushed"))
	if _, ok := svc.deniedKeys.Peek(h); !ok {
		t.Fatal("the disabled key's credential must be refused locally")
	}

	for i := 0; i < denySetSize; i++ {
		svc.deny("vk_flood_"+strconv.Itoa(i), ChangeKindVirtualKeyRevoked)
	}

	if svc.denied.Contains("vk_pushed") {
		t.Fatal("the flood must push the key off the revocation list")
	}
	if vk, ok := svc.deniedKeys.Peek(h); ok {
		t.Fatalf("the credential still maps to %s after its key left the list", vk)
	}
}
