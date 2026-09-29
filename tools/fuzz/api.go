package fuzz

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"math/rand"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	"github.com/langwatch/langwatch/tools/diffkit"
)

// DefaultAPIWorkers is the fuzzer's default parallelism over keep-alive clients.
const DefaultAPIWorkers = 64

// authKinds are the credential permutations every operation is fuzzed with.
var authKinds = []string{"none", "project", "org", "restricted"}

// job is one request to make: an operation, a credential, and a mutation.
type job struct {
	op       diffkit.Operation
	auth     string
	mutation Mutation
}

// apiRun holds one API fuzz run's shared state.
type apiRun struct {
	options   Options
	streams   Streams
	client    *http.Client
	appURL    string
	apiURL    string
	org       diffkit.ToolOrg
	requests  int64
	exercised sync.Map
	mu        sync.Mutex
	raw       []rawFinding
}

func runAPI(ctx context.Context, streams Streams, options Options) error {
	if options.Workers <= 0 {
		options.Workers = DefaultAPIWorkers
	}
	started := time.Now()
	run := &apiRun{options: options, streams: streams, client: keepAliveClient(options.Workers)}
	if err := run.resolveStack(ctx); err != nil {
		return err
	}
	seedStart := time.Now()
	runDir, err := run.prepareDir()
	if err != nil {
		return err
	}
	org, err := diffkit.SeedToolOrg(ctx, diffkit.SeedOptions{
		BaseURL: run.appURL, Tool: "fuzzer", Projects: 1, Dir: filepath.Dir(runDir),
		Progress: func(line string) { fmt.Fprintln(streams.Err, line) }, Client: keepAliveClient(4),
	})
	if err != nil {
		return fmt.Errorf("seed fuzzer org: %w", err)
	}
	run.org = org
	seedTook := time.Since(seedStart)
	fmt.Fprintf(streams.Err, "fuzz api: org %q (separate=%v), project %s, %d workers, %s budget\n",
		org.Name, org.Separate, first(org.Projects).ID, options.Workers, options.Duration)

	document, _, err := diffkit.FetchSpec(ctx, run.client, run.apiURL)
	if err != nil {
		return err
	}
	operations, err := diffkit.Operations(document)
	if err != nil {
		return err
	}
	jobs := run.plan(operations)
	logsBefore := logSignatures(ctx, run.slug())
	fuzzStart := time.Now()
	run.fuzz(ctx, jobs)
	fuzzTook := time.Since(fuzzStart)
	run.recordLogHits(logsBefore, logSignatures(ctx, run.slug()))

	shrinkStart := time.Now()
	groups := run.shrinkGroups(ctx)
	shrinkTook := time.Since(shrinkStart)

	coverage := Coverage{OperationsTotal: len(operations), OperationsExercised: run.exercisedCount()}
	timing := Timing{Total: time.Since(started), Seed: seedTook, Fuzzing: fuzzTook, Shrinking: shrinkTook,
		Requests: int(atomic.LoadInt64(&run.requests)), Findings: len(run.raw)}
	return run.report(runDir, groups, coverage, timing)
}

// slug is the haven stack to scan logs from; empty when a -url overrode the
// shared stack, since then the log scan cannot know which stack to read.
func (run *apiRun) slug() string {
	if run.options.URL != "" {
		return ""
	}
	return diffkit.CheckSlug
}

// recordLogHits turns each new error/fatal log signature into a finding.
func (run *apiRun) recordLogHits(before, after map[string]int) {
	for _, hit := range newLogSignatures(before, after) {
		run.mu.Lock()
		run.raw = append(run.raw, rawFinding{
			item: job{op: diffkit.Operation{Method: "LOG", Path: "(stack log)"}, mutation: Mutation{Name: "n/a"}},
			hit:  hit, capturedAt: time.Now().UTC().Format(time.RFC3339),
		})
		run.mu.Unlock()
	}
}

func (run *apiRun) resolveStack(ctx context.Context) error {
	if run.options.URL != "" {
		run.appURL = strings.TrimSuffix(run.options.URL, "/")
		run.apiURL = run.appURL
		return nil
	}
	stack, err := diffkit.ReadSharedStack(ctx, diffkit.CheckSlug)
	if err != nil {
		return err
	}
	run.appURL = strings.TrimSuffix(stack.AppURL, "/")
	run.apiURL = run.appURL
	return nil
}

// plan enumerates every job, then shuffles deterministically with the seed so a
// duration-bounded run samples the whole surface reproducibly.
func (run *apiRun) plan(operations []diffkit.Operation) []job {
	jobs := make([]job, 0, len(operations)*len(authKinds)*len(Mutations))
	for _, op := range operations {
		if run.options.Only != "" && !strings.Contains(op.Path, run.options.Only) {
			continue
		}
		hasBody := op.BodySchema != nil
		hasParams := strings.Contains(op.Path, "{")
		for _, mutation := range Mutations {
			if mutation.SchemaInvalid && !hasBody {
				continue
			}
			if (mutation.Foreign || mutation.InvalidID) && !hasParams {
				continue
			}
			for _, auth := range authKinds {
				jobs = append(jobs, job{op: op, auth: auth, mutation: mutation})
			}
		}
	}
	random := rand.New(rand.NewSource(run.options.Seed)) // #nosec G404 -- reproducibility, not security.
	random.Shuffle(len(jobs), func(a, b int) { jobs[a], jobs[b] = jobs[b], jobs[a] })
	return jobs
}

