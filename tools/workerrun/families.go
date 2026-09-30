package workerrun

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"hash/fnv"
	"math/rand/v2"
	"net/http"
	"net/url"
	"slices"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	"github.com/langwatch/langwatch/tools/diffkit"
)

// familyNames are the loads a run can fire, each checked in code to reach the worker.
var familyNames = []string{"otlp", "collector", "evaluation", "monitor", "annotation", "scenario", "batch", "automation", "analytics"}

// familyPipelines are the worker pipelines each family's commands run through: what drain watches.
var familyPipelines = map[string][]string{
	"otlp":       {"trace_processing"},
	"collector":  {"trace_processing"},
	"annotation": {"trace_processing"},
	"analytics":  {"trace_processing"},
	"evaluation": {"trace_processing", "evaluation_processing"},
	"monitor":    {"trace_processing", "evaluation_processing"},
	"scenario":   {"simulation_processing"},
	"batch":      {"experiment_run_processing", "evaluation_processing"},
	"automation": {"trace_processing", "automations"},
}

func knownFamily(name string) bool { return slices.Contains(familyNames, name) }

// chosen are the selected families in their fixed order.
func (run *run) chosen() []string {
	var names []string
	for _, name := range familyNames {
		if run.families[name] {
			names = append(names, name)
		}
	}
	return names
}

func (run *run) pipelines() []string {
	var names []string
	for _, family := range run.chosen() {
		for _, pipeline := range familyPipelines[family] {
			if !slices.Contains(names, pipeline) {
				names = append(names, pipeline)
			}
		}
	}
	return names
}

// item is one thing fired and proven. id is stable across runs (family-0007); wire is
// the unique id sent. An item without fire lands off source's fire, or the fire phase's end.
type item struct {
	id, family, wire string
	fire             func(ctx context.Context) error
	check            func(ctx context.Context, r *round) (bool, string)
	source           *item
	firedAt          time.Time
	fireErr          string
	fired, final     bool
	landed           bool
	landedAt         time.Time
	detail           string
}

func (run *run) newItem(family string, index int) *item {
	id := fmt.Sprintf("%s-%04d", family, index)
	return &item{id: id, family: family, wire: run.tag + "-" + id}
}

// rng is a family's own stream, so choosing families never changes another's variants.
func (run *run) rng(family string) *rand.Rand {
	hash := fnv.New64a()
	hash.Write([]byte(family))
	return rand.New(rand.NewPCG(uint64(run.options.Seed), hash.Sum64())) // #nosec G404 -- load variants, not secrets.
}

// plan sets up what families need, then answers every item in fire order.
func (run *run) plan(ctx context.Context) []*item {
	run.setupFailed, run.skipped = map[string]string{}, map[string]string{}
	collectors := run.collectorItems()
	var items []*item
	items = append(items, run.otlpItems()...)
	items = append(items, collectors...)
	items = append(items, run.evaluationItems()...)
	items = append(items, run.monitorItems(ctx, collectors)...)
	items = append(items, run.annotationItems(collectors)...)
	items = append(items, run.scenarioItems()...)
	items = append(items, run.batchItems()...)
	items = append(items, run.automationItems(ctx)...)
	items = append(items, run.analyticsItems(collectors)...)
	shuffle := rand.New(rand.NewPCG(uint64(run.options.Seed), 0)) // #nosec G404 -- fire order, not a secret.
	shuffle.Shuffle(len(items), func(a, b int) { items[a], items[b] = items[b], items[a] })
	return items
}

// times answers one item per requested index, made by build.
func (run *run) times(build func(index int) *item) []*item {
	items := make([]*item, 0, run.options.N)
	for index := range run.options.N {
		items = append(items, build(index))
	}
	return items
}

// each is times for a family, and nothing when the run did not choose it.
func (run *run) each(family string, build func(index int) *item) []*item {
	if !run.families[family] {
		return nil
	}
	return run.times(build)
}

func (run *run) otlpItems() []*item {
	rng := run.rng("otlp")
	return run.each("otlp", func(index int) *item { return run.otlpItem(index, 1+rng.IntN(5)) })
}

