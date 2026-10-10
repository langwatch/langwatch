package workerrun

import (
	"bytes"
	"compress/gzip"
	"context"
	"encoding/json"
	"fmt"
	"hash/fnv"
	"io"
	"net"
	"net/http"
	"net/url"
	"os"
	"slices"
	"strconv"
	"strings"
	"sync/atomic"
	"time"

	"github.com/langwatch/langwatch/services/telemetrysim"
)

// ingestFamilyNames are the ingestion families: telemetrysim's payloads at every door.
var ingestFamilyNames = []string{"otlp-json", "otlp-gzip", "alias", "logs", "metrics", "claude-code", "codex", "agents", "gateway", "governance-source", "refusals", "pii"}

// ingestFamilyPipelines are the worker pipelines each ingestion family's sends run through.
var ingestFamilyPipelines = map[string][]string{
	"otlp-json":         {"trace_processing"},
	"otlp-gzip":         {"trace_processing"},
	"alias":             {"trace_processing"},
	"logs":              {"log_processing"},
	"metrics":           {"metric_processing"},
	"claude-code":       {"trace_processing", "coding_agent_processing"},
	"codex":             {"trace_processing", "coding_agent_processing"},
	"agents":            {"trace_processing", "coding_agent_processing"},
	"gateway":           {"trace_processing"},
	"governance-source": {"trace_processing", "log_processing", "metric_processing"},
	"pii":               {"trace_processing"},
}

const (
	tracesPath  = "/api/otel/v1/traces"
	logsPath    = "/api/otel/v1/logs"
	metricsPath = "/api/otel/v1/metrics"
	// ingestAttempts is how often a send is tried while the door answers 503 (retryable).
	ingestAttempts = 3
	plantedEmail   = "workerrun.pii@example.com"
	plantedCard    = "4111 1111 1111 1111"
)

// retryPause is the pause before the second try after a 503, growing with each try.
var retryPause = 500 * time.Millisecond

// aliasPaths are trace paths a misconfigured exporter base sends to, all under the API route.
var aliasPaths = []string{"/api/otel/v1/traces/", "/api/otel/api/otel/v1/traces", "/api/v1/traces"}

// sessionKeys are the attributes a coding agent names its session by.
var sessionKeys = []string{"session.id", "conversation.id"}

// ingestEnv is the setup the ingestion families read from the environment.
type ingestEnv struct {
	clickhouse, sharedClickhouse string
	gatewayURL, gatewayKey       string
	sourceID, sourceKey          string
}

// shortcut: setup comes from the environment, since Options lives in workerrun.go; flags once it may change.
func readIngestEnv(lookup func(string) string) ingestEnv {
	return ingestEnv{
		clickhouse: lookup("WORKERRUN_CLICKHOUSE_URL"), sharedClickhouse: lookup("WORKERRUN_SHARED_CLICKHOUSE_URL"),
		gatewayURL: lookup("WORKERRUN_GATEWAY_URL"), gatewayKey: lookup("WORKERRUN_GATEWAY_KEY"),
		sourceID: lookup("WORKERRUN_GOVERNANCE_SOURCE"), sourceKey: lookup("WORKERRUN_GOVERNANCE_KEY"),
	}
}

// ingestItems answers every chosen ingestion family's items, with setup from the environment.
func (run *run) ingestItems() []*item { return run.ingestItemsWith(readIngestEnv(os.Getenv)) }

// ingestItemsWith answers every chosen ingestion family's items, in a fixed order.
func (run *run) ingestItemsWith(env ingestEnv) []*item {
	var items []*item
	for _, build := range []func(ingestEnv) []*item{
		run.otlpJSONItems, run.otlpGzipItems, run.aliasItems, run.logItems, run.metricItems, run.claudeCodeItems,
		run.codexItems, run.agentsItems, run.gatewayItems, run.governanceItems, run.refusalItems, run.piiItems,
	} {
		items = append(items, build(env)...)
	}
	return items
}

// presetNamed is telemetrysim's preset by name.
func presetNamed(name string) (telemetrysim.Preset, error) {
	preset, ok := telemetrysim.PresetByName(name)
	if !ok {
		return preset, fmt.Errorf("telemetrysim has no preset %q", name)
	}
	return preset, nil
}

// ingestSeed mixes the run tag and the family into the seed, so no two runs or families share an id.
func (run *run) ingestSeed(family string) uint64 {
	hash := fnv.New64a()
	_, _ = hash.Write([]byte(run.tag + "/" + family))
	return hash.Sum64() ^ uint64(run.options.Seed) // #nosec G115 -- a seed: any bits will do.
}

