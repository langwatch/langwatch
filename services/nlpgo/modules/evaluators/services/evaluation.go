// Package services holds the evaluators module's behavior. Plan:
// dev/docs/plans/langevals-go-replacement.md §3, §5.5, §6.
package services

import (
	"context"
	"encoding/json"
	"errors"
	"strings"
	"sync"

	"go.opentelemetry.io/otel/attribute"
	"go.opentelemetry.io/otel/codes"
	"go.opentelemetry.io/otel/trace"
	"go.uber.org/zap"

	"github.com/langwatch/langwatch/pkg/herr"
	"github.com/langwatch/langwatch/services/nlpgo/modules/evaluators/channels"
	"github.com/langwatch/langwatch/services/nlpgo/modules/evaluators/contract"
	"github.com/langwatch/langwatch/services/nlpgo/modules/evaluators/rules"
)

// Entry error types, as a result's error_type. A closed set, so the ops span
// may carry them.
const (
	errorTypeValidation         = "ValidationError"
	errorTypeModelNotConfigured = "ModelProviderNotConfigured"
	errorTypeDeadline           = "DeadlineExceeded"
	errorTypeEvaluation         = "EvaluationError"
	errorTypePanic              = "EvaluatorPanic"
)

// Score scores one entry with settings already parsed. A returned error
// becomes that entry's error result carrying the cost spent so far.
type Score func(ctx context.Context, in EntryRun) (contract.Result, error)

// Evaluator is a definition and how it runs. Prepare parses the settings once
// and binds them to the scorer; its error is evaluator_settings_invalid.
type Evaluator struct {
	Definition rules.Definition
	Prepare    func(raw json.RawMessage) (Score, error)
}

// WithSettings builds an Evaluator's Prepare from a typed settings parser and
// a scorer that receives the parsed value.
func WithSettings[S any](parse func(json.RawMessage) (S, error), score func(ctx context.Context, settings S, in EntryRun) (contract.Result, error)) func(json.RawMessage) (Score, error) {
	return func(raw json.RawMessage) (Score, error) {
		settings, err := parse(raw)
		if err != nil {
			return nil, err
		}
		return func(ctx context.Context, in EntryRun) (contract.Result, error) {
			return score(ctx, settings, in)
		}, nil
	}
}

// EntryRun is one entry to score. Models is the only way to call a model.
type EntryRun struct {
	Entry  contract.Entry
	Models *Models
}

// EvaluationDeps are the service's collaborators. Evaluators nil serves
// BuiltinEvaluators(); tests inject their own definitions there.
type EvaluationDeps struct {
	Config        contract.Config
	LLM           channels.LLMChannel
	CustomerTrace channels.CustomerTraceChannel
	OpsTracer     trace.Tracer
	Logger        *zap.Logger
	Evaluators    map[string]Evaluator
}

// EvaluationService runs one evaluator over a batch of entries.
type EvaluationService struct {
	cfg        contract.Config
	llm        channels.LLMChannel
	trace      channels.CustomerTraceChannel
	ops        trace.Tracer
	logger     *zap.Logger
	evaluators map[string]Evaluator
	admission  *admission
}

// NewEvaluationService builds the service.
func NewEvaluationService(deps EvaluationDeps) *EvaluationService {
	evaluators := deps.Evaluators
	if evaluators == nil {
		evaluators = BuiltinEvaluators()
	}
	return &EvaluationService{
		cfg:        deps.Config,
		llm:        deps.LLM,
		trace:      deps.CustomerTrace,
		ops:        deps.OpsTracer,
		logger:     deps.Logger,
		evaluators: evaluators,
		admission: newAdmission(rules.FairShareLimits{
			Global:     deps.Config.MaxInFlight,
			PerProject: deps.Config.MaxInFlightPerProject,
		}, deps.Config.BusyWait()),
	}
}