// collectorItems are the traces monitor, annotation and analytics build on, so any of them asks for them.
func (run *run) collectorItems() []*item {
	wanted := slices.ContainsFunc([]string{"collector", "monitor", "annotation", "analytics"}, func(name string) bool { return run.families[name] })
	if !wanted {
		return nil
	}
	rng := run.rng("collector")
	return run.times(func(index int) *item {
		it := run.newItem("collector", index)
		run.traceItem(it, run.collectorBody(collectorTrace{id: it.wire, variant: rng.IntN(20),
			metadata: map[string]any{"user_id": run.tag + "-user", "labels": []string{"workerrun"}}}))
		return it
	})
}

func (run *run) evaluationItems() []*item {
	rng := run.rng("evaluation")
	return run.each("evaluation", func(index int) *item { return run.evaluationItem(index, rng.IntN(20)) })
}

func (run *run) annotationItems(collectors []*item) []*item {
	if !run.families["annotation"] {
		return nil
	}
	items := make([]*item, 0, len(collectors))
	for index, source := range collectors {
		items = append(items, run.annotationItem(index, source))
	}
	return items
}

func (run *run) scenarioItems() []*item {
	return run.each("scenario", run.scenarioItem)
}

func (run *run) batchItems() []*item {
	rng := run.rng("batch")
	return run.each("batch", func(index int) *item { return run.batchItem(index, 1+rng.IntN(8)) })
}

func (run *run) analyticsItems(collectors []*item) []*item {
	if !run.families["analytics"] {
		return nil
	}
	return []*item{run.analyticsItem(collectors)}
}

func hexID(seed string, length int) string {
	sum := sha256.Sum256([]byte(seed))
	return hex.EncodeToString(sum[:])[:length]
}

func (run *run) otlpItem(index, spans int) *item {
	it := run.newItem("otlp", index)
	traceID := hexID(it.wire, 32)
	marker := "wr-in-" + it.wire
	run.otlpFire(it, otlpBody(it.wire, spans, nil))
	it.check = func(ctx context.Context, r *round) (bool, string) {
		return traceLanded(run.trace(ctx, r, traceRef{family: it.family, id: traceID}), marker)
	}
	return it
}

func stringAttr(key, value string) map[string]any {
	return map[string]any{"key": key, "value": map[string]any{"stringValue": value}}
}

// otlpBody is a trace of n spans for wire: the root span carries the input and output
// markers plus extra attributes, every other span is its child.
func otlpBody(wire string, spans int, extra []map[string]any) map[string]any {
	now := time.Now().UnixNano()
	var list []map[string]any
	for span := range spans {
		entry := map[string]any{
			"traceId": hexID(wire, 32), "spanId": hexID(fmt.Sprintf("%s/%d", wire, span), 16),
			"name": fmt.Sprintf("wr-otlp-%d", span), "kind": 1,
			"startTimeUnixNano": fmt.Sprint(now - int64(spans-span)*int64(time.Millisecond)*100),
			"endTimeUnixNano":   fmt.Sprint(now),
		}
		if span == 0 {
			entry["attributes"] = append([]map[string]any{
				stringAttr("langwatch.input", "wr-in-"+wire), stringAttr("langwatch.output", "wr-out-"+wire),
			}, extra...)
		} else {
			entry["parentSpanId"] = hexID(wire+"/0", 16)
		}
		list = append(list, entry)
	}
	return map[string]any{"resourceSpans": []any{map[string]any{
		"resource":   map[string]any{"attributes": []any{stringAttr("service.name", "workerrun")}},
		"scopeSpans": []any{map[string]any{"scope": map[string]any{"name": "workerrun"}, "spans": list}},
	}}}
}

func (run *run) otlpFire(it *item, body map[string]any) {
	it.fire = func(ctx context.Context) error {
		_, err := run.send(ctx, post(it.family, "/api/otel/v1/traces", body))
		return err
	}
}

// onePixel is a 1x1 PNG, the inline image a multimodal trace carries.
const onePixel = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII="

