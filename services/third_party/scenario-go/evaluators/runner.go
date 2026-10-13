package evaluators

import (
	"context"
	"fmt"
	"io"
	"os"
	"slices"
	"strings"
	"sync"

	scenario "github.com/langwatch/scenario/go"
)

// Runner is the scenario.EvaluatorRunner of LangWatch evaluators: it runs a
// scenario's evaluators once it has a verdict and fails the run when a
// required evaluator fails or cannot run. Scores and skips never gate.
type Runner struct {
	// NewAPI returns the evaluations API for a run; defaults to NewClient
	// with the run's LangWatch config.
	NewAPI func(lw scenario.LangWatchConfig) API
	// FetchRemoteTraces waits for the run's remote traces; defaults to
	// Executor.SettleRemoteTraces.
	FetchRemoteTraces func(ctx context.Context, ex *scenario.Executor)
	// Out receives the per-evaluator lines of verbose runs; default stdout.
	Out io.Writer
}

// NewRunner returns a runner talking to LangWatch.
func NewRunner() *Runner { return &Runner{} }

var _ scenario.EvaluatorRunner = (*Runner)(nil)

// RunEvaluators implements scenario.EvaluatorRunner.
func (r *Runner) RunEvaluators(ctx context.Context, ex *scenario.Executor, evaluators []scenario.ScenarioEvaluator, result *scenario.ScenarioResult) error {
	cfg := ex.Config()
	newAPI := r.NewAPI
	if newAPI == nil {
		newAPI = func(lw scenario.LangWatchConfig) API { return NewClient(lw, ClientOptions{}) }
	}
	fetch := r.FetchRemoteTraces
	if fetch == nil {
		fetch = func(ctx context.Context, ex *scenario.Executor) { ex.SettleRemoteTraces(ctx) }
	}
	state := ex.State()
	traceID := ""
	if ids := scenario.MessageTraceIDs(state.Messages()); len(ids) > 0 {
		traceID = ids[len(ids)-1]
	}
	evaluations := Run(ctx, RunInput{
		Evaluators:        evaluators,
		State:             state,
		TraceID:           traceID,
		API:               newAPI(cfg.LangWatch),
		FetchRemoteTraces: func(ctx context.Context) { fetch(ctx, ex) },
	})
	if len(evaluations) > 0 {
		Apply(result, evaluations)
	}
	if cfg.Verbose {
		out := r.Out
		if out == nil {
			out = os.Stdout
		}
		for _, e := range evaluations {
			details := ""
			if e.Details != "" {
				details = " (" + e.Details + ")"
			}
			fmt.Fprintf(out, "Evaluator %s: %s%s\n", e.Name, e.Status, details)
		}
	}
	return nil
}

// RunInput is what Run needs from LangWatch and from the run.
type RunInput struct {
	Evaluators []scenario.ScenarioEvaluator
	State      *scenario.ExecutionState
	// TraceID is the trace of the run's last turn, sent with each call.
	TraceID string
	API     API
	// FetchRemoteTraces brings the run's remote traces into the span
	// collector. Called at most once, only when a mapping read the trace and
	// found nothing while the messages carry trace ids.
	FetchRemoteTraces func(ctx context.Context)
}

type prepared struct {
	attachment scenario.ScenarioEvaluator
	spec       *EvaluatorSpec
	required   bool
	mappings   map[string]any
	// order is the resolution order: declared inputs, then the other
	// explicit mappings sorted.
	order    []string
	explicit map[string]any
}

type resolvedInputs struct {
	data      map[string]any
	order     []string
	inputs    map[string]string
	skipped   string
	err       string
	wantTrace bool
}

