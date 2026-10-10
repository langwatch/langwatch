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
// sides, then holds the run until each side reads the trace back. It answers
// the message the run stops on, or "" when both sides hold the trace.
func (engine *probeEngine) seedFixtures() string {
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
	unreadable := make(chan string, 1)
	go func() { unreadable <- engine.awaitFixtureTrace(accepted) }()
	engine.ingestCodingAgentLog()
	var group sync.WaitGroup
	group.Go(func() { engine.mintCLISession(engine.options.A, engine.credsA) })
	engine.mintCLISession(engine.options.B, engine.credsB)
	group.Wait()
	return <-unreadable
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
// back, both sides at once. It answers the message a run stops on when a side
// never reads it back: with no trace every trace route compares two 404s, and
// the usual cause is a worker that is not projecting.
func (engine *probeEngine) awaitFixtureTrace(baseURLs []string) string {
	started := time.Now()
	deadline := started.Add(fixtureTraceWait)
	var group sync.WaitGroup
	var mu sync.Mutex
	var unreadable []string
	for _, baseURL := range baseURLs {
		group.Go(func() {
			status := engine.pollFixtureTrace(baseURL, deadline)
			switch {
			case status == http.StatusOK:
				engine.progress("fixture trace readable on %s: %d after %s\n", baseURL, status, time.Since(started).Round(time.Second))
			case engine.ctx.Err() == nil:
				mu.Lock()
				defer mu.Unlock()
				unreadable = append(unreadable, engine.fixtureTraceUnreadable(baseURL, status, time.Since(started)))
			}
		})
	}
	group.Wait()
	sort.Strings(unreadable)
	return strings.Join(unreadable, "\n")
}

// pollFixtureTrace reads the fixture trace until it answers 200 or the
// deadline passes, and answers the last status.
func (engine *probeEngine) pollFixtureTrace(baseURL string, deadline time.Time) int {
	status := engine.readFixtureTrace(baseURL)
	for status != http.StatusOK && time.Now().Before(deadline) && engine.backoff(1) {
		status = engine.readFixtureTrace(baseURL)
	}
	return status
}

// fixtureTraceUnreadable names the side whose fixture trace never read back
// and the worker log to read next.
func (engine *probeEngine) fixtureTraceUnreadable(baseURL string, status int, waited time.Duration) string {
	side, workerLog := "base (main)", engine.options.WorkerLogB
	if baseURL == engine.options.A {
		side, workerLog = "branch", engine.options.WorkerLogA
	}
	message := fmt.Sprintf("fixture trace never readable on the %s side %s (last status %d after %s): its worker is not projecting",
		side, baseURL, status, waited.Round(time.Second))
	if workerLog != "" {
		message += "; see " + workerLog
	}
	return message
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