func (run *apiRun) fuzz(ctx context.Context, jobs []job) {
	deadline := time.Now().Add(run.options.Duration)
	queue := make(chan job)
	var group sync.WaitGroup
	stop := diffkit.StartTicker(run.streams.Err, "fuzz api:", len(jobs),
		func() (int, string) {
			done := int(atomic.LoadInt64(&run.requests))
			return done, fmt.Sprintf("%d findings", run.findingsSoFar())
		})
	defer stop()
	for worker := 0; worker < run.options.Workers; worker++ {
		group.Add(1)
		go func() {
			defer group.Done()
			for item := range queue {
				run.runJob(ctx, item)
			}
		}()
	}
	for index := 0; index < len(jobs); index++ {
		if time.Now().After(deadline) || ctx.Err() != nil {
			break
		}
		queue <- jobs[index]
	}
	close(queue)
	group.Wait()
}

func (run *apiRun) runJob(ctx context.Context, item job) {
	request := run.build(item)
	status, elapsed, body := run.do(ctx, request)
	atomic.AddInt64(&run.requests, 1)
	run.exercised.Store(item.op.Method+" "+item.op.Path, true)
	hits := Evaluate(Observation{
		Mutation: item.mutation, Status: status, Elapsed: elapsed, Body: body,
		JSONExpected: true, SeparateOrg: run.org.Separate, LatencyCap: LatencyCap,
	})
	for _, hit := range hits {
		run.record(item, request, status, hit)
	}
}

func (run *apiRun) record(item job, request builtRequest, status int, hit Hit) {
	run.mu.Lock()
	run.raw = append(run.raw, rawFinding{item: item, request: request, status: status, hit: hit, capturedAt: time.Now().UTC().Format(time.RFC3339)})
	run.mu.Unlock()
}

// asFinding renders one raw hit as an output Finding.
func (raw rawFinding) asFinding() Finding {
	return Finding{
		Oracle: raw.hit.Oracle, Finding: true, Method: raw.item.op.Method, Route: raw.item.op.Path,
		Signature: signatureOf(raw.hit.Oracle, raw.item.op.Method, raw.item.op.Path, raw.status),
		Message:   raw.hit.Message, Status: raw.status, Mutation: raw.item.mutation.Name, Auth: raw.item.auth,
		Curl: curlOf(raw.request), CapturedAt: raw.capturedAt,
	}
}

func (run *apiRun) findingsSoFar() int {
	run.mu.Lock()
	defer run.mu.Unlock()
	return len(run.raw)
}

func (run *apiRun) exercisedCount() int {
	count := 0
	run.exercised.Range(func(any, any) bool { count++; return true })
	return count
}

// keepAliveClient shares connections across workers so 64 workers do not open
// 64 fresh TLS handshakes per request.
func keepAliveClient(workers int) *http.Client {
	transport := &http.Transport{
		MaxIdleConns:        workers * 2,
		MaxIdleConnsPerHost: workers * 2,
		IdleConnTimeout:     90 * time.Second,
	}
	return &http.Client{Timeout: 30 * time.Second, Transport: transport,
		CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }}
}

func (run *apiRun) prepareDir() (string, error) {
	dir := filepath.Join(run.options.Root, ".fuzz", time.Now().Format("20060102-150405"))
	return dir, os.MkdirAll(dir, 0o750)
}

func (run *apiRun) do(ctx context.Context, request builtRequest) (int, time.Duration, []byte) {
	var reader io.Reader
	if request.body != nil {
		reader = bytes.NewReader(request.body)
	}
	httpRequest, err := http.NewRequestWithContext(ctx, request.method, request.url, reader)
	if err != nil {
		return 0, 0, nil
	}
	httpRequest.Header.Set("Content-Type", "application/json")
	for key, value := range request.headers {
		httpRequest.Header.Set(key, value)
	}
	started := time.Now()
	response, err := run.client.Do(httpRequest)
	elapsed := time.Since(started)
	if err != nil {
		return 0, elapsed, nil
	}
	defer func() { _ = response.Body.Close() }()
	body, _ := io.ReadAll(io.LimitReader(response.Body, 1<<20))
	return response.StatusCode, elapsed, body
}

func (run *apiRun) report(runDir string, groups []Group, coverage Coverage, timing Timing) error {
	writer, err := diffkit.OpenFindingsFile(filepath.Join(runDir, "findings.jsonl"))
	if err != nil {
		return err
	}
	for _, raw := range run.raw {
		_ = writer.WriteLine(raw.asFinding())
	}
	_ = writer.WriteLine(map[string]any{"kind": "run-complete", "total": len(run.raw),
		"operationsExercised": coverage.OperationsExercised, "operationsTotal": coverage.OperationsTotal})
	_ = writer.Close()
	if err := os.WriteFile(filepath.Join(runDir, "findings.md"), []byte(RenderFindingsMD(groups, len(run.raw))), 0o600); err != nil {
		return err
	}
	if err := os.WriteFile(filepath.Join(runDir, "coverage.md"), []byte(coverage.RenderCoverageMD()), 0o600); err != nil {
		return err
	}
	if err := os.WriteFile(filepath.Join(runDir, "timing.txt"), []byte(timing.String()), 0o600); err != nil {
		return err
	}
	fmt.Fprint(run.streams.Out, RenderFindingsMD(groups, len(run.raw)))
	fmt.Fprint(run.streams.Out, coverage.RenderCoverageMD())
	fmt.Fprint(run.streams.Err, timing.String())
	fmt.Fprintf(run.streams.Err, "fuzz api: wrote %s\n", runDir)
	return nil
}

func first(projects []diffkit.ToolProject) diffkit.ToolProject {
	if len(projects) == 0 {
		return diffkit.ToolProject{}
	}
	return projects[0]
}

func marshalBody(value any) []byte {
	if value == nil {
		return nil
	}
	encoded, _ := json.Marshal(value)
	return encoded
}
