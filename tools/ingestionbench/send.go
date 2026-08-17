package ingestionbench

// The OTLP send path: turning generated traces into requests, dispatching them
// at the stage's concurrency and arrival shape, and counting what the receiver
// actually took.

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"strings"
	"sync"
	"time"
)

// errPlanLimit marks the one send failure that must abort the run.
//
// A plan-limit rejection silently caps the load. Treated as an ordinary
// failed request it would look like the pipeline dropping data, so the run
// would report a correctness violation that is really a billing limit.
var errPlanLimit = errors.New("project hit its plan limit (ERR_PLAN_LIMIT)")

// sendOutcome is what a stage's send phase actually achieved.
type sendOutcome struct {
	Accepted int
	Rejected int
	Requests int
	Failures int
	// AcceptedByTrace holds spans the receiver ACCEPTED, keyed tenant -> trace.
	//
	// Correctness compares against this, never against what was sent. A
	// request that failed at the socket, or a 2xx that rejected spans, means
	// those spans were never offered to the pipeline — counting them as
	// expected would report data loss the pipeline never caused, and a
	// benchmark that cries wolf gets switched off.
	AcceptedByTrace map[string]map[string]int
}

// sendResult is one request's outcome.
type sendResult struct {
	accepted int
	rejected int
	ok       bool
}

// spanPost is one OTLP request: where it goes, whose it is, and what is in it.
type spanPost struct {
	// Endpoint is the platform base URL; the OTLP path is appended.
	Endpoint string
	// Tenant owns the spans and supplies the API key.
	Tenant Tenant
	// Spans travel as a single resourceSpans batch.
	Spans []OtlpSpan
}

// postSpans POSTs one OTLP request and counts what the receiver actually took.
//
// A 2xx does NOT mean the spans landed: the receiver reports drops in
// partialSuccess.rejectedSpans while still returning success. Counting a 2xx
// as "all accepted" would make the correctness check report phantom data
// loss, so rejections are subtracted here at the source.
func postSpans(ctx context.Context, client *http.Client, post spanPost) (sendResult, error) {
	endpoint, tenant, spans := post.Endpoint, post.Tenant, post.Spans

	body, err := json.Marshal(BuildResourceSpans(spans))
	if err != nil {
		return sendResult{}, err
	}

	target := strings.TrimSuffix(endpoint, "/") + "/api/otel/v1/traces"
	request, err := http.NewRequestWithContext(ctx, http.MethodPost, target, strings.NewReader(string(body)))
	if err != nil {
		return sendResult{}, err
	}
	request.Header.Set("Content-Type", "application/json")
	request.Header.Set("X-Auth-Token", tenant.APIKey)

	response, err := client.Do(request)
	if err != nil {
		return sendResult{}, err
	}
	defer response.Body.Close()

	payload, err := io.ReadAll(response.Body)
	if err != nil {
		return sendResult{}, err
	}

	if response.StatusCode < 200 || response.StatusCode >= 300 {
		if strings.Contains(string(payload), "ERR_PLAN_LIMIT") {
			return sendResult{}, fmt.Errorf(
				"%w: project %s needs enough headroom for the whole workload, "+
					"or the run measures the rate limiter rather than the pipeline",
				errPlanLimit, tenant.ProjectID)
		}
		return sendResult{accepted: 0, rejected: len(spans), ok: false}, nil
	}

	var decoded struct {
		PartialSuccess struct {
			RejectedSpans json.Number `json:"rejectedSpans"`
		} `json:"partialSuccess"`
	}
	// A body that will not decode is not a rejection signal — the receiver
	// returned success, so treat the spans as accepted rather than inventing
	// loss.
	_ = json.Unmarshal(payload, &decoded)
	rejected, _ := decoded.PartialSuccess.RejectedSpans.Int64()

	return sendResult{accepted: len(spans) - int(rejected), rejected: int(rejected), ok: true}, nil
}

// stageRequest is one (tenant, trace, chunk) POST waiting to be sent.
type stageRequest struct {
	Tenant  Tenant
	TraceID string
	Spans   []OtlpSpan
}

