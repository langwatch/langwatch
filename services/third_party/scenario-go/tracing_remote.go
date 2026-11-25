package scenario

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"math"
	"net/http"
	"slices"
	"strconv"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	"go.opentelemetry.io/otel/trace"
)

const (
	// defaultTracePollInterval is the poll cadence of the settle-wait.
	defaultTracePollInterval = time.Second
	// traceRequestTimeout bounds one trace API request.
	traceRequestTimeout = 30 * time.Second
	// invalidTraceID is the all-zero trace id of a non-recording tracer.
	invalidTraceID = "00000000000000000000000000000000"
	// settingsRequestTimeout bounds the settle-settings request; the
	// defaults apply after it.
	settingsRequestTimeout = 5 * time.Second
)

// infrastructureSpanPrefixes name scenario spans, never agent evidence.
var infrastructureSpanPrefixes = [...]string{
	"langwatch.scenario.",
	"langwatch.judge.",
	"langwatch.user_simulator.",
}

// errDeadlineAbort is the abort the settle loop caused itself by bounding a
// request to what was left of the shared deadline; it is not an API failure.
var errDeadlineAbort = errors.New("trace fetch aborted at the settle deadline")

// RemoteTraceFetcherOptions configure a LangWatchTraceFetcher.
type RemoteTraceFetcherOptions struct {
	// HTTPClient sends the trace API requests; defaults to the SDK's shared
	// keep-alive client.
	HTTPClient *http.Client
	// PollInterval is the settle-wait poll cadence; default one second.
	PollInterval time.Duration
}

// LangWatchTraceFetcher is the RemoteTraceFetcher of the SDK: it fetches the
// agent's traces from the LangWatch trace API and feeds them into the span
// collector, so the digest and expand_trace/grep_trace work on remote spans
// as on local ones.
//
// A trace settles when it holds at least one remote span (one this process
// did not start), every remote span's parent resolves within the fetched and
// locally collected spans (ancestors export after their descendants, so an
// unresolved parent means the trace is still arriving), and that span set
// held still for the quiet period, which covers a leaf still in flight.
// At the deadline a trace inside its quiet period settles cleanly; one with
// remote spans but unresolved parents settles best effort with a synthetic
// langwatch.span_collection.error span; one with nothing gets an error span
// saying so. Fetch failures retry until the deadline and never propagate.
//
// State is kept per thread so a settled trace is never fetched again;
// ClearThread drops it when the run ends.
type LangWatchTraceFetcher struct {
	client       *http.Client
	pollInterval time.Duration
	// now and sleep are the settle loop's clock; a nil sleep waits on a
	// real timer. Tests swap in a fake clock.
	now   func() time.Time
	sleep func(ctx context.Context, d time.Duration)

	mu       sync.Mutex
	registry map[string]map[string]*traceFetchState
	// recommendations caches the settle settings per endpoint, key and
	// project.
	recommendations map[string]*recommendation
}

// recommendation is one cached settle-settings request.
type recommendation struct {
	once     sync.Once
	settings RecommendedTraceSettings
	ok       bool
}

// RecommendedTraceSettings are the remote trace wait settings a LangWatch
// project recommends, from its measured ingest lag and span arrival gaps.
// A nil field is not recommended.
type RecommendedTraceSettings struct {
	WaitTimeout   *time.Duration
	WaitExtension *time.Duration
	QuietPeriod   *time.Duration
}

// TraceSettingsRecommender is implemented by a RemoteTraceFetcher that can
// ask LangWatch for the project's recommended wait settings. The judge uses
// them for whatever neither the run nor Configure sets.
type TraceSettingsRecommender interface {
	// RecommendedTraceSettings reports the recommendation, or false when
	// there is none; it never fails.
	RecommendedTraceSettings(ctx context.Context, lw LangWatchConfig) (RecommendedTraceSettings, bool)
}