// Evaluate answers one result per entry, in order (contract.EvaluatorRuntimeAPI).
func (s *EvaluationService) Evaluate(ctx context.Context, req contract.EvaluateRequest) (results []contract.Result, err error) {
	// A new root: the ops span must not join the tenant's trace, and it never
	// enters ctx, so the tenant's spans never parent under it.
	_, span := s.ops.Start(ctx, "evaluators.evaluate", trace.WithNewRoot(), trace.WithSpanKind(trace.SpanKindInternal))
	defer span.End()
	stats := &batchStats{}
	defer func() {
		if code := stampOpsSpan(span, opsOutcome{entryCount: len(req.Entries), stats: stats, results: results, err: err}); code != "" {
			span.SetStatus(codes.Error, code)
		}
	}()

	if req.Tenant.ProjectID == "" {
		return nil, herr.New(ctx, contract.ErrTenantMissing, herr.M{"message": "the project id header is required"})
	}
	evaluator, ok := s.evaluators[req.Evaluator]
	if !ok {
		return nil, herr.New(ctx, contract.ErrEvaluatorNotFound, herr.M{
			"message":   "evaluator not found",
			"evaluator": req.Evaluator,
		})
	}
	slug := evaluator.Definition.Slug
	span.SetAttributes(attribute.String("langwatch.evaluator.type", slug))
	// Parsed once here; the error is not attached: settings may quote tenant prompts.
	score, parseErr := evaluator.Prepare(req.Settings)
	if parseErr != nil {
		return nil, herr.New(ctx, contract.ErrEvaluatorSettingsInvalid, herr.M{
			"message":   "evaluator settings invalid",
			"evaluator": slug,
		})
	}

	if deadline := s.cfg.Deadline(); deadline > 0 {
		var cancel context.CancelFunc
		ctx, cancel = context.WithTimeout(ctx, deadline)
		defer cancel()
	}
	release, err := s.admission.acquire(ctx, req.Tenant.ProjectID)
	if err != nil {
		return nil, err
	}
	defer release()

	traceCtx, endTrace := s.startEvaluationSpan(ctx, channels.EvaluationSpan{
		Tenant:    req.Tenant,
		Evaluator: slug,
		Trace:     req.Trace,
	})
	results = make([]contract.Result, len(req.Entries))
	for i, entry := range req.Entries {
		// ponytail: entries run one after another; run them in parallel when batches grow past one or two.
		results[i] = s.runEntry(traceCtx, entryJob{
			definition: evaluator.Definition,
			score:      score,
			tenant:     req.Tenant,
			entry:      entry,
			stats:      stats,
		})
	}
	endTrace(channels.EvaluationOutcome{Results: results})
	return results, nil
}

// entryJob is one entry of a batch and what scoring it needs.
type entryJob struct {
	definition rules.Definition
	score      Score
	tenant     contract.Tenant
	entry      contract.Entry
	stats      *batchStats
}

// entryFailure is an entry's error result before it is logged and built.
type entryFailure struct {
	errorType string
	details   string
	cost      *contract.Money
}

func (s *EvaluationService) runEntry(ctx context.Context, job entryJob) (result contract.Result) {
	slug := job.definition.Slug
	models := &Models{service: s, tenant: job.tenant, stats: job.stats}
	defer func() {
		if recover() != nil {
			result = s.entryError(slug, entryFailure{errorTypePanic, "the evaluator failed unexpectedly", models.spent()})
		}
	}()
	if missing := rules.MissingFields(job.entry, job.definition.RequiredFields); len(missing) > 0 {
		return s.entryError(slug, entryFailure{errorTypeValidation, "missing required field: " + strings.Join(missing, ", "), nil})
	}
	if ctx.Err() != nil {
		return s.entryError(slug, entryFailure{errorTypeDeadline, "evaluation deadline exceeded", nil})
	}
	result, err := job.score(ctx, EntryRun{Entry: job.entry, Models: models})
	if err != nil {
		errorType, details := classifyEntryError(ctx, err)
		return s.entryError(slug, entryFailure{errorType, details, models.spent()})
	}
	if result.Cost == nil {
		result.Cost = models.spent()
	}
	return result
}