// buildSpec is how one item's telemetrysim batch is encoded.
type buildSpec struct {
	preset   telemetrysim.Preset
	encoding telemetrysim.Encoding
	gzip     bool
}

// built is a batch ready to send and the ids its JSON twin carries.
type built struct {
	payload telemetrysim.Payload
	ids     otlpIDs
}

// telemetryBatch builds the item's batch, marked with its wire id as a resource attribute.
func (run *run) telemetryBatch(it *item, index int, spec buildSpec) (built, error) {
	preset := spec.preset
	preset.Resource = append(slices.Clone(preset.Resource), telemetrysim.Attr{Key: "workerrun.wire", Value: it.wire})
	batch := telemetrysim.BatchSpec{Preset: preset, Seed: run.ingestSeed(it.family), Index: index, Start: run.began, Encoding: telemetrysim.EncodingJSON}
	twin, err := telemetrysim.Build(batch)
	if err != nil {
		return built{}, err
	}
	ids, err := readIDs(twin.Body)
	if err != nil {
		return built{}, err
	}
	batch.Encoding, batch.Gzip = spec.encoding, spec.gzip
	payload, err := telemetrysim.Build(batch)
	return built{payload: payload, ids: ids}, err
}

// otlpIDs are the trace id and coding-agent session id a batch carries.
type otlpIDs struct{ traceID, sessionID string }

func readIDs(body []byte) (otlpIDs, error) {
	var doc any
	if err := json.Unmarshal(body, &doc); err != nil {
		return otlpIDs{}, err
	}
	var ids otlpIDs
	walkJSON(doc, func(node map[string]any) {
		if id, ok := node["traceId"].(string); ok && ids.traceID == "" {
			ids.traceID = id
		}
		if ids.sessionID == "" {
			ids.sessionID = sessionValue(node)
		}
	})
	return ids, nil
}

func walkJSON(node any, visit func(map[string]any)) {
	switch typed := node.(type) {
	case map[string]any:
		visit(typed)
		for _, child := range typed {
			walkJSON(child, visit)
		}
	case []any:
		for _, child := range typed {
			walkJSON(child, visit)
		}
	}
}

// sessionValue is the string value of an OTLP attribute naming a session, or "".
func sessionValue(node map[string]any) string {
	key, _ := node["key"].(string)
	value, _ := node["value"].(map[string]any)
	if !slices.Contains(sessionKeys, key) || value == nil {
		return ""
	}
	text, _ := value["stringValue"].(string)
	return text
}

// encodingFor alternates protobuf and JSON by index.
func encodingFor(index int) telemetrysim.Encoding {
	if index%2 == 1 {
		return telemetrysim.EncodingJSON
	}
	return telemetrysim.EncodingProtobuf
}

// traceSend is a trace item: its preset, encoding, path, extra root attributes and extra check.
type traceSend struct {
	preset    string
	encoding  telemetrysim.Encoding
	gzip      bool
	path      string
	rootAttrs []telemetrysim.Attr
	then      func(it *item, ids otlpIDs)
}

// traceFamily answers -n items of family, each as pick says, or none when it is not chosen.
func (run *run) traceFamily(family string, pick func(index int) traceSend) []*item {
	if !run.families[family] {
		return nil
	}
	items := make([]*item, 0, run.options.N)
	for index := range run.options.N {
		it, err := run.ingestTraceItem(family, index, pick(index))
		if err != nil {
			run.setupFailed[family] = fmt.Sprintf("build: %v", err)
			return nil
		}
		items = append(items, it)
	}
	return items
}

// ingestTraceItem sends one telemetrysim trace, proven by it reading back by id with its root span.
func (run *run) ingestTraceItem(family string, index int, send traceSend) (*item, error) {
	preset, err := presetNamed(send.preset)
	if err != nil {
		return nil, err
	}
	preset = withRootAttrs(preset, send.rootAttrs)
	it := run.newItem(family, index)
	batch, err := run.telemetryBatch(it, index, buildSpec{preset: preset, encoding: send.encoding, gzip: send.gzip})
	if err != nil {
		return nil, err
	}
	run.rawFire(it, rawCall{family: family, path: send.path, payload: batch.payload})
	root := preset.Spans[0].Name
	it.check = func(ctx context.Context, r *round) (bool, string) {
		return traceLanded(run.trace(ctx, r, traceRef{family: family, id: batch.ids.traceID}), root)
	}
	if send.then != nil {
		send.then(it, batch.ids)
	}
	return it, nil
}