// collectorTrace is what a collector body needs: the trace id, the input variant, the
// trace metadata and any SDK evaluations.
type collectorTrace struct {
	id          string
	variant     int
	metadata    map[string]any
	evaluations []map[string]any
}

// collectorBody is a two-span trace answering "wr answer <traceID>". Variant 0 of 20
// is oversized (256 KiB input), 1 and 2 multimodal, the rest plain text.
func (run *run) collectorBody(trace collectorTrace) map[string]any {
	traceID, variant := trace.id, trace.variant
	question := "wr question " + traceID
	input := map[string]any{"type": "text", "value": question}
	switch {
	case variant == 0:
		input["value"] = question + " " + strings.Repeat("lorem ipsum ", 256<<10/12)
	case variant <= 2:
		input = map[string]any{"type": "chat_messages", "value": []any{map[string]any{"role": "user", "content": []any{
			map[string]any{"type": "text", "text": question},
			map[string]any{"type": "image_url", "image_url": map[string]any{"url": onePixel}},
		}}}}
	}
	output := map[string]any{"type": "text", "value": "wr answer " + traceID}
	now := time.Now().UnixMilli()
	root := traceID + "-root"
	body := map[string]any{
		"trace_id": traceID,
		"spans": []any{
			map[string]any{"type": "chain", "span_id": root, "trace_id": traceID, "name": "wr-root", "input": input, "output": output,
				"timestamps": map[string]any{"started_at": now - 500, "finished_at": now}},
			map[string]any{"type": "llm", "span_id": traceID + "-llm", "parent_id": root, "trace_id": traceID, "name": "wr-llm",
				"model": "gpt-5", "vendor": "openai", "input": input, "output": output,
				"timestamps": map[string]any{"started_at": now - 400, "finished_at": now - 100}},
		},
		"metadata": trace.metadata,
	}
	if len(trace.evaluations) > 0 {
		body["evaluations"] = trace.evaluations
	}
	return body
}

// traceItem fires body to the collector and proves the trace reads back with its answer.
func (run *run) traceItem(it *item, body map[string]any) {
	it.fire = func(ctx context.Context) error {
		_, err := run.send(ctx, post(it.family, "/api/collector", body))
		return err
	}
	it.check = func(ctx context.Context, r *round) (bool, string) {
		return traceLanded(run.trace(ctx, r, traceRef{family: it.family, id: it.wire}), "wr answer "+it.wire)
	}
}

// evaluationItem is a trace carrying an SDK evaluation (every other one a guardrail),
// proven by the evaluation reading back on the trace as processed.
func (run *run) evaluationItem(index, variant int) *item {
	it := run.newItem("evaluation", index)
	name := "wr-eval-" + it.wire
	evaluation := map[string]any{"name": name, "status": "processed", "passed": true, "score": 1, "label": "ok",
		"details": "workerrun", "is_guardrail": index%2 == 1}
	run.traceItem(it, run.collectorBody(collectorTrace{id: it.wire, variant: variant,
		metadata: map[string]any{"user_id": run.tag + "-eval"}, evaluations: []map[string]any{evaluation}}))
	it.check = func(ctx context.Context, r *round) (bool, string) {
		fetched := run.trace(ctx, r, traceRef{family: it.family, id: it.wire})
		if ok, detail := traceLanded(fetched, it.wire); !ok {
			return false, detail
		}
		for _, entry := range fetched.evaluations() {
			if entry["name"] == name {
				status, _ := entry["status"].(string)
				return status == "processed", "evaluation " + status
			}
		}
		return false, "trace without its evaluation"
	}
	return it
}

// monitorItems set up an evaluator and a monitor on the project, then prove every
// collector trace gets an evaluation from it in a terminal status. langevals runs it.
func (run *run) monitorItems(ctx context.Context, collectors []*item) []*item {
	if !run.families["monitor"] {
		return nil
	}
	if run.langevals == "down" {
		run.skipped["monitor"] = "langevals is not running on " + run.slug + " (start the stack with +langevals)"
		return nil
	}
	refs, ok := run.createMonitor(ctx)
	if !ok {
		return nil
	}
	run.monitor = refs
	items := make([]*item, 0, len(collectors))
	for index, source := range collectors {
		items = append(items, run.monitorItem(index, source))
	}
	return items
}

