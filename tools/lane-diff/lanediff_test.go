package lanediff

import (
	"strings"
	"testing"
)

func keys(reg Registry) []string {
	var out []string
	for _, l := range reg.Lanes {
		out = append(out, l.Key())
	}
	return out
}

func has(list []string, want string) bool {
	for _, v := range list {
		if v == want {
			return true
		}
	}
	return false
}

func TestSplitTopLevelIgnoresNestedCommasStringsAndComments(t *testing.T) {
	got := splitTopLevel(`"a,b", f(x, y), { k: [1, 2] }, ` + "`t${q(1, 2)}`")
	if len(got) != 4 {
		t.Fatalf("want 4 parts, got %d: %q", len(got), got)
	}
	if stripped := stripComments("a // b, c\n/* d,\ne */ f"); strings.Contains(stripped, "b") || lineOf(stripped, strings.Index(stripped, "f")) != 3 {
		t.Fatalf("comments not blanked with lines kept: %q", stripped)
	}
}

func TestExtractReadsTheMainBuilder(t *testing.T) {
	tree := Tree{
		"platform/app/src/names.ts": `export const PIPE = "trace_processing" as const;
export const PM_NAME = "reap";`,
		"platform/app/src/pipeline.ts": `
const SUB = "originGate";
export function build() {
  let b = definePipeline<E>()
    .withName(PIPE)
    .withFoldProjection("traceSummary", fold)
    .withMapProjection("spanStorage", map)
    .withSubscriber(SUB, { fold: "traceSummary", handle })
    .withSubscriber("plain", { handle })
    .withEventSubscriber("sync", sync)
    .withCommand<P, T>("recordSpan", RecordSpan);
  b = b.withProcessManager(PM_NAME, (pm) => pm.state({ name: "nope" }));
  return b;
}`,
	}
	reg := Extract(tree)
	got := keys(reg)
	for _, want := range []string{
		"trace_processing:projection:traceSummary",
		"trace_processing:handler:spanStorage",
		"trace_processing:reactor:originGate",
		"trace_processing:subscriber:plain",
		"trace_processing:subscriber:sync",
		"trace_processing:command:recordSpan",
		"trace_processing:subscriber:pm:reap",
	} {
		if !has(got, want) {
			t.Errorf("missing %s in %v", want, got)
		}
	}
	if reg.Pipelines["trace_processing"] == "" || len(reg.ProcessManagers) != 1 {
		t.Fatalf("pipelines %v, process managers %v", reg.Pipelines, reg.ProcessManagers)
	}
}

func TestExtractReadsTheHeadBuilderThroughClassesFactoriesAndPeers(t *testing.T) {
	tree := Tree{
		"modules/x/summary.projection.ts": `export const SUMMARY = "traceSummary";
export class SummaryFold {
  readonly name = SUMMARY;
  static create(deps: Deps) { return new SummaryFold(deps); }
}`,
		"modules/x/scope.ts": `export function scopeFold(store: S) {
  return { fold: new ScopeFold(store), events: [] };
}
export class ScopeFold {
  static readonly name = "projectScope";
}`,
		"modules/x/x.pipeline.ts": `
export function host(options: Options) {
  return definePipeline({
    name: "trace_processing",
    aggregate: defineAggregate({ type: "trace" }),
  })
    .withClickHouseFoldProjection(SummaryFold.create({ store }).build())
    .withPostgresProjection({ name: "state", apply })
    .withCommandInstance({ name: "recordSpan", handler })
    .withProjectionSubscriber("broadcast", { fold: "traceSummary" })
    .withPeerSubscriber("billing", { events })
    .withPeerFoldProjection(scopeFold(store))
    .withUpcasts({ pipeline: "trace_processing", drain: { pipeline: "old_trace", jobNames: { originGate: "deferred" } } });
}`,
	}
	reg := Extract(tree)
	got := keys(reg)
	for _, want := range []string{
		"trace_processing:projection:traceSummary",
		"trace_processing:stateProjection:state",
		"trace_processing:command:recordSpan",
		"trace_processing:reactor:broadcast",
		"global:subscriber:trace_processing.billing",
		"global:projection:trace_processing.projectScope",
	} {
		if !has(got, want) {
			t.Errorf("missing %s in %v", want, got)
		}
	}
	if len(reg.Drains) != 1 || reg.Drains[0].Former != "old_trace" || reg.Drains[0].JobNames["originGate"] != "deferred" {
		t.Fatalf("drain not read: %+v", reg.Drains)
	}
}