// stageSend is one stage's send inputs.
type stageSend struct {
	Endpoint string
	Plan     StagePlan
	Traces   []generatedTrace
	// Seed is offset from the generation seed so the send order is replayable
	// without repeating the span-generation sequence.
	Seed int64
}

// sendStage sends a whole stage, at the stage's configured concurrency.
func sendStage(ctx context.Context, client *http.Client, send stageSend) (sendOutcome, error) {
	plan := send.Plan
	rng := CreateRng(stageSeed(send.Seed, plan.Stage) + 1)

	requests, err := buildStageRequests(plan, send.Traces, rng)
	if err != nil {
		return sendOutcome{}, err
	}

	// Interleave tenants so no tenant's work is contiguous — a fair-dispatch
	// bug is invisible if each tenant is served in its own uninterrupted block.
	//
	// Only where the stage asked for scattering. The serial stage exists to send
	// 2000 requests in order at concurrency 1, and shuffling them here destroyed
	// exactly the property it was built to test: a per-aggregate FIFO bug would
	// have been indistinguishable from the driver's own shuffle.
	ordered := requests
	if plan.ScatterAcrossRequests {
		ordered = ScatterAcrossConcurrentArrivals(requests, rng)
	}

	results, err := runStageRequests(ctx, client, stageDispatch{
		Endpoint:    send.Endpoint,
		Requests:    ordered,
		Concurrency: plan.Concurrency,
		BurstSize:   plan.BurstSize,
	})
	if err != nil {
		return sendOutcome{}, err
	}

	return tallyStage(ordered, results), nil
}

// buildStageRequests expands a stage's traces into the POSTs that carry them,
// one entry per (tenant, trace, chunk).
//
// The trace id rides along on each request so accepted counts can be attributed
// back to a trace, which is what the correctness check compares against.
func buildStageRequests(plan StagePlan, traces []generatedTrace, rng Rng) ([]stageRequest, error) {
	var requests []stageRequest
	for _, trace := range traces {
		ordered := trace.Spans
		if plan.ScatterAcrossRequests {
			ordered = ScatterAcrossConcurrentArrivals(trace.Spans, rng)
		}
		chunks, err := ChunkSpans(ordered, plan.SpansPerRequest)
		if err != nil {
			return nil, err
		}
		for _, chunk := range chunks {
			requests = append(requests, stageRequest{Tenant: trace.Tenant, TraceID: trace.TraceID, Spans: chunk})
		}
	}
	return requests, nil
}

// stageDispatch is one stage's send phase: where to, what, and how many at once.
type stageDispatch struct {
	Endpoint    string
	Requests    []stageRequest
	Concurrency int
	// BurstSize sends the stage in dense clusters of this many requests with a
	// pause between them, instead of one continuous stream. Zero is steady
	// arrival.
	BurstSize int
}

// runStageRequests sends every request, at most Concurrency at a time, and
// returns one result per request in the order they were given.
//
// Only a plan limit aborts the stage. Anything else — a socket reset, a
// timeout — is a failed request recorded in its result: the pipeline never saw
// those spans, so they are not counted as expected either, and treating an
// infrastructure blip as data loss is how a benchmark starts crying wolf.
func runStageRequests(ctx context.Context, client *http.Client, dispatch stageDispatch) ([]sendResult, error) {
	requests := dispatch.Requests
	results := make([]sendResult, len(requests))

	var (
		mu       sync.Mutex
		firstErr error
	)
	sender := stageSender{
		client:   client,
		endpoint: dispatch.Endpoint,
		fatal: func(err error) {
			mu.Lock()
			defer mu.Unlock()
			if firstErr == nil {
				firstErr = err
			}
		},
	}

	windows := burstWindows(len(requests), dispatch.BurstSize)
	for i, w := range windows {
		sendWindow(ctx, sendWindowArgs{
			Sender:      sender,
			Requests:    requests[w.from:w.to],
			Results:     results[w.from:w.to],
			Concurrency: dispatch.Concurrency,
		})

		// Stop dispatching once the run is canceled. sleep() returns at once on
		// a done context, so without this the remaining windows would all still
		// be sent: feedIndices closes early, every dispatched request fails at
		// the socket, and tallyStage counts them as Failures — the stage would
		// report a large RequestsFailed figure caused entirely by the shutdown.
		if ctx.Err() != nil {
			break
		}

		if i < len(windows)-1 {
			sleep(ctx, burstGap)
		}
	}

	if firstErr != nil {
		return nil, firstErr
	}
	return results, nil
}