// traceFetchState is the fetch state of one trace of one thread. Its fields
// are guarded by the fetcher mutex.
type traceFetchState struct {
	traceID trace.TraceID
	// merged holds the span ids this fetcher fed into the collector.
	merged  map[trace.SpanID]struct{}
	settled bool
	failed  bool
	// errorSpan is the synthetic error span recorded, so an extension wait
	// can retract it.
	errorSpan    trace.SpanID
	hasErrorSpan bool
	// candidate is the sorted remote span id set of the last parent-resolved
	// poll; candidateSince is when it was first seen.
	candidate      []byte
	hasCandidate   bool
	candidateSince time.Time
	// wrapped: every remote span whose parent is not another remote span
	// has remote children. Ancestors export after their descendants, so such
	// a trace is complete; a flat one settles on the quiet period alone and a
	// later batch may still be on its way.
	wrapped bool
}

func (st *traceFetchState) dropCandidate() {
	st.candidate, st.hasCandidate = st.candidate[:0], false
}

// NewRemoteTraceFetcher returns a trace fetcher.
func NewRemoteTraceFetcher(opts RemoteTraceFetcherOptions) *LangWatchTraceFetcher {
	if opts.PollInterval <= 0 {
		opts.PollInterval = defaultTracePollInterval
	}
	return &LangWatchTraceFetcher{
		client:          opts.HTTPClient,
		pollInterval:    opts.PollInterval,
		now:             time.Now,
		registry:        map[string]map[string]*traceFetchState{},
		recommendations: map[string]*recommendation{},
	}
}

var (
	defaultFetcherOnce sync.Once
	defaultFetcher     atomic.Pointer[LangWatchTraceFetcher]
)

// DefaultRemoteTraceFetcher is the fetcher the judge and the evaluators use
// when no other is registered. Created on first use.
func DefaultRemoteTraceFetcher() *LangWatchTraceFetcher {
	defaultFetcherOnce.Do(func() { defaultFetcher.Store(NewRemoteTraceFetcher(RemoteTraceFetcherOptions{})) })
	return defaultFetcher.Load()
}

func (f *LangWatchTraceFetcher) httpClient() *http.Client {
	if f.client != nil {
		return f.client
	}
	return sharedHTTPClient()
}

// SettleWait implements RemoteTraceFetcher: it polls every unsettled trace
// in parallel under one shared deadline of target.Timeout.
func (f *LangWatchTraceFetcher) SettleWait(ctx context.Context, target TraceSettleTarget) SettleOutcome {
	lw := resolveLangWatch(target.LangWatch)
	deadline := f.now().Add(target.Timeout)
	claimed := make([]trace.TraceID, 0, len(target.TraceIDs))
	for _, id := range target.TraceIDs {
		if tid, ok := parseTraceID(id); ok {
			claimed = append(claimed, tid)
		}
	}
	target.Collector.ClaimTraces(target.ThreadID, claimed)

	pending := f.pending(target.ThreadID, target.TraceIDs)
	if lw.Endpoint == "" || lw.APIKey == "" {
		missing := "endpoint"
		if lw.Endpoint != "" {
			missing = "API key"
		}
		for _, st := range pending {
			id := st.traceID.String()
			f.recordFailure(target.ThreadID, st, target.Collector, "Cannot fetch trace "+id+": remote trace fetching is on but the LangWatch "+missing+" is not configured (set LANGWATCH_API_KEY and LANGWATCH_ENDPOINT, or pass them in the run's langwatch config)")
		}
		return SettleOutcome{}
	}
	quiet := target.QuietPeriod
	if quiet < 0 {
		logger().Warn("QuietPeriod must be a non-negative duration; using the default", "value", quiet.String())
		quiet = DefaultTraceQuietPeriod
	}
	req := settleRequest{target: target, lw: lw, deadline: deadline, quiet: quiet}
	if len(pending) == 1 {
		f.settleOne(ctx, req, pending[0])
	} else {
		var wg sync.WaitGroup
		for _, st := range pending {
			wg.Go(func() { f.settleOne(ctx, req, st) })
		}
		wg.Wait()
	}
	return f.outcome(target.ThreadID, target.TraceIDs)
}

