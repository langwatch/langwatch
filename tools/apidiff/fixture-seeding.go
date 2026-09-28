package apidiff

import (
	"fmt"
	"net/http"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"
)

// The fixture trace both sides ingest before the first probe. Its ids are
// client-chosen (OTLP carries them), so both sides hold the same trace and
// every trace route is asked about the same id.
const (
	fixtureTraceID = "a91d1ff0a91d1ff0a91d1ff0a91d1ff0"
	fixtureSpanID  = "a91d1ff0a91d1ff0"
	otlpTracesPath = "/api/otel/v1/traces"
)

// fixtureTraceWait bounds how long the run waits for the ingested trace to
// become readable; ingestion lands through the worker, asynchronously.
var fixtureTraceWait = 120 * time.Second

// fixtureSymbols are ids the run's fixtures create on both sides, filed into
// both symbol tables before the first probe: the trace ingested here and the
// workflow provisioningSQL inserts (no REST route creates a workflow).
var fixtureSymbols = map[string]string{
	"traceid":    fixtureTraceID,
	"workflowid": fixtureWorkflowID,
	"versionid":  fixtureWorkflowVersionID,
	// The workflow version, qualified by its family, so a prompt version
	// captured later never answers a workflow route's {versionId}.
	"workflows/versionid": fixtureWorkflowVersionID,
}

// seedFixtures files the fixture ids and ingests the fixture trace on both
// sides. The wait for each side to read it back runs in the background; only
// an operation that reads traces waits for it (awaitFixtureTraceFor).
func (engine *probeEngine) seedFixtures() {
	buckets := make([]string, 0, len(fixtureSymbols))
	for bucket := range fixtureSymbols {
		buckets = append(buckets, bucket)
	}
	sort.Strings(buckets)
	for _, bucket := range buckets {
		engine.symbolsA.file(bucket, fixtureSymbols[bucket])
		engine.symbolsB.file(bucket, fixtureSymbols[bucket])
	}
	accepted := engine.ingestFixtureTrace()
	done := make(chan struct{})
	engine.fixtureTrace = done
	go func() {
		defer close(done)
		engine.awaitFixtureTrace(accepted)
	}()
	engine.ingestCodingAgentLog()
	var group sync.WaitGroup
	group.Go(func() { engine.mintCLISession(engine.options.A, engine.credsA) })
	engine.mintCLISession(engine.options.B, engine.credsB)
	group.Wait()
}

func (engine *probeEngine) ingestFixtureTrace() []string {
	body := fixtureTraceBody(time.Now().Truncate(time.Hour))
	accepted := make([]string, 0, 2)
	for _, baseURL := range []string{engine.options.A, engine.options.B} {
		result := engine.execute(probeRequest{
			baseURL: baseURL, method: http.MethodPost, path: otlpTracesPath,
			headers: map[string]string{"X-Auth-Token": engine.options.Keys.ProjectKey}, body: body,
		})
		engine.progress("fixture trace %s%s: %d %s\n", baseURL, otlpTracesPath, result.Status, result.Error)
		if result.Status >= 200 && result.Status < 300 {
			accepted = append(accepted, baseURL)
		}
	}
	return accepted
}

// awaitFixtureTrace polls each side that accepted the trace until it reads
// back, both sides at once, so the trace routes compare a real trace rather
// than two 404s. A side that never reads it back is said so loudly.
func (engine *probeEngine) awaitFixtureTrace(baseURLs []string) {
	started := time.Now()
	deadline := started.Add(fixtureTraceWait)
	var group sync.WaitGroup
	for _, baseURL := range baseURLs {
		group.Go(func() {
			status := engine.readFixtureTrace(baseURL)
			for status != http.StatusOK && time.Now().Before(deadline) && engine.backoff(1) {
				status = engine.readFixtureTrace(baseURL)
			}
			if status != http.StatusOK {
				engine.progress("WARNING fixture trace never readable on %s (last %d after %s): its trace routes compare without the trace; is its worker projecting?\n",
					baseURL, status, time.Since(started).Round(time.Second))
				return
			}
			engine.progress("fixture trace readable on %s: %d after %s\n", baseURL, status, time.Since(started).Round(time.Second))
		})
	}
	group.Wait()
}