// createMonitor makes the evaluator and the monitor that runs it, and queues their teardown.
func (run *run) createMonitor(ctx context.Context) (monitorRefs, bool) {
	name := run.tag + "-monitor"
	evaluatorID, err := run.create(ctx, post("monitor", "/api/evaluators",
		map[string]any{"name": name, "config": map[string]any{"evaluatorType": "langevals/basic"}}))
	if err != nil {
		run.setupFailed["monitor"] = fmt.Sprintf("create evaluator: %v", err)
		return monitorRefs{}, false
	}
	run.teardown = append(run.teardown, "/api/evaluators/"+url.PathEscape(evaluatorID))
	monitorID, err := run.create(ctx, post("monitor", "/api/monitors",
		map[string]any{"name": name, "checkType": "langevals/basic", "evaluatorId": evaluatorID, "parameters": map[string]any{}, "sample": 1}))
	if err != nil {
		run.setupFailed["monitor"] = fmt.Sprintf("create monitor: %v", err)
		return monitorRefs{}, false
	}
	// The monitor goes before the evaluator, so it never outlives what it runs.
	run.teardown = append([]string{"/api/monitors/" + url.PathEscape(monitorID)}, run.teardown...)
	return monitorRefs{id: monitorID, evaluatorID: evaluatorID, name: name}, true
}

func (run *run) monitorItem(index int, source *item) *item {
	it := run.newItem("monitor", index)
	it.source = source
	it.check = func(ctx context.Context, r *round) (bool, string) {
		fetched := run.trace(ctx, r, traceRef{family: it.family, id: source.wire})
		if ok, detail := traceLanded(fetched, source.wire); !ok {
			return false, "trace " + detail
		}
		return run.monitor.evaluated(fetched)
	}
	return it
}

// evaluated is whether the trace carries an evaluation from the monitor in a terminal status.
func (m monitorRefs) evaluated(f fetched) (bool, string) {
	for _, entry := range f.evaluations() {
		if entry["evaluator_id"] == m.id || entry["evaluator_id"] == m.evaluatorID || entry["name"] == m.name {
			status, _ := entry["status"].(string)
			return status == "processed" || status == "error" || status == "skipped", "evaluation " + status
		}
	}
	return false, "no evaluation from the monitor"
}

// create sends a write and answers the id of what it made.
func (run *run) create(ctx context.Context, c call) (string, error) {
	raw, err := run.send(ctx, c)
	id := field(raw, "id")
	if err == nil && id == "" {
		err = errors.New("the answer carried no id")
	}
	return id, err
}

// annotationItem annotates a collector trace. The trace pipeline records it, but no
// public read shows that marker, so read-back proves only the annotation itself.
func (run *run) annotationItem(index int, source *item) *item {
	it := run.newItem("annotation", index)
	comment := "wr-note-" + it.wire
	it.fire = func(ctx context.Context) error {
		_, err := run.send(ctx, post(it.family, "/api/annotations/trace/"+url.PathEscape(source.wire),
			map[string]any{"comment": comment, "isThumbsUp": index%2 == 0, "email": "workerrun@mail.langwatch.localhost"}))
		return err
	}
	it.check = func(ctx context.Context, r *round) (bool, string) {
		return bodyHas(run.get(ctx, it.family, "/api/annotations/trace/"+url.PathEscape(source.wire)))(comment)
	}
	return it
}