// ExtendSettle implements RemoteTraceFetcher: it re-arms every trace that
// failed the first wait (retracting its error span) or settled on the quiet
// period alone, and waits once more. Spans arriving meanwhile join.
func (f *LangWatchTraceFetcher) ExtendSettle(ctx context.Context, target TraceSettleTarget) SettleOutcome {
	f.mu.Lock()
	states := f.registry[target.ThreadID]
	for _, id := range target.TraceIDs {
		st := states[id]
		if st == nil {
			continue
		}
		if st.settled && !st.wrapped {
			st.settled = false
			st.dropCandidate()
			continue
		}
		if !st.failed {
			continue
		}
		st.failed = false
		if st.hasErrorSpan {
			target.Collector.RemoveSpan(target.ThreadID, st.errorSpan)
			st.hasErrorSpan = false
		}
		st.dropCandidate()
	}
	f.mu.Unlock()
	return f.SettleWait(ctx, target)
}

// NoneSettled implements RemoteTraceFetcher.
func (f *LangWatchTraceFetcher) NoneSettled(threadID string, traceIDs []string) bool {
	f.mu.Lock()
	defer f.mu.Unlock()
	states := f.registry[threadID]
	for _, id := range traceIDs {
		if st := states[id]; st != nil && st.settled {
			return false
		}
	}
	return true
}

// RecordMissingTraceIDs implements RemoteTraceFetcher.
func (f *LangWatchTraceFetcher) RecordMissingTraceIDs(threadID string, collector *SpanCollector) {
	f.recordFailure(threadID, f.stateFor(threadID, invalidTraceID), collector,
		"Remote trace fetching is on but no message of this conversation carries a trace id, so no trace could be fetched. The agent adapter has to return the trace id of the run (or forward input.propagationHeaders so the agent joins the scenario's trace).")
}

// ClearThread implements RemoteTraceFetcher.
func (f *LangWatchTraceFetcher) ClearThread(threadID string) {
	f.mu.Lock()
	delete(f.registry, threadID)
	f.mu.Unlock()
}

func (f *LangWatchTraceFetcher) outcome(threadID string, traceIDs []string) SettleOutcome {
	f.mu.Lock()
	defer f.mu.Unlock()
	states := f.registry[threadID]
	out := SettleOutcome{AllSettled: true}
	for _, id := range traceIDs {
		st := states[id]
		if st == nil || !st.settled {
			out.AllSettled = false
			continue
		}
		if !st.wrapped {
			out.Unconfirmed = true
		}
	}
	return out
}

// RecommendedTraceSettings implements TraceSettingsRecommender: it asks
// GET {endpoint}/api/traces/settle-settings once per endpoint, key and
// project. An unreachable endpoint, one older than the route, or any
// unexpected answer reports none, and the caller keeps its defaults.
func (f *LangWatchTraceFetcher) RecommendedTraceSettings(ctx context.Context, cfg LangWatchConfig) (RecommendedTraceSettings, bool) {
	lw := resolveLangWatch(cfg)
	if lw.Endpoint == "" || lw.APIKey == "" {
		return RecommendedTraceSettings{}, false
	}
	key := lw.Endpoint + "\x00" + lw.APIKey + "\x00" + lw.ProjectID
	f.mu.Lock()
	rec := f.recommendations[key]
	if rec == nil {
		rec = &recommendation{}
		f.recommendations[key] = rec
	}
	f.mu.Unlock()
	rec.once.Do(func() { rec.settings, rec.ok = f.fetchRecommendation(ctx, lw) })
	return rec.settings, rec.ok
}

func (f *LangWatchTraceFetcher) fetchRecommendation(ctx context.Context, lw LangWatchConfig) (RecommendedTraceSettings, bool) {
	rctx, cancel := context.WithTimeout(context.WithoutCancel(ctx), settingsRequestTimeout)
	defer cancel()
	url := strings.TrimSuffix(lw.Endpoint, "/") + "/api/traces/settle-settings"
	req, err := http.NewRequestWithContext(rctx, http.MethodGet, url, nil)
	if err != nil {
		return RecommendedTraceSettings{}, false
	}
	setAuthHeaders(req, lw)
	resp, err := f.httpClient().Do(req)
	if err != nil {
		logger().Debug("Trace settle settings unavailable; using defaults", "reason", err.Error())
		return RecommendedTraceSettings{}, false
	}
	defer resp.Body.Close()
	if resp.StatusCode < 200 || resp.StatusCode > 299 {
		return RecommendedTraceSettings{}, false
	}
	var body map[string]any
	if err := json.NewDecoder(resp.Body).Decode(&body); err != nil {
		logger().Debug("Trace settle settings unavailable; using defaults", "reason", err.Error())
		return RecommendedTraceSettings{}, false
	}
	read := func(name string) *time.Duration {
		v, ok := body[name].(float64)
		if !ok || math.IsInf(v, 0) || math.IsNaN(v) || v < 0 {
			return nil
		}
		d := time.Duration(v * float64(time.Millisecond))
		return &d
	}
	return RecommendedTraceSettings{
		WaitTimeout:   read("waitTimeoutMs"),
		WaitExtension: read("waitExtensionMs"),
		QuietPeriod:   read("quietPeriodMs"),
	}, true
}