func withRootAttrs(preset telemetrysim.Preset, attrs []telemetrysim.Attr) telemetrysim.Preset {
	if len(attrs) == 0 || len(preset.Spans) == 0 {
		return preset
	}
	preset.Spans = slices.Clone(preset.Spans)
	preset.Spans[0].Attrs = append(slices.Clone(preset.Spans[0].Attrs), attrs...)
	return preset
}

func (run *run) otlpJSONItems(_ ingestEnv) []*item {
	return run.traceFamily("otlp-json", func(int) traceSend {
		return traceSend{preset: "llm-trace", encoding: telemetrysim.EncodingJSON, path: tracesPath}
	})
}

func (run *run) otlpGzipItems(_ ingestEnv) []*item {
	return run.traceFamily("otlp-gzip", func(int) traceSend {
		return traceSend{preset: "llm-trace", encoding: telemetrysim.EncodingProtobuf, gzip: true, path: tracesPath}
	})
}

func (run *run) aliasItems(_ ingestEnv) []*item {
	return run.traceFamily("alias", func(index int) traceSend {
		return traceSend{preset: "llm-trace", encoding: telemetrysim.EncodingProtobuf, path: aliasPaths[index%len(aliasPaths)]}
	})
}

func (run *run) claudeCodeItems(_ ingestEnv) []*item {
	return run.agentItems("claude-code", []string{"claude-code-session"})
}

func (run *run) codexItems(_ ingestEnv) []*item {
	return run.agentItems("codex", []string{"codex-session"})
}

// agentsItems are the other agents: every telemetrysim trace preset that is not Claude Code's or Codex's.
func (run *run) agentsItems(_ ingestEnv) []*item {
	var names []string
	for _, name := range telemetrysim.PresetNames() {
		preset, err := presetNamed(name)
		if err == nil && preset.Signal == telemetrysim.SignalTraces && !strings.HasPrefix(name, "claude-code") && !strings.HasPrefix(name, "codex") {
			names = append(names, name)
		}
	}
	return run.agentItems("agents", names)
}

func (run *run) agentItems(family string, presets []string) []*item {
	if run.families[family] && len(presets) == 0 {
		run.skipped[family] = "telemetrysim has no preset for it yet"
		return nil
	}
	return run.traceFamily(family, func(index int) traceSend {
		return traceSend{preset: presets[index%len(presets)], encoding: encodingFor(index), path: tracesPath, then: run.withSession}
	})
}

// withSession adds the coding-agent session read-back, when the batch names a session.
func (run *run) withSession(it *item, ids otlpIDs) {
	if ids.sessionID == "" {
		return
	}
	landed := it.check
	it.check = func(ctx context.Context, r *round) (bool, string) {
		if ok, detail := landed(ctx, r); !ok {
			return false, "trace " + detail
		}
		return run.sessionEvents(ctx, r, traceRef{family: it.family, id: ids.sessionID})
	}
}

func (run *run) piiItems(_ ingestEnv) []*item {
	planted := []telemetrysim.Attr{{Key: "langwatch.input", Value: "contact " + plantedEmail + " card " + plantedCard}}
	return run.traceFamily("pii", func(int) traceSend {
		return traceSend{preset: "llm-trace", encoding: telemetrysim.EncodingJSON, path: tracesPath, rootAttrs: planted, then: run.withoutPlanted}
	})
}

// withoutPlanted adds: once the trace reads back, neither planted value is in it.
func (run *run) withoutPlanted(it *item, ids otlpIDs) {
	landed := it.check
	it.check = func(ctx context.Context, r *round) (bool, string) {
		if ok, detail := landed(ctx, r); !ok {
			return false, detail
		}
		return plantedAbsent(string(run.trace(ctx, r, traceRef{family: it.family, id: ids.traceID}).body))
	}
}

func plantedAbsent(body string) (bool, string) {
	for _, planted := range []string{plantedEmail, plantedCard, strings.ReplaceAll(plantedCard, " ", "")} {
		if strings.Contains(body, planted) {
			return false, "stored the planted " + planted
		}
	}
	return true, ""
}

// countedSignal is a logs or metrics family: its preset, door and landing table.
type countedSignal struct{ family, preset, path, table string }

func (run *run) logItems(env ingestEnv) []*item {
	return run.countedItems(env, countedSignal{family: "logs", preset: "logs", path: logsPath, table: "log_records"})
}