// scenarioItem is one simulation run, started then finished, proven by the run reading back SUCCESS.
func (run *run) scenarioItem(index int) *item {
	it := run.newItem("scenario", index)
	ids := map[string]any{"batchRunId": run.tag + "-batch", "scenarioId": "wr-scenario", "scenarioRunId": it.wire, "scenarioSetId": run.tag + "-set"}
	event := func(fields map[string]any) map[string]any {
		for key, value := range ids {
			fields[key] = value
		}
		return fields
	}
	it.fire = func(ctx context.Context) error {
		now := time.Now().UnixMilli()
		started := event(map[string]any{"type": "SCENARIO_RUN_STARTED", "timestamp": now,
			"metadata": map[string]any{"name": it.wire, "description": "workerrun",
				"langwatch": map[string]any{"targetReferenceId": "workerrun", "targetType": "http"}}})
		if _, err := run.send(ctx, post(it.family, "/api/scenario-events", started)); err != nil {
			return err
		}
		finished := event(map[string]any{"type": "SCENARIO_RUN_FINISHED", "timestamp": now + 1000, "status": "SUCCESS",
			"results": map[string]any{"verdict": "success", "reasoning": "workerrun", "metCriteria": []string{"c"}, "unmetCriteria": []string{}}})
		_, err := run.send(ctx, post(it.family, "/api/scenario-events", finished))
		return err
	}
	it.check = func(ctx context.Context, r *round) (bool, string) {
		return bodyHas(run.get(ctx, it.family, "/api/simulation-runs/"+url.PathEscape(it.wire)))("SUCCESS")
	}
	return it
}

// batchItem logs one batch evaluation run of rows rows, proven by the run listed under the run's experiment.
func (run *run) batchItem(index, rows int) *item {
	it := run.newItem("batch", index)
	slug := run.tag + "-batch"
	dataset := make([]map[string]any, 0, rows)
	evaluations := make([]map[string]any, 0, rows)
	for row := range rows {
		dataset = append(dataset, map[string]any{"index": row, "entry": map[string]any{"input": fmt.Sprintf("q%d", row)},
			"predicted": map[string]any{"output": fmt.Sprintf("q%d", row)}})
		evaluations = append(evaluations, map[string]any{"evaluator": "exact_match", "status": "processed", "index": row, "score": 1, "passed": true})
	}
	body := map[string]any{"run_id": it.wire, "experiment_slug": slug, "name": slug, "dataset": dataset, "evaluations": evaluations}
	it.fire = func(ctx context.Context) error {
		_, err := run.send(ctx, post(it.family, "/api/evaluations/batch/log_results", body))
		return err
	}
	it.check = func(ctx context.Context, r *round) (bool, string) {
		return bodyHas(r.fetch("batch runs", func() (int, []byte, error) {
			return run.pages(ctx, pager{family: it.family, path: func(page int) string {
				return fmt.Sprintf("/api/experiments/runs?experimentSlug=%s&pageSize=200&page=%d", url.QueryEscape(slug), page)
			}, more: func(raw []byte) bool {
				var listed struct {
					Runs []json.RawMessage `json:"runs"`
				}
				return json.Unmarshal(raw, &listed) == nil && len(listed.Runs) == 200
			}})
		}))(`"` + it.wire + `"`)
	}
	return it
}

// automationItems set up a dataset and an ADD_TO_DATASET trigger on a run label, then
// prove every labeled trace is appended to the dataset by the automation.
func (run *run) automationItems(ctx context.Context) []*item {
	if !run.families["automation"] {
		return nil
	}
	target := autoTarget{label: run.tag + "-auto"}
	var ok bool
	if target.slug, ok = run.createAutomation(ctx, target.label); !ok {
		return nil
	}
	rng := run.rng("automation")
	return run.times(func(index int) *item { return run.automationItem(index, 1+rng.IntN(5), target) })
}

// autoTarget is the label a trigger filters on and the dataset it appends to.
type autoTarget struct{ label, slug string }