// pending returns the states of the traces neither settled nor failed,
// creating missing ones.
func (f *LangWatchTraceFetcher) pending(threadID string, traceIDs []string) []*traceFetchState {
	out := make([]*traceFetchState, 0, len(traceIDs))
	for _, id := range traceIDs {
		st := f.stateFor(threadID, id)
		f.mu.Lock()
		open := !st.settled && !st.failed
		f.mu.Unlock()
		if open && !slices.Contains(out, st) {
			out = append(out, st)
		}
	}
	return out
}

func (f *LangWatchTraceFetcher) stateFor(threadID, traceID string) *traceFetchState {
	f.mu.Lock()
	defer f.mu.Unlock()
	states := f.registry[threadID]
	if states == nil {
		states = map[string]*traceFetchState{}
		f.registry[threadID] = states
	}
	st := states[traceID]
	if st == nil {
		tid, _ := parseTraceID(traceID)
		st = &traceFetchState{traceID: tid, merged: map[trace.SpanID]struct{}{}}
		states[traceID] = st
	}
	return st
}

// recordFailure marks the trace failed and feeds one synthetic error span
// carrying the reason, once per trace.
func (f *LangWatchTraceFetcher) recordFailure(threadID string, st *traceFetchState, collector *SpanCollector, reason string) {
	f.mu.Lock()
	if st.failed {
		f.mu.Unlock()
		return
	}
	st.failed = true
	span := NewSyntheticErrorSpan(st.traceID, threadID, reason)
	st.errorSpan, st.hasErrorSpan = span.SpanContext().SpanID(), true
	f.mu.Unlock()
	logger().Warn("Remote trace collection failed", "traceId", st.traceID.String(), "reason", reason)
	collector.Add(span)
}

type settleRequest struct {
	target   TraceSettleTarget
	lw       LangWatchConfig
	deadline time.Time
	quiet    time.Duration
}

func (f *LangWatchTraceFetcher) settleOne(ctx context.Context, req settleRequest, st *traceFetchState) {
	threadID, collector := req.target.ThreadID, req.target.Collector
	traceID := st.traceID.String()
	timeoutMs := strconv.FormatInt(req.target.Timeout.Milliseconds(), 10)
	lastRemote := 0
	var lastErr string
	var timer *time.Timer
	defer func() {
		if timer != nil {
			timer.Stop()
		}
	}()
	for {
		remote, err := f.pollOnce(ctx, req, st)
		switch {
		case err == nil:
			lastRemote, lastErr = remote, ""
		case errors.Is(err, errDeadlineAbort):
			// Our own abort: the earlier error, if any, stands.
		default:
			lastErr = err.Error()
			// A poll that never answered cannot vouch for the span set
			// holding still.
			f.mu.Lock()
			st.dropCandidate()
			f.mu.Unlock()
			logger().Debug("Trace poll failed; retrying until the deadline", "traceId", traceID, "reason", lastErr)
		}

		f.mu.Lock()
		settled, candidate := st.settled, st.hasCandidate
		f.mu.Unlock()
		if settled {
			return
		}
		remaining := req.deadline.Sub(f.now())
		if remaining <= 0 || ctx.Err() != nil {
			switch {
			case candidate:
				// Complete and only waiting out the quiet period.
				f.mu.Lock()
				st.settled = true
				f.mu.Unlock()
			case lastRemote >= 1:
				suffix := ""
				if lastErr != "" {
					suffix = "; the last poll also failed: " + lastErr
				}
				f.recordFailure(threadID, st, collector, "Trace "+traceID+" was still incomplete after "+timeoutMs+"ms: "+strconv.Itoa(lastRemote)+" remote spans were collected but some parent spans never arrived, so spans may be missing"+suffix)
			case lastErr != "":
				f.recordFailure(threadID, st, collector, "Fetching trace "+traceID+" kept failing until the "+timeoutMs+"ms deadline: "+lastErr)
			default:
				f.recordFailure(threadID, st, collector, "Timed out after "+timeoutMs+"ms waiting for trace "+traceID+": no agent spans arrived (the agent may not have adopted the propagated trace context or may not report to this LangWatch project)")
			}
			return
		}
		wait := min(f.pollInterval, remaining)
		if f.sleep != nil {
			f.sleep(ctx, wait)
			continue
		}
		if timer == nil {
			timer = time.NewTimer(wait)
		} else {
			timer.Reset(wait)
		}
		select {
		case <-timer.C:
		case <-ctx.Done():
		}
	}
}