func (run *run) metricItems(env ingestEnv) []*item {
	return run.countedItems(env, countedSignal{family: "metrics", preset: "metrics", path: metricsPath, table: "metric_data_points"})
}

// countedItems send -n batches, each proven by its rows counted by tenant and wire marker.
func (run *run) countedItems(env ingestEnv, signal countedSignal) []*item {
	if !run.families[signal.family] {
		return nil
	}
	targets, reason := newCHTargets(env, run.client)
	if reason != "" {
		run.skipped[signal.family] = reason
		return nil
	}
	items, err := run.countedBatches(signal, targets)
	if err != nil {
		run.setupFailed[signal.family] = fmt.Sprintf("build: %v", err)
		return nil
	}
	return items
}

func (run *run) countedBatches(signal countedSignal, targets chTargets) ([]*item, error) {
	preset, err := presetNamed(signal.preset)
	if err != nil {
		return nil, err
	}
	want := len(preset.Logs) + len(preset.Metrics)
	items := make([]*item, 0, run.options.N)
	for index := range run.options.N {
		it := run.newItem(signal.family, index)
		batch, err := run.telemetryBatch(it, index, buildSpec{preset: preset, encoding: encodingFor(index)})
		if err != nil {
			return nil, err
		}
		run.rawFire(it, rawCall{family: it.family, path: signal.path, payload: batch.payload})
		query := chCount{table: signal.table, tenant: run.projectID, marker: strconv.Quote(it.wire)}
		it.check = func(ctx context.Context, _ *round) (bool, string) { return targets.proven(ctx, query, want) }
		items = append(items, it)
	}
	return items, nil
}

func (run *run) gatewayItems(env ingestEnv) []*item {
	if !run.families["gateway"] {
		return nil
	}
	if reason := gatewayRefusal(env); reason != "" {
		run.skipped["gateway"] = reason
		return nil
	}
	return run.times(func(index int) *item { return run.gatewayItem(index, env) })
}

// gatewayRefusal says why the gateway family may not run: only a local stack has llmsim behind it.
func gatewayRefusal(env ingestEnv) string {
	if env.gatewayURL == "" || env.gatewayKey == "" {
		return "set WORKERRUN_GATEWAY_URL and WORKERRUN_GATEWAY_KEY (a virtual key on the stack)"
	}
	parsed, err := url.Parse(env.gatewayURL)
	if err != nil {
		return "WORKERRUN_GATEWAY_URL does not parse"
	}
	if !localHost(parsed.Hostname()) {
		return "the gateway is not a local stack, so llmsim may not be the provider behind it"
	}
	return ""
}

func localHost(host string) bool {
	if host == "localhost" || strings.HasSuffix(host, ".langwatch.localhost") {
		return true
	}
	ip := net.ParseIP(host)
	return ip != nil && ip.IsLoopback()
}

// gatewayItem is one chat completion with the run's traceparent, proven by its trace reading back with the prompt.
func (run *run) gatewayItem(index int, env ingestEnv) *item {
	it := run.newItem("gateway", index)
	traceID := hexID(it.wire, 32)
	prompt := "wr gateway " + it.wire
	it.fire = func(ctx context.Context) error {
		body, err := json.Marshal(map[string]any{"model": "gpt-5-mini", "messages": []any{map[string]any{"role": "user", "content": prompt}}})
		if err != nil {
			return err
		}
		return run.sendRaw(ctx, rawCall{family: it.family, origin: env.gatewayURL, path: "/v1/chat/completions", key: env.gatewayKey,
			payload: jsonPayload(body), headers: map[string]string{"traceparent": "00-" + traceID + "-" + hexID(it.wire+"/gateway", 16) + "-01"}})
	}
	it.check = func(ctx context.Context, r *round) (bool, string) {
		return traceLanded(run.trace(ctx, r, traceRef{family: it.family, id: traceID}), prompt)
	}
	return it
}

