package cmd

import (
	"context"

	"github.com/langwatch/langwatch/services/nlpgo/app"
	"github.com/langwatch/langwatch/services/nlpgo/app/engine"
	"github.com/langwatch/langwatch/services/nlpgo/app/engine/dsl"
)

// engineAdapter satisfies app.WorkflowExecutor by parsing the raw
// workflow JSON, invoking engine.Engine, and converting the result
// back into the app-layer shape. Lives here (cmd/) rather than in app/
// or engine/ to keep the dependency graph one-way: cmd composes both,
// neither package imports the other.
type engineAdapter struct {
	eng *engine.Engine
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
	res, err := a.eng.Execute(ctx, engine.ExecuteRequest{
		Workflow:  wf,
		Inputs:    req.Inputs,
		Origin:    req.Origin,
		TraceID:   req.TraceID,
		ProjectID: req.ProjectID,
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