// pollOnce fetches, merges and evaluates the settle rule once, returning the
// remote span count.
func (f *LangWatchTraceFetcher) pollOnce(ctx context.Context, req settleRequest, st *traceFetchState) (int, error) {
	spans, err := f.fetchTrace(ctx, req, st.traceID.String())
	if err != nil {
		return 0, err
	}
	remote, resolved, key, wrapped := f.merge(req.target, st, spans)
	f.mu.Lock()
	defer f.mu.Unlock()
	if remote < 1 || !resolved {
		st.dropCandidate()
		return remote, nil
	}
	st.wrapped = wrapped
	now := f.now()
	if !st.hasCandidate || !bytes.Equal(st.candidate, key) {
		st.candidate, st.hasCandidate, st.candidateSince = append(st.candidate[:0], key...), true, now
	}
	if now.Sub(st.candidateSince) >= req.quiet {
		st.settled = true
	}
	return remote, nil
}

func isInfrastructureSpan(name string) bool {
	for _, p := range infrastructureSpanPrefixes {
		if strings.HasPrefix(name, p) {
			return true
		}
	}
	return false
}

// merge skips infrastructure spans, dedupes by span id against the spans
// already collected for the thread, tags the rest with the thread id and
// feeds them to the collector. It returns the remote span count, whether
// every remote span's parent resolves, the sorted remote span id key, and
// whether the remote spans are wrapped (see traceFetchState.wrapped).
func (f *LangWatchTraceFetcher) merge(target TraceSettleTarget, st *traceFetchState, spans []langWatchAPISpan) (int, bool, []byte, bool) {
	collector, threadID := target.Collector, target.ThreadID
	collected := collector.SpansForThread(threadID)
	f.mu.Lock()
	collectedIDs := make(map[trace.SpanID]bool, len(collected)+len(spans))
	for _, s := range collected {
		id := s.SpanContext().SpanID()
		_, mergedBefore := st.merged[id]
		collectedIDs[id] = !mergedBefore // true: a local span
	}
	f.mu.Unlock()
	fetched := make(map[trace.SpanID]struct{}, len(spans))
	ids := make([]trace.SpanID, len(spans))
	valid := make([]bool, len(spans))
	for i := range spans {
		if id, ok := parseSpanID(spans[i].SpanID); ok {
			ids[i], valid[i] = id, true
			fetched[id] = struct{}{}
		}
	}

	remote := 0
	resolved := len(spans) > 0
	remoteIDs := make([]trace.SpanID, 0, len(spans))
	// remoteIdx are the indexes of the remote spans in spans.
	remoteIdx := make([]int, 0, len(spans))
	for i := range spans {
		s := &spans[i]
		if isInfrastructureSpan(s.Name) || !valid[i] {
			continue
		}
		id := ids[i]
		local, seen := collectedIDs[id]
		// A span this process started is a platform echo, never evidence.
		if !(seen && local) && !collector.IsProcessSpan(st.traceID, id) {
			remote++
			remoteIDs = append(remoteIDs, id)
			remoteIdx = append(remoteIdx, i)
			if parent, ok := parseSpanID(s.ParentID); ok {
				_, inFetched := fetched[parent]
				_, inCollected := collectedIDs[parent]
				if !inFetched && !inCollected && !collector.IsProcessSpan(st.traceID, parent) {
					resolved = false
				}
			}
		}
		if seen {
			continue
		}
		collectedIDs[id] = false
		f.mu.Lock()
		st.merged[id] = struct{}{}
		f.mu.Unlock()
		collector.Add(s.readOnlySpan(st.traceID, id, threadID))
	}
	wrapped := isWrapped(spans, ids, remoteIdx)
	slices.SortFunc(remoteIDs, func(a, b trace.SpanID) int { return bytes.Compare(a[:], b[:]) })
	key := make([]byte, 0, len(remoteIDs)*len(trace.SpanID{}))
	for _, id := range remoteIDs {
		key = append(key, id[:]...)
	}
	return remote, resolved, key, wrapped
}