// Run runs every evaluator and returns one result per evaluator, in the
// order the scenario lists them. Mappings resolve one evaluator at a time
// against the state; the API calls run in parallel. It never fails: a
// failure to load or call an evaluator is an error result.
func Run(ctx context.Context, in RunInput) []scenario.EvaluationResult {
	results := make([]scenario.EvaluationResult, len(in.Evaluators))
	preps := make([]*prepared, len(in.Evaluators))
	parallel(len(in.Evaluators), func(i int) {
		preps[i], results[i] = prepare(ctx, in, in.Evaluators[i])
	})

	canFetch := in.FetchRemoteTraces != nil && len(scenario.MessageTraceIDs(in.State.Messages())) > 0
	fetched := false
	resolved := make([]resolvedInputs, len(preps))
	for i, p := range preps {
		if p == nil {
			continue
		}
		fetchedBefore := fetched
		resolved[i] = resolveAll(ctx, p, in.State)
		if resolved[i].wantTrace && canFetch && !fetchedBefore {
			in.FetchRemoteTraces(ctx)
			fetched = true
			resolved[i] = resolveAll(ctx, p, in.State)
		}
	}
	parallel(len(preps), func(i int) {
		if preps[i] != nil {
			results[i] = call(ctx, in, preps[i], resolved[i])
		}
	})
	return results
}

// parallel runs fn for 0..n-1, in goroutines when there is more than one.
func parallel(n int, fn func(i int)) {
	if n == 1 {
		fn(0)
		return
	}
	var wg sync.WaitGroup
	for i := range n {
		wg.Go(func() { fn(i) })
	}
	wg.Wait()
}

func errorResult(id, name string, required bool, details string) scenario.EvaluationResult {
	return scenario.EvaluationResult{EvaluatorID: id, Name: name, Status: scenario.EvaluationError, Required: required, Details: details}
}

// prepare loads the evaluator and completes its mappings, or returns the
// error result.
func prepare(ctx context.Context, in RunInput, a scenario.ScenarioEvaluator) (*prepared, scenario.EvaluationResult) {
	ref := a.Evaluator
	requiredOr := func(def bool) bool {
		if a.Required != nil {
			return *a.Required
		}
		return def
	}
	if ref == "" {
		return nil, errorResult(ref, ref, requiredOr(false), "An evaluator reference is required")
	}
	spec, err := in.API.EvaluatorSpec(ctx, ref)
	if err != nil {
		return nil, errorResult(ref, ref, requiredOr(false), "Could not load evaluator "+ref+": "+err.Error())
	}
	if spec == nil {
		return nil, errorResult(ref, ref, requiredOr(false), "Evaluator "+ref+" was not found in LangWatch")
	}
	required := requiredOr(spec.ProducesPassed)
	ids := make([]string, len(spec.Inputs))
	for i, input := range spec.Inputs {
		ids[i] = input.ID
	}
	mappings := InferMappings(ids, sortedKeys(in.State.Fields()), a.Mappings)
	var unmapped []string
	for _, input := range spec.Inputs {
		if _, ok := mappings[input.ID]; input.Required && !ok {
			unmapped = append(unmapped, input.ID)
		}
	}
	if len(unmapped) > 0 {
		plural := ""
		if len(unmapped) > 1 {
			plural = "s"
		}
		return nil, errorResult(spec.EvaluatorID, spec.Name, required,
			"No mapping for the required input"+plural+" "+strings.Join(unmapped, ", ")+" of "+spec.Name)
	}
	order := make([]string, 0, len(mappings))
	for _, id := range ids {
		if _, ok := mappings[id]; ok && !slices.Contains(order, id) {
			order = append(order, id)
		}
	}
	for _, k := range sortedKeys(mappings) {
		if !slices.Contains(order, k) {
			order = append(order, k)
		}
	}
	return &prepared{attachment: a, spec: spec, required: required, mappings: mappings, order: order, explicit: a.Mappings}, scenario.EvaluationResult{}
}

func sortedKeys[V any](m map[string]V) []string {
	keys := make([]string, 0, len(m))
	for k := range m {
		keys = append(keys, k)
	}
	slices.Sort(keys)
	return keys
}

// coerce turns a string mapped to a contexts input into a one-item list,
// since evaluators read contexts as a list.
func coerce(inputID string, v any) any {
	if s, ok := v.(string); ok && strings.HasSuffix(strings.ToLower(inputID), "contexts") {
		return []any{s}
	}
	return v
}