func (run *run) governanceItems(env ingestEnv) []*item {
	if !run.families["governance-source"] {
		return nil
	}
	if env.sourceID == "" || env.sourceKey == "" {
		run.skipped["governance-source"] = "set WORKERRUN_GOVERNANCE_SOURCE and WORKERRUN_GOVERNANCE_KEY (a source and its ingest key)"
		return nil
	}
	items, err := run.governanceSends(env)
	if err != nil {
		run.setupFailed["governance-source"] = fmt.Sprintf("build: %v", err)
		return nil
	}
	base := "/api/ingest/otel/" + url.PathEscape(env.sourceID)
	caps := []refusal{
		{name: "otlp-over-cap", call: rawCall{path: base, key: env.sourceKey, payload: jsonPayload(oversize(10 << 20))}, want: http.StatusRequestEntityTooLarge},
		{name: "webhook-over-cap", call: rawCall{path: "/api/ingest/webhook/" + url.PathEscape(env.sourceID), key: env.sourceKey, payload: jsonPayload(oversize(1 << 20))}, want: http.StatusRequestEntityTooLarge},
	}
	for index := range caps {
		items = append(items, run.refusalItem("governance-source", caps[index]))
	}
	return items
}

// governanceSends are -n batches across the source's trace, log and metric doors, proven by a 2xx with nothing rejected.
func (run *run) governanceSends(env ingestEnv) ([]*item, error) {
	base := "/api/ingest/otel/" + url.PathEscape(env.sourceID)
	routes := []struct{ preset, path string }{{"llm-trace", base}, {"logs", base + "/v1/logs"}, {"metrics", base + "/v1/metrics"}}
	items := make([]*item, 0, run.options.N)
	for index := range run.options.N {
		route := routes[index%len(routes)]
		preset, err := presetNamed(route.preset)
		if err != nil {
			return nil, err
		}
		it := run.newItem("governance-source", index)
		batch, err := run.telemetryBatch(it, index, buildSpec{preset: preset, encoding: encodingFor(index)})
		if err != nil {
			return nil, err
		}
		run.rawFire(it, rawCall{family: it.family, path: route.path, key: env.sourceKey, payload: batch.payload})
		it.check = func(context.Context, *round) (bool, string) { return true, "door accepted; landing not read back" }
		items = append(items, it)
	}
	return items, nil
}

// refusal is one send a door must refuse, and the status it must answer.
type refusal struct {
	name string
	call rawCall
	want int
}

func (run *run) refusalItems(_ ingestEnv) []*item {
	if !run.families["refusals"] {
		return nil
	}
	refusals, err := run.doorRefusals()
	if err != nil {
		run.setupFailed["refusals"] = fmt.Sprintf("build: %v", err)
		return nil
	}
	items := make([]*item, 0, len(refusals))
	for index := range refusals {
		items = append(items, run.refusalItem("refusals", refusals[index]))
	}
	return items
}

// doorRefusals are the project doors' refusals, one each whatever -n is: some bodies are 10 MiB.
func (run *run) doorRefusals() ([]refusal, error) {
	preset, err := presetNamed("llm-trace")
	if err != nil {
		return nil, err
	}
	batch, err := run.telemetryBatch(run.newItem("refusals", 0), 0, buildSpec{preset: preset, encoding: telemetrysim.EncodingProtobuf})
	if err != nil {
		return nil, err
	}
	bomb, err := gzipBomb(11 << 20)
	if err != nil {
		return nil, err
	}
	framed := func(contentType string) telemetrysim.Payload {
		payload := batch.payload
		payload.ContentType = contentType
		return payload
	}
	return []refusal{
		{name: "grpc-traces", call: rawCall{path: tracesPath, payload: framed("application/grpc")}, want: http.StatusUnsupportedMediaType},
		{name: "grpc-logs", call: rawCall{path: logsPath, payload: framed("application/grpc+proto")}, want: http.StatusUnsupportedMediaType},
		{name: "grpc-metrics", call: rawCall{path: metricsPath, payload: framed("application/grpc-web")}, want: http.StatusUnsupportedMediaType},
		{name: "over-cap", call: rawCall{path: tracesPath, payload: jsonPayload(oversize(10 << 20))}, want: http.StatusRequestEntityTooLarge},
		{name: "gzip-bomb", call: rawCall{path: tracesPath, payload: telemetrysim.Payload{Body: bomb, ContentType: "application/json", Gzip: true}}, want: http.StatusRequestEntityTooLarge},
		{name: "wrong-key", call: rawCall{path: tracesPath, key: "sk-lw-workerrun-not-a-key", payload: batch.payload}, want: http.StatusUnauthorized},
		{name: "malformed", call: rawCall{path: tracesPath, payload: jsonPayload([]byte(`{"resourceSpans":[`))}, want: http.StatusBadRequest},
		{name: "empty", call: rawCall{path: tracesPath, payload: jsonPayload([]byte(`{}`))}, want: http.StatusOK},
	}, nil
}