func TestExtractLeavesLoopVariablesUnresolved(t *testing.T) {
	tree := Tree{
		"a.ts": `export const name = "Unrelated";`,
		"p.ts": `const b = definePipeline({ name: "logs" });
for (const subscriber of deps.subscribers) { b.withEventSubscriber(subscriber.name, subscriber); }`,
	}
	reg := Extract(tree)
	if len(reg.Lanes) != 1 || !reg.Lanes[0].Unresolved || reg.Lanes[0].Key() != "logs:subscriber:?subscriber.name" {
		t.Fatalf("want one unresolved lane, got %+v", reg.Lanes)
	}
}

func TestApplyAttributesAnchorlessFilesAndExpandsDynamicDeclarations(t *testing.T) {
	reg := Registry{Lanes: []Lane{
		{Pipeline: "?consumer.ts", JobType: "reactor", Name: "broadcast", Unresolved: true},
		{Pipeline: "logs", JobType: "subscriber", Name: "?subscriber.name", Unresolved: true},
	}}
	got := keys(Apply(reg, Classification{
		Pipelines: map[string]string{"consumer.ts": "trace_processing"},
		Names:     map[string]Expansion{"logs:subscriber:?subscriber.name": {Names: []string{"a", "b"}}},
	}))
	want := []string{"trace_processing:reactor:broadcast", "logs:subscriber:a", "logs:subscriber:b"}
	if strings.Join(got, ",") != strings.Join(want, ",") {
		t.Fatalf("got %v, want %v", got, want)
	}
}

func TestDiffClassifiesEveryBaseOnlyItem(t *testing.T) {
	base := Registry{
		Pipelines: map[string]string{"old": "a.ts", "trace": "t.ts"},
		Lanes: []Lane{
			{Pipeline: "trace", JobType: "projection", Name: "summary"},
			{Pipeline: "old", JobType: "reactor", Name: "gate"},
			{Pipeline: "trace", JobType: "subscriber", Name: "kpis"},
			{Pipeline: "trace", JobType: "subscriber", Name: "sync"},
			{Pipeline: "trace", JobType: "subscriber", Name: "alerts"},
		},
		ProcessManagers: []ProcessManager{{Pipeline: "old", Name: "reap"}},
		EventTypes:      map[string]bool{"lw.trace.span_received": true},
	}
	head := Registry{
		Pipelines: map[string]string{"trace": "t.ts", "keys": "k.ts"},
		Lanes: []Lane{
			{Pipeline: "trace", JobType: "projection", Name: "summary"},
			{Pipeline: "trace", JobType: "reactor", Name: "deferred"},
			{Pipeline: "global", JobType: "subscriber", Name: "nurturing.sync"},
		},
		ProcessManagers: []ProcessManager{{Pipeline: "keys", Name: "reap"}},
		Drains:          []Drain{{Former: "old", Current: "trace", JobNames: map[string]string{"gate": "deferred"}}},
		EventTypes:      map[string]bool{"lw.trace.span_received": true, "lw.project.created": true},
	}
	res := Diff(base, head, []Rule{
		{Match: "trace:subscriber:kpis", Class: "catch-up", Ref: "Q03"},
		{Match: "process:old:*", Class: "tombstone", Ref: "Q04"},
		{Match: "never:matches", Class: "none"},
	})
	if res.Kept != 1 {
		t.Errorf("kept %d", res.Kept)
	}
	classes := map[string]string{}
	successors := map[string]string{}
	for _, it := range append(append(res.RemovedLanes, res.RemovedProcesses...), res.RemovedPipelines...) {
		classes[it.Key] = it.Class
		successors[it.Key] = it.Successor
	}
	for key, want := range map[string]string{
		"old:reactor:gate":        "drained",
		"trace:subscriber:kpis":   "catch-up",
		"trace:subscriber:sync":   "UNCLASSIFIED",
		"trace:subscriber:alerts": "UNCLASSIFIED",
		"process:old:reap":        "tombstone",
		"pipeline:old":            "UNCLASSIFIED",
	} {
		if classes[key] != want {
			t.Errorf("%s: class %q, want %q", key, classes[key], want)
		}
	}
	if successors["trace:subscriber:sync"] != "global:subscriber:nurturing.sync" {
		t.Errorf("moved lane successor %q", successors["trace:subscriber:sync"])
	}
	if res.Unclassified() != 3 || len(res.UnusedRules) != 1 || len(res.AddedEventTypes) != 1 {
		t.Errorf("unclassified %d, unused rules %d, added events %v", res.Unclassified(), len(res.UnusedRules), res.AddedEventTypes)
	}
	var out strings.Builder
	Render(&out, Report{Result: res, BaseRegistry: base, HeadRegistry: head})
	if !strings.Contains(out.String(), "| `trace:subscriber:kpis` |") || !strings.Contains(out.String(), "never:matches") {
		t.Errorf("report lacks a classified row or the unused rule:\n%s", out.String())
	}
}