// createAutomation makes the dataset and the trigger, queues their teardown, and answers the dataset slug.
func (run *run) createAutomation(ctx context.Context, name string) (string, bool) {
	raw, err := run.send(ctx, post("automation", "/api/dataset", map[string]any{"name": name,
		"columnTypes": []any{map[string]any{"name": "trace_id", "type": "string"}, map[string]any{"name": "input", "type": "string"}}}))
	datasetID, slug := field(raw, "id"), field(raw, "slug")
	if err != nil || datasetID == "" || slug == "" {
		run.setupFailed["automation"] = fmt.Sprintf("create dataset: %v", err)
		return "", false
	}
	run.autoSlug = slug
	run.teardown = append(run.teardown, "/api/dataset/"+url.PathEscape(slug))
	triggerID, err := run.create(ctx, post("automation", "/api/triggers", map[string]any{
		"name": name, "action": "ADD_TO_DATASET", "filters": map[string]any{"metadata.labels": []string{name}},
		"actionParams": map[string]any{"datasetId": datasetID, "datasetMapping": map[string]any{
			"mapping":    map[string]any{"trace_id": map[string]any{"source": "trace_id"}, "input": map[string]any{"source": "input"}},
			"expansions": []string{},
		}},
	}))
	if err != nil {
		run.setupFailed["automation"] = fmt.Sprintf("create trigger: %v", err)
		return "", false
	}
	run.teardown = append([]string{"/api/triggers/" + url.PathEscape(triggerID)}, run.teardown...)
	return slug, true
}

// automationItem sends a trace through OTLP with its origin and the run label. The collector
// stamps no origin, so the trigger would only see its trace after the 5 minute fallback.
func (run *run) automationItem(index, spans int, target autoTarget) *item {
	it := run.newItem("automation", index)
	traceID := hexID(it.wire, 32)
	run.otlpFire(it, otlpBody(it.wire, spans, []map[string]any{
		stringAttr("langwatch.origin", "application"), stringAttr("langwatch.labels", fmt.Sprintf("[%q]", target.label)),
	}))
	it.check = func(ctx context.Context, r *round) (bool, string) {
		return bodyHas(r.fetch("automation rows", func() (int, []byte, error) {
			return run.datasetRows(ctx, it.family, target.slug)
		}))(traceID)
	}
	return it
}

// datasetRows is every record of the dataset, page by page.
func (run *run) datasetRows(ctx context.Context, family, slug string) (int, []byte, error) {
	return run.pages(ctx, pager{family: family, path: func(page int) string {
		return fmt.Sprintf("/api/dataset/%s/records?page=%d&limit=50", url.PathEscape(slug), page)
	}, more: func(raw []byte) bool {
		var listed struct {
			Pagination struct {
				Page       int `json:"page"`
				TotalPages int `json:"totalPages"`
			} `json:"pagination"`
		}
		return json.Unmarshal(raw, &listed) == nil && listed.Pagination.Page < listed.Pagination.TotalPages
	}})
}

// analyticsItem proves the trace rollup counts every collector trace fired, once the fire phase ended.
func (run *run) analyticsItem(collectors []*item) *item {
	it := &item{id: "analytics-collector", family: "analytics", wire: run.tag + "-user"}
	it.check = func(ctx context.Context, r *round) (bool, string) {
		run.mu.Lock()
		want := 0
		for _, source := range collectors {
			if source.fired && source.fireErr == "" {
				want++
			}
		}
		run.mu.Unlock()
		status, raw, err := run.do(ctx, post(it.family, "/api/analytics/timeseries", map[string]any{
			"startDate": run.began.Add(-time.Hour).UnixMilli(), "endDate": time.Now().Add(time.Hour).UnixMilli(),
			"series":   []any{map[string]any{"metric": "metadata.trace_id", "aggregation": "cardinality"}},
			"timeZone": "UTC", "timeScale": "full", "filters": map[string]any{"metadata.user_id": []string{it.wire}},
		}))
		if err != nil || status != http.StatusOK {
			return false, fmt.Sprintf("analytics status %d %v", status, err)
		}
		got := bucketTotal(raw)
		return got == want, fmt.Sprintf("counted %d of %d traces", got, want)
	}
	return it
}

// bucketTotal sums every numeric value of every current bucket: one series, so its count.
func bucketTotal(raw []byte) int {
	var answer struct {
		CurrentPeriod []map[string]any `json:"currentPeriod"`
	}
	if json.Unmarshal(raw, &answer) != nil {
		return -1
	}
	total := 0.0
	for _, bucket := range answer.CurrentPeriod {
		for key, value := range bucket {
			if number, ok := value.(float64); ok && key != "date" {
				total += number
			}
		}
	}
	return int(total)
}