// traceReadingPaths mark the operations whose answer depends on the fixture
// trace having landed: the trace routes and the analytics that count it.
var traceReadingPaths = []string{"trace", "span", "analytics"}

// awaitFixtureTraceFor holds the first trace-reading operation until the
// background fixture-trace wait is over; every later one then proceeds.
func (engine *probeEngine) awaitFixtureTraceFor(operation Operation) {
	if engine.fixtureTrace == nil || engine.traceAwaited || !readsTraces(operation.Path) {
		return
	}
	engine.traceAwaited = true
	started := time.Now()
	<-engine.fixtureTrace
	engine.progress("fixture trace: %s %s waited %s for it\n", operation.Method, operation.Path, time.Since(started).Round(time.Millisecond))
}

// fixtureTraceSettled waits out the background wait before the run returns.
func (engine *probeEngine) fixtureTraceSettled() {
	if engine.fixtureTrace != nil {
		<-engine.fixtureTrace
	}
}

func readsTraces(path string) bool {
	lower := strings.ToLower(path)
	for _, marker := range traceReadingPaths {
		if strings.Contains(lower, marker) {
			return true
		}
	}
	return false
}

func (engine *probeEngine) readFixtureTrace(baseURL string) int {
	result := engine.executeOnce(probeRequest{
		baseURL: baseURL, method: http.MethodGet, path: "/api/traces/" + fixtureTraceID,
		headers: map[string]string{"X-Auth-Token": engine.options.Keys.ProjectKey},
	}, nil)
	return result.Status
}

// fixtureTraceBody is one OTLP/JSON span carrying an input and an output, so
// the trace has content every trace read can render.
func fixtureTraceBody(start time.Time) map[string]any {
	startNano := strconv.FormatInt(start.UnixNano(), 10)
	endNano := strconv.FormatInt(start.Add(time.Second).UnixNano(), 10)
	return map[string]any{"resourceSpans": []any{map[string]any{
		"resource": map[string]any{"attributes": []any{stringAttribute("service.name", "apidiff")}},
		"scopeSpans": []any{map[string]any{
			"scope": map[string]any{"name": "apidiff"},
			"spans": []any{map[string]any{
				"traceId": fixtureTraceID, "spanId": fixtureSpanID, "name": "apidiff fixture",
				"kind": 1, "startTimeUnixNano": startNano, "endTimeUnixNano": endNano,
				"attributes": []any{
					stringAttribute("langwatch.input", "apidiff question"),
					stringAttribute("langwatch.output", "apidiff answer"),
				},
			}},
		}},
	}}}
}

func stringAttribute(key, value string) map[string]any {
	return map[string]any{"key": key, "value": map[string]any{"stringValue": value}}
}

// fixtureWorkflowSQL inserts one workflow with one version into the seeded
// project. Both layouts carry identical Workflow/WorkflowVersion columns.
func fixtureWorkflowSQL() string {
	dsl := `{"spec_version":"1.4","name":"apidiff workflow","icon":"🧩","description":"apidiff","version":"1","nodes":[],"edges":[],"state":{},"template_adapter":"default","workflow_type":"workflow","enable_tracing":true}`
	return fmt.Sprintf(`INSERT INTO "Workflow" ("id", "projectId", "name", "icon", "description", "latestVersionId", "currentVersionId") VALUES
  ('%[1]s', '%[3]s', 'apidiff workflow', '🧩', 'apidiff', '%[2]s', '%[2]s')
ON CONFLICT ("id") DO NOTHING;
INSERT INTO "WorkflowVersion" ("id", "version", "commitMessage", "authorId", "projectId", "workflowId", "dsl") VALUES
  ('%[2]s', '1', 'apidiff fixture', '%[4]s', '%[3]s', '%[1]s', '%[5]s')
ON CONFLICT ("id") DO NOTHING;`, fixtureWorkflowID, fixtureWorkflowVersionID, seededProjectID, seededAdminUserID, dsl)
}