func TestIncludedSkipsTestsBuildOutputAndOtherRuntimes(t *testing.T) {
	for path, want := range map[string]bool{
		"modules/trace/process/src/eventing/trace.pipeline.ts":            true,
		"modules/trace/process/src/eventing/__tests__/trace.unit.test.ts": false,
		"modules/trace/process/dist/eventing/trace.pipeline.d.ts":         false,
		"sdks/typescript/src/index.ts":                                    false,
		"packages/eventing/src/pipeline/staticBuilder.ts":                 false,
		"apps/ui/src/main.tsx":                                            false,
	} {
		if Included(path) != want {
			t.Errorf("Included(%q) = %v", path, !want)
		}
	}
}

func TestExtractReadsGlobalMapProjectionsAndTheirSubscribers(t *testing.T) {
	main := Extract(Tree{
		"meter.ts": `export const meter = { name: "orgBillableEventsMeter", map };
export function dispatch() { return { name: "billingMeterDispatch", handle }; }`,
		"es.ts": `import { meter, dispatch } from "./meter";
this.projectionRegistry.registerMapProjection(meter);
this.projectionRegistry.registerMapSubscriber("orgBillableEventsMeter", dispatch());
this.router.registerMapProjection(other);`,
	})
	head := Extract(Tree{
		"count.ts": `const COUNT = "usageMeterCount";
export function usageMeterCountSubscriber(deps: D) { return { name: COUNT, handle }; }`,
		"usage.pipeline.ts": `import { meter } from "./meter";
import { usageMeterCountSubscriber } from "./count";
definePipeline({ name: "usage" })
  .withGlobalMapProjection(meter, [usageMeterCountSubscriber({ deps })]);`,
		"meter.ts": `export const meter = { name: "orgBillableEventsMeter", map };`,
	})
	for reg, want := range map[*Registry][]string{
		&main: {"global:handler:orgBillableEventsMeter", "global:reactor:billingMeterDispatch"},
		&head: {"global:handler:orgBillableEventsMeter", "global:reactor:usageMeterCount"},
	} {
		got := keys(*reg)
		if strings.Join(got, ",") != strings.Join(want, ",") {
			t.Errorf("got %v, want %v", got, want)
		}
	}
}