// fetched is one GET's answer, shared by every check that reads it in a round.
type fetched struct {
	status int
	body   []byte
	err    error
}

func (f fetched) evaluations() []map[string]any {
	var trace struct {
		Evaluations []map[string]any `json:"evaluations"`
	}
	_ = json.Unmarshal(f.body, &trace)
	return trace.Evaluations
}

// traceRef names a trace to read, and the family whose request it is.
type traceRef struct{ family, id string }

func (run *run) trace(ctx context.Context, r *round, ref traceRef) fetched {
	status, body, err := r.fetch("trace "+ref.id, func() (int, []byte, error) {
		return run.get(ctx, ref.family, "/api/traces/"+url.PathEscape(ref.id))
	})
	return fetched{status, body, err}
}

func traceLanded(f fetched, marker string) (bool, string) {
	return bodyHas(f.status, f.body, f.err)(marker)
}

// bodyHas answers a check: a 200 whose body contains marker.
func bodyHas(status int, body []byte, err error) func(marker string) (bool, string) {
	return func(marker string) (bool, string) {
		switch {
		case err != nil:
			return false, oneLine(err.Error())
		case status != http.StatusOK:
			return false, fmt.Sprintf("status %d", status)
		case !strings.Contains(string(body), marker):
			return false, "answered without it"
		}
		return true, ""
	}
}

// pager reads a listing: path answers page n's route, more says whether the page was full.
type pager struct {
	family string
	path   func(page int) string
	more   func([]byte) bool
}

// pages GETs page 1, 2, ... while more says the page was full, and answers the bodies joined.
func (run *run) pages(ctx context.Context, p pager) (int, []byte, error) {
	var joined []byte
	for page := 1; page <= 100; page++ {
		status, raw, err := run.get(ctx, p.family, p.path(page))
		if err != nil || status != http.StatusOK {
			return status, joined, err
		}
		joined = append(joined, raw...)
		if !p.more(raw) {
			break
		}
	}
	return http.StatusOK, joined, nil
}

func post(family, path string, body any) call {
	return call{family: family, method: http.MethodPost, path: path, body: body}
}

func field(raw []byte, name string) string {
	var object map[string]any
	_ = json.Unmarshal(raw, &object)
	value, _ := object[name].(string)
	return value
}

// round is one read-back pass; fetch runs each distinct GET once per pass.
type round struct {
	mu      sync.Mutex
	entries map[string]*roundEntry
}

type roundEntry struct {
	once   sync.Once
	status int
	body   []byte
	err    error
}

func (r *round) fetch(key string, load func() (int, []byte, error)) (int, []byte, error) {
	r.mu.Lock()
	if r.entries == nil {
		r.entries = map[string]*roundEntry{}
	}
	entry := r.entries[key]
	if entry == nil {
		entry = &roundEntry{}
		r.entries[key] = entry
	}
	r.mu.Unlock()
	entry.once.Do(func() { entry.status, entry.body, entry.err = load() })
	return entry.status, entry.body, entry.err
}

// fireAll fires the first half as fast as concurrency allows (burst), the rest
// at SteadyRate a second (steady), each in its own goroutine slot.
func (run *run) fireAll(ctx context.Context, items []*item) {
	fireable := slices.DeleteFunc(slices.Clone(items), func(it *item) bool { return it.fire == nil })
	var sent sync.WaitGroup
	queue := make(chan *item)
	for range run.options.Concurrency {
		sent.Go(func() { run.fireWorker(ctx, queue) })
	}
	var done atomic.Int64
	stop := diffkit.StartTicker(run.out, "worker fire:", len(fireable), func() (int, string) {
		count := int(done.Load())
		if count < len(fireable)/2 {
			return count, "burst"
		}
		return count, "steady"
	})
	run.feed(ctx, fireable, feeding{queue: queue, done: &done})
	close(queue)
	sent.Wait()
	stop()
	run.mu.Lock()
	run.fireEnded = time.Now()
	run.mu.Unlock()
}

