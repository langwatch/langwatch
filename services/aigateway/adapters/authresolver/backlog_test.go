package authresolver

import (
	"context"
	"errors"
	"strconv"
	"sync"
	"testing"
	"time"

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

// @scenario "a disable that lands while the replay is in flight is refused"
func TestBacklog_DisableLandingDuringTheReplayIsRefused(t *testing.T) {
	res := &hookResolver{bundle: orgBundle("vk_mid", time.Now().Add(time.Hour))}
	poller := &pagedPoller{}
	svc, _ := newService(t, Options{Resolver: res, ConfigFetcher: res, ChangePoller: poller})
	seedL1(svc, hashKey(domain.PresentedKey{Token: "vk-lw-other"}), orgBundle("vk_other", time.Now().Add(time.Hour)), "")
	cursor := feedCursor(t, svc, "org_1")
	poller.queue(fullPage())
	pollOnce(t, svc, cursor)
	key := domain.PresentedKey{Token: "vk-lw-mid"}

	res.during = func() {
		poller.queue(fullPage(disabledEvent("vk_mid")))
		pollOnce(t, svc, cursor)
	}
	mustBeDisabled(t, svc, key, "an answer read before the disable must not serve")
	if svc.l1.Len() != 1 {
		t.Fatalf("the racing answer must not be cached; L1 holds %d entries", svc.l1.Len())
	}

	res.bundle, res.err = nil, controlPlaneDisabled()
	calls := res.calls
	mustBeDisabled(t, svc, key, "the control plane refuses the disabled key")
	if res.calls == calls {
		t.Fatal("while the replay pages, the key is checked with the control plane")
	}

	poller.queue(lastPage())
	pollOnce(t, svc, cursor)
	res.err = errControlPlaneDown
	calls = res.calls
	mustBeDisabled(t, svc, key, "once the replay ends, the disable refuses the key through an outage")
	if res.calls != calls {
		t.Fatal("once the replay ends, the key is refused without a control-plane call")
	}
}