// isWrapped reports whether the remote spans (indexes into spans) have entry
// spans, those whose parent is not another remote span, and every one of
// them has remote children.
func isWrapped(spans []langWatchAPISpan, ids []trace.SpanID, remoteIdx []int) bool {
	remoteSet := make(map[trace.SpanID]struct{}, len(remoteIdx))
	for _, i := range remoteIdx {
		remoteSet[ids[i]] = struct{}{}
	}
	parents := make(map[trace.SpanID]struct{}, len(remoteIdx))
	for _, i := range remoteIdx {
		if p, ok := parseSpanID(spans[i].ParentID); ok {
			parents[p] = struct{}{}
		}
	}
	entries := 0
	for _, i := range remoteIdx {
		if p, ok := parseSpanID(spans[i].ParentID); ok {
			if _, remote := remoteSet[p]; remote {
				continue
			}
		}
		entries++
		if _, hasChildren := parents[ids[i]]; !hasChildren {
			return false
		}
	}
	return entries > 0
}

// fetchTrace GETs the trace's spans; a 404 means not arrived yet. The
// request is bounded by the request timeout and by what is left of the
// shared deadline, whichever is nearer.
func (f *LangWatchTraceFetcher) fetchTrace(ctx context.Context, req settleRequest, traceID string) ([]langWatchAPISpan, error) {
	remaining := req.deadline.Sub(f.now())
	boundedByDeadline := remaining <= traceRequestTimeout
	bound := max(time.Millisecond, min(traceRequestTimeout, remaining))
	rctx, cancel := context.WithTimeout(ctx, bound)
	defer cancel()

	url := strings.TrimSuffix(req.lw.Endpoint, "/") + "/api/trace/" + traceID
	httpReq, err := http.NewRequestWithContext(rctx, http.MethodGet, url, nil)
	if err != nil {
		return nil, err
	}
	setAuthHeaders(httpReq, req.lw)
	spans, err := f.do(httpReq)
	if err != nil && boundedByDeadline && errors.Is(rctx.Err(), context.DeadlineExceeded) && ctx.Err() == nil {
		return nil, errDeadlineAbort
	}
	return spans, err
}

// setAuthHeaders sets the trace API auth. Dual-emit: /api/trace historically
// reads X-Auth-Token, newer deployments a Bearer token. The Bearer branch
// rejects an unscoped PAT or organization key, hence X-Project-Id.
func setAuthHeaders(req *http.Request, lw LangWatchConfig) {
	req.Header.Set("X-Auth-Token", lw.APIKey)
	req.Header.Set("Authorization", "Bearer "+lw.APIKey)
	if lw.ProjectID != "" {
		req.Header.Set("X-Project-Id", lw.ProjectID)
	}
}

func (f *LangWatchTraceFetcher) do(req *http.Request) ([]langWatchAPISpan, error) {
	resp, err := f.httpClient().Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	if resp.StatusCode == http.StatusNotFound {
		return nil, nil
	}
	if resp.StatusCode < 200 || resp.StatusCode > 299 {
		return nil, errors.New("Trace API returned " + strconv.Itoa(resp.StatusCode) + ": " + http.StatusText(resp.StatusCode))
	}
	var body struct {
		Spans []langWatchAPISpan `json:"spans"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&body); err != nil {
		return nil, err
	}
	return body.Spans, nil
}