func (run *run) fireWorker(ctx context.Context, queue <-chan *item) {
	for it := range queue {
		began := time.Now()
		err := it.fire(ctx)
		run.mu.Lock()
		it.fired, it.firedAt = true, began
		if err != nil {
			it.fireErr = oneLine(err.Error())
		}
		run.mu.Unlock()
	}
}

// feeding is where feed sends items and counts them.
type feeding struct {
	queue chan<- *item
	done  *atomic.Int64
}

// feed hands the workers one item at a time, pacing the second half; it stops when ctx ends.
func (run *run) feed(ctx context.Context, fireable []*item, to feeding) {
	for index, it := range fireable {
		if run.paced(ctx, index, len(fireable)) != nil {
			return
		}
		select {
		case to.queue <- it:
			to.done.Store(int64(index + 1))
		case <-ctx.Done():
		}
		if ctx.Err() != nil {
			return
		}
	}
}

// paced waits one steady-rate interval before an item in the second half, and returns at once before it.
func (run *run) paced(ctx context.Context, index, total int) error {
	if index < total/2 || run.options.SteadyRate <= 0 {
		return nil
	}
	return sleep(ctx, time.Duration(float64(time.Second)/run.options.SteadyRate))
}

// start is when an item's clock began, or zero with a reason when it never will.
func (run *run) start(it *item) (time.Time, string) {
	switch {
	case it.fire != nil && it.fired && it.fireErr != "":
		return time.Time{}, "fire " + it.fireErr
	case it.fire != nil:
		return it.firedAt, ""
	case it.source != nil && it.source.fired && it.source.fireErr != "":
		return time.Time{}, "its trace was refused: " + it.source.fireErr
	case it.source != nil:
		return it.source.firedAt, ""
	}
	return run.fireEnded, ""
}

// readBack polls every fired, unproven item each round (at most every 2s) until
// all are proven or past their deadline, and the fire phase has ended.
func (run *run) readBack(ctx context.Context, items []*item, firing <-chan struct{}) {
	slots := make(chan struct{}, run.options.Concurrency)
	landed := 0
	stop := diffkit.StartTicker(run.out, "worker landed:", len(items), func() (int, string) {
		run.mu.Lock()
		defer run.mu.Unlock()
		return landed, ""
	})
	defer stop()
	for ctx.Err() == nil {
		began := time.Now()
		pending, finished := run.pending(items, firing)
		if finished {
			return
		}
		r := &round{}
		var checks sync.WaitGroup
		for _, it := range pending {
			slots <- struct{}{}
			checks.Go(func() {
				defer func() { <-slots }()
				ok, detail := it.check(ctx, r)
				run.mu.Lock()
				defer run.mu.Unlock()
				it.detail = detail
				if ok {
					it.landed, it.final, it.landedAt = true, true, time.Now()
					landed++
				}
			})
		}
		checks.Wait()
		_ = sleep(ctx, time.Until(began.Add(2*time.Second)))
	}
}

// pending finalizes items that can no longer land and answers the rest, and
// whether the read-back is over.
func (run *run) pending(items []*item, firing <-chan struct{}) ([]*item, bool) {
	fireOver := false
	select {
	case <-firing:
		fireOver = true
	default:
	}
	run.mu.Lock()
	defer run.mu.Unlock()
	var pending []*item
	open := false
	for _, it := range items {
		if it.final {
			continue
		}
		began, refused := run.start(it)
		switch {
		case refused != "":
			it.final, it.detail = true, refused
		case began.IsZero() && fireOver:
			it.final, it.detail = true, "never fired"
		case began.IsZero():
			open = true
		case time.Since(began) > run.options.Deadline:
			it.final, it.detail = true, fmt.Sprintf("missing after %s: %s", run.options.Deadline, it.detail)
		default:
			pending = append(pending, it)
		}
	}
	return pending, fireOver && !open && len(pending) == 0
}