// resolveAll resolves every mapping. Nothing for a required or explicitly
// mapped input skips the evaluator; nothing for an inferred optional input
// leaves it out of the call. The first error or skip reason wins.
func resolveAll(ctx context.Context, p *prepared, state *scenario.ExecutionState) resolvedInputs {
	out := resolvedInputs{data: make(map[string]any, len(p.order)), inputs: make(map[string]string, len(p.order)), order: p.order}
	for _, id := range p.order {
		r := ResolveMapping(ctx, p.mappings[id], state)
		switch r.Kind {
		case ResolvedValue:
			out.data[id] = coerce(id, r.Value)
			out.inputs[id] = truncate(stringify(r.Value))
			continue
		case ResolvedError:
			if out.err == "" {
				out.err = "Mapping of " + id + " failed: " + r.Err.Error()
			}
			continue
		}
		out.wantTrace = out.wantTrace || r.ReadTrace
		_, explicit := p.explicit[id]
		if !explicit && !p.spec.required(id) {
			continue
		}
		if out.skipped == "" {
			out.skipped = r.Reason
		}
	}
	return out
}

func (s *EvaluatorSpec) required(id string) bool {
	for _, in := range s.Inputs {
		if in.ID == id && in.Required {
			return true
		}
	}
	return false
}

func call(ctx context.Context, in RunInput, p *prepared, r resolvedInputs) scenario.EvaluationResult {
	base := scenario.EvaluationResult{EvaluatorID: p.spec.EvaluatorID, Name: p.spec.Name, Required: p.required, Inputs: r.inputs}
	switch {
	case r.err != "":
		base.Status, base.Details = scenario.EvaluationError, r.err
		return base
	case r.skipped != "":
		base.Status, base.Details = scenario.EvaluationSkipped, r.skipped
		return base
	}
	resp, err := in.API.Evaluate(ctx, EvaluateRequest{
		EvaluatorRef: p.attachment.Evaluator, Data: r.data, Order: r.order,
		Settings: p.attachment.Settings, TraceID: in.TraceID,
	})
	if err != nil {
		base.Status, base.Details = scenario.EvaluationError, err.Error()
		return base
	}
	return fromResponse(base, resp)
}

func deref[T any](p *T) T {
	var zero T
	if p == nil {
		return zero
	}
	return *p
}

func fromResponse(base scenario.EvaluationResult, resp *EvaluateResponse) scenario.EvaluationResult {
	base.Details = deref(resp.Details)
	switch resp.Status {
	case "error":
		base.Status = scenario.EvaluationError
		return base
	case "skipped":
		base.Status, base.Cost = scenario.EvaluationSkipped, resp.Cost
		return base
	}
	base.Passed, base.Score, base.Label, base.Cost = resp.Passed, resp.Score, deref(resp.Label), resp.Cost
	switch {
	case resp.Passed == nil:
		base.Status = scenario.EvaluationScored
	case *resp.Passed:
		base.Status = scenario.EvaluationPassed
	default:
		base.Status = scenario.EvaluationFailed
	}
	return base
}

// gates reports whether the evaluation fails the run.
func gates(e scenario.EvaluationResult) bool {
	return e.Required && (e.Status == scenario.EvaluationFailed || e.Status == scenario.EvaluationError)
}

// Apply sets the evaluations on the result: a required evaluator that
// failed, or could not run, fails the run and its reason joins the
// reasoning. The platform applies the same rule to runs it evaluates.
func Apply(result *scenario.ScenarioResult, evaluations []scenario.EvaluationResult) {
	result.Evaluations = evaluations
	var reasons []string
	if result.Reasoning != "" {
		reasons = append(reasons, result.Reasoning)
	}
	failed := false
	for _, e := range evaluations {
		if !gates(e) {
			continue
		}
		failed = true
		what := "failed"
		if e.Status == scenario.EvaluationError {
			what = "could not run"
		}
		reason := "Evaluator " + e.Name + " " + what
		if e.Details != "" {
			reason += ": " + e.Details
		}
		reasons = append(reasons, reason)
	}
	if failed {
		result.Success = false
		result.Reasoning = strings.Join(reasons, "\n")
	}
}