// window is a half-open range over the request list.
type window struct{ from, to int }

// burstWindows slices the request list into the groups that go out back to
// back: one per burst, or a single window over everything when the stage asked
// for steady arrival.
//
// The pause between windows is what makes a burst a burst. Without it the
// requests merge back into one continuous stream and the stage stops testing
// arrival shape at all, which is what happened while BurstSize was planned,
// documented and never read.
func burstWindows(total, burstSize int) []window {
	if total <= 0 {
		return nil
	}
	if burstSize <= 0 {
		return []window{{from: 0, to: total}}
	}

	windows := make([]window, 0, (total+burstSize-1)/burstSize)
	for offset := 0; offset < total; offset += burstSize {
		windows = append(windows, window{from: offset, to: min(offset+burstSize, total)})
	}
	return windows
}

// burstGap is the idle stretch between bursts. Long enough that the queue
// visibly drains and refills, short enough that a stage still finishes inside
// the job's wall-clock budget.
const burstGap = 2 * time.Second

// sendWindowArgs is one burst's worth of work.
type sendWindowArgs struct {
	Sender   stageSender
	Requests []stageRequest
	// Results is the slice this window writes into, aligned with Requests.
	Results     []sendResult
	Concurrency int
}

// sendWindow sends one window of requests, at most Concurrency at a time, and
// returns once every one of them has finished.
func sendWindow(ctx context.Context, args sendWindowArgs) {
	next := feedIndices(ctx, len(args.Requests))

	var wait sync.WaitGroup
	for range max(1, min(args.Concurrency, len(args.Requests))) {
		wait.Add(1)
		go func() {
			defer wait.Done()
			for index := range next {
				args.Results[index] = args.Sender.send(ctx, args.Requests[index])
			}
		}()
	}
	wait.Wait()
}

// feedIndices hands request indices to the workers one at a time, and stops
// early if the run is canceled.
//
// A channel rather than a slice split: the requests are deliberately unequal in
// size, so handing each worker a fixed share would leave some idle while one
// worked through the oversized payloads.
func feedIndices(ctx context.Context, count int) <-chan int {
	next := make(chan int)
	go func() {
		defer close(next)
		for i := range count {
			select {
			case next <- i:
			case <-ctx.Done():
				return
			}
		}
	}()
	return next
}

// stageSender sends one request and classifies its failure.
type stageSender struct {
	client   *http.Client
	endpoint string
	// fatal reports an error that must abort the whole stage. Called at most
	// once per stage in effect, since the caller keeps only the first.
	fatal func(error)
}

// send posts one request. A failure that is not a plan limit is recorded in the
// result rather than raised: the spans were never offered to the pipeline, so
// they are not counted as expected either.
func (s stageSender) send(ctx context.Context, request stageRequest) sendResult {
	result, err := postSpans(ctx, s.client, spanPost{
		Endpoint: s.endpoint,
		Tenant:   request.Tenant,
		Spans:    request.Spans,
	})
	if err != nil {
		if errors.Is(err, errPlanLimit) {
			s.fatal(err)
		}
		return sendResult{ok: false}
	}
	return result
}

// tallyStage folds per-request results into the stage's outcome, attributing
// accepted spans back to the trace that carried them.
func tallyStage(requests []stageRequest, results []sendResult) sendOutcome {
	outcome := sendOutcome{AcceptedByTrace: map[string]map[string]int{}}
	for index, result := range results {
		request := requests[index]
		outcome.Requests++
		outcome.Accepted += result.accepted
		outcome.Rejected += result.rejected
		if !result.ok {
			outcome.Failures++
		}
		tenantID := request.Tenant.ProjectID
		if outcome.AcceptedByTrace[tenantID] == nil {
			outcome.AcceptedByTrace[tenantID] = map[string]int{}
		}
		outcome.AcceptedByTrace[tenantID][request.TraceID] += result.accepted
	}
	return outcome
}