// classifyEntryError names an evaluator failure. The error type is from a
// closed set or a herr code; details go to the tenant only.
func classifyEntryError(ctx context.Context, err error) (errorType, details string) {
	var handled herr.E
	switch {
	case errors.Is(err, channels.ErrProviderNotConfigured):
		return errorTypeModelNotConfigured, err.Error()
	case errors.Is(err, context.DeadlineExceeded) || errors.Is(ctx.Err(), context.DeadlineExceeded):
		return errorTypeDeadline, "evaluation deadline exceeded"
	case errors.As(err, &handled):
		return string(handled.Code), err.Error()
	default:
		return errorTypeEvaluation, err.Error()
	}
}

func (s *EvaluationService) entryError(slug string, failure entryFailure) contract.Result {
	s.logger.Warn("evaluators_entry_failed",
		zap.String("evaluator", slug),
		zap.String("error_type", failure.errorType),
	)
	return contract.Result{Status: contract.StatusError, ErrorType: failure.errorType, Details: &failure.details, Cost: failure.cost}
}

// startEvaluationSpan opens the tenant's evaluation span. The customer trace
// is best effort: its failure never fails the evaluation.
func (s *EvaluationService) startEvaluationSpan(ctx context.Context, span channels.EvaluationSpan) (context.Context, func(channels.EvaluationOutcome)) {
	started, end, ok := s.tryStartEvaluation(ctx, span)
	if !ok {
		return ctx, func(channels.EvaluationOutcome) {}
	}
	return started, func(outcome channels.EvaluationOutcome) {
		s.guardTrace(func() { end(outcome) })
	}
}

func (s *EvaluationService) tryStartEvaluation(ctx context.Context, span channels.EvaluationSpan) (started context.Context, end func(channels.EvaluationOutcome), ok bool) {
	defer func() {
		if recover() != nil {
			s.logger.Warn("evaluators_customer_trace_failed")
			ok = false
		}
	}()
	started, end = s.trace.StartEvaluation(ctx, span)
	return started, end, true
}

func (s *EvaluationService) startCallSpan(ctx context.Context, call channels.CallSpan) func(channels.CallOutcome) {
	var finish func(channels.CallOutcome)
	if !s.guardTrace(func() { finish = s.trace.StartCall(ctx, call) }) {
		return func(channels.CallOutcome) {}
	}
	return func(outcome channels.CallOutcome) {
		s.guardTrace(func() { finish(outcome) })
	}
}

// guardTrace runs a customer trace step, swallowing its failure. The panic
// value is not logged: it may quote the tenant's content.
func (s *EvaluationService) guardTrace(step func()) (ok bool) {
	defer func() {
		if recover() != nil {
			s.logger.Warn("evaluators_customer_trace_failed")
		}
	}()
	step()
	return true
}

// Models is how an evaluator calls models: only with the tenant's own
// credentials, traced into the tenant's project, and costed for the entry.
type Models struct {
	service *EvaluationService
	tenant  contract.Tenant
	stats   *batchStats

	mu      sync.Mutex
	costUSD float64
	costed  bool
}

// Complete makes one chat call for the tenant.
func (m *Models) Complete(ctx context.Context, req channels.CompletionRequest) (channels.CompletionResponse, error) {
	if !rules.HasCompletionModel(m.tenant.Env) {
		return channels.CompletionResponse{}, channels.ErrProviderNotConfigured
	}
	req.Tenant = m.tenant
	end := m.service.startCallSpan(ctx, channels.CallSpan{Kind: "chat", Model: req.Model})
	resp, err := m.service.llm.Complete(ctx, req)
	m.record(req.Model, resp.Usage, resp.CostUSD)
	end(channels.CallOutcome{
		RequestBody:  resp.RequestBody,
		ResponseBody: resp.ResponseBody,
		Usage:        resp.Usage,
		CostUSD:      resp.CostUSD,
		Err:          err,
	})
	return resp, err
}

func (m *Models) record(model string, usage channels.Usage, costUSD *float64) {
	m.stats.record(model, usage, costUSD)
	if costUSD == nil {
		return
	}
	m.mu.Lock()
	defer m.mu.Unlock()
	m.costUSD += *costUSD
	m.costed = true
}

// spent is the entry's cost so far, nil when no call was priced.
func (m *Models) spent() *contract.Money {
	m.mu.Lock()
	defer m.mu.Unlock()
	if !m.costed {
		return nil
	}
	return &contract.Money{Currency: "USD", Amount: m.costUSD}
}
