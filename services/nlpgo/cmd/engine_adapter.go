package cmd

import (
	"context"

	"github.com/langwatch/langwatch/pkg/otelsetup"
	"github.com/langwatch/langwatch/services/nlpgo/app"
	"github.com/langwatch/langwatch/services/nlpgo/app/engine"
	"github.com/langwatch/langwatch/services/nlpgo/app/engine/dsl"
)

// withWorkflowAPIKey copies the parsed workflow's api_key onto the
// request context so otelsetup.TenantRouter can attribute every span
// produced during this run to the right LangWatch project. Empty
// api_key is a no-op — TenantRouter drops un-authenticated spans
// rather than risking a wrong-tenant attribution.
func withWorkflowAPIKey(ctx context.Context, wf *dsl.Workflow) context.Context {
	if wf == nil || wf.APIKey == "" {
		return ctx
	}
	return context.WithValue(ctx, otelsetup.APIKeyContextKey{}, wf.APIKey)
}

// engineAdapter satisfies app.WorkflowExecutor by parsing the raw
// workflow JSON, invoking engine.Engine, and converting the result
// back into the app-layer shape. Lives here (cmd/) rather than in app/
// or engine/ to keep the dependency graph one-way: cmd composes both,
// neither package imports the other.
type engineAdapter struct {
	eng *engine.Engine
}

// ExecuteStream implements app.WorkflowExecutor's streaming method.
// Bridges engine.StreamEvent → app.WorkflowStreamEvent so the handler
// stays decoupled from the engine package's wire shape.
func (a engineAdapter) ExecuteStream(ctx context.Context, req app.WorkflowRequest, opts app.WorkflowStreamOptions) (<-chan app.WorkflowStreamEvent, error) {
	wf, err := dsl.ParseWorkflow(req.WorkflowJSON)
	if err != nil {
		ch := make(chan app.WorkflowStreamEvent, 1)
		ch <- app.WorkflowStreamEvent{Type: "error", Payload: map[string]any{
			"message": "invalid_workflow: " + err.Error(),
		}}
		close(ch)
		return ch, nil
	}
	ctx = withWorkflowAPIKey(ctx, wf)
	in, err := a.eng.ExecuteStream(ctx, engine.ExecuteRequest{
		Workflow:  wf,
		Inputs:    req.Inputs,
		Origin:    req.Origin,
		TraceID:   req.TraceID,
		ProjectID: req.ProjectID,
		ThreadID:  req.ThreadID,
		NodeID:    req.NodeID,
	}, engine.ExecuteStreamOptions{Heartbeat: opts.Heartbeat})
	if err != nil {
		ch := make(chan app.WorkflowStreamEvent, 1)
		ch <- app.WorkflowStreamEvent{Type: "error", Payload: map[string]any{"message": err.Error()}}
		close(ch)
		return ch, nil
	}
	out := make(chan app.WorkflowStreamEvent, 16)
	go func() {
		defer close(out)
		for ev := range in {
			out <- app.WorkflowStreamEvent{
				Type:    ev.Type,
				TraceID: ev.TraceID,
				Payload: ev.Payload,
			}
		}
	}()
	return out, nil
}

// Execute implements app.WorkflowExecutor.
func (a engineAdapter) Execute(ctx context.Context, req app.WorkflowRequest) (*app.WorkflowResult, error) {
	wf, err := dsl.ParseWorkflow(req.WorkflowJSON)
	if err != nil {
		return &app.WorkflowResult{
			Status: "error",
			Error: &app.WorkflowError{
				Type:    "invalid_workflow",
				Message: err.Error(),
			},
		}, nil
	}
	ctx = withWorkflowAPIKey(ctx, wf)
	res, err := a.eng.Execute(ctx, engine.ExecuteRequest{
		Workflow:  wf,
		Inputs:    req.Inputs,
		Origin:    req.Origin,
		TraceID:   req.TraceID,
		ProjectID: req.ProjectID,
		ThreadID:  req.ThreadID,
		NodeID:    req.NodeID,
	})
	if err != nil {
		return &app.WorkflowResult{
			Status: "error",
			Error: &app.WorkflowError{
				Type:    "engine_error",
				Message: err.Error(),
			},
		}, nil
	}
	return convertResult(res), nil
}

func convertResult(r *engine.ExecuteResult) *app.WorkflowResult {
	out := &app.WorkflowResult{
		TraceID:    r.TraceID,
		Status:     r.Status,
		Result:     r.Result,
		TotalCost:  r.TotalCost,
		DurationMS: r.DurationMS,
	}
	if r.Error != nil {
		out.Error = &app.WorkflowError{
			NodeID:    r.Error.NodeID,
			Type:      r.Error.Type,
			Message:   r.Error.Message,
			Traceback: r.Error.Traceback,
		}
	}
	if len(r.Nodes) > 0 {
		out.Nodes = make(map[string]any, len(r.Nodes))
		for k, v := range r.Nodes {
			out.Nodes[k] = v
		}
	}
	return out
}