// refusalItem sends once, never retried, and is proven by the door answering the status it must.
func (run *run) refusalItem(family string, ref refusal) *item {
	it := &item{id: family + "-" + ref.name, family: family, wire: run.tag + "-" + family + "-" + ref.name}
	ref.call.family = family
	var answered atomic.Int64
	it.fire = func(ctx context.Context) error {
		status, _, err := run.doRaw(ctx, ref.call)
		answered.Store(int64(status))
		return err
	}
	it.check = func(context.Context, *round) (bool, string) {
		status := int(answered.Load())
		return status == ref.want, fmt.Sprintf("answered %d, want %d", status, ref.want)
	}
	return it
}

func oversize(limit int) []byte { return bytes.Repeat([]byte("x"), limit+1) }

func jsonPayload(body []byte) telemetrysim.Payload {
	return telemetrysim.Payload{Body: body, ContentType: "application/json"}
}

// gzipBomb is a small gzip body that inflates to size bytes.
func gzipBomb(size int) ([]byte, error) {
	var buf bytes.Buffer
	writer := gzip.NewWriter(&buf)
	_, err := writer.Write(make([]byte, size))
	if err != nil {
		return nil, err
	}
	err = writer.Close()
	return buf.Bytes(), err
}

// rawCall is one send of bytes as built: its family, origin (default the app), path, key (default the project's) and headers.
type rawCall struct {
	family, origin, path, key string
	payload                   telemetrysim.Payload
	headers                   map[string]string
}

func (run *run) rawFire(it *item, c rawCall) {
	it.fire = func(ctx context.Context) error { return run.sendRaw(ctx, c) }
}

// sendRaw sends c, again after a pause while the door answers 503, and fails on any other non-2xx or a rejection.
func (run *run) sendRaw(ctx context.Context, c rawCall) error {
	for attempt := 1; ; attempt++ {
		status, raw, err := run.doRaw(ctx, c)
		if err != nil {
			return err
		}
		if status != http.StatusServiceUnavailable || attempt >= ingestAttempts {
			return answerError(status, raw)
		}
		err = sleep(ctx, time.Duration(attempt)*retryPause)
		if err != nil {
			return err
		}
	}
}

// answerError is nil for a 2xx that rejected nothing, else what went wrong.
func answerError(status int, raw []byte) error {
	if status < 200 || status > 299 {
		return fmt.Errorf("status %d: %s", status, oneLine(string(raw)))
	}
	if rejected, message := rejectedCount(raw); rejected > 0 {
		return fmt.Errorf("rejected %d: %s", rejected, oneLine(message))
	}
	return nil
}

// rejectedCount reads a JSON OTLP answer's partialSuccess; a protobuf answer reads as none.
func rejectedCount(raw []byte) (int64, string) {
	var answer struct {
		PartialSuccess map[string]json.RawMessage `json:"partialSuccess"`
	}
	if json.Unmarshal(raw, &answer) != nil {
		return 0, ""
	}
	var total int64
	for key, value := range answer.PartialSuccess {
		if strings.HasPrefix(key, "rejected") {
			count, _ := strconv.ParseInt(strings.Trim(string(value), `"`), 10, 64)
			total += count
		}
	}
	var message string
	_ = json.Unmarshal(answer.PartialSuccess["errorMessage"], &message)
	return total, message
}

func (run *run) doRaw(ctx context.Context, c rawCall) (int, []byte, error) {
	origin := cmpOr(strings.TrimSuffix(c.origin, "/"), run.appURL)
	request, err := http.NewRequestWithContext(ctx, http.MethodPost, origin+c.path, bytes.NewReader(c.payload.Body))
	if err != nil {
		return 0, nil, err
	}
	key := cmpOr(c.key, run.key)
	request.Header.Set("Authorization", "Bearer "+key)
	request.Header.Set("X-Auth-Token", key)
	request.Header.Set("Content-Type", c.payload.ContentType)
	if c.payload.Gzip {
		request.Header.Set("Content-Encoding", "gzip")
	}
	for name, value := range c.headers {
		request.Header.Set(name, value)
	}
	response, err := run.client.Do(request)
	if err != nil {
		return 0, nil, err
	}
	defer func() { _ = response.Body.Close() }()
	raw, err := io.ReadAll(io.LimitReader(response.Body, 1<<20))
	if response.StatusCode == http.StatusBadGateway {
		run.mu.Lock()
		run.fired502[c.family]++
		run.mu.Unlock()
	}
	return response.StatusCode, raw, err
}
