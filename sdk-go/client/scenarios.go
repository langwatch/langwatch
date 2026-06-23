package client

import (
	"context"

	"github.com/langwatch/langwatch/sdk-go/client/internal/openapi"
)

// ScenariosService is the client for simulation scenarios and their runs.
//
// Access it via [Client.Scenarios]. The simulation-run listings use cursor
// pagination: pass the [SimulationRunsParams.Cursor] returned as NextCursor to
// fetch the next page.
type ScenariosService struct {
	client *Client
}

// Scenario is a simulation scenario as returned by the API.
type Scenario struct {
	ID          string   `json:"id"`
	Name        string   `json:"name"`
	Situation   string   `json:"situation"`
	Criteria    []string `json:"criteria"`
	Labels      []string `json:"labels"`
	PlatformURL string   `json:"platformUrl"`
}

// List returns every scenario in the project.
//
//	scenarios, err := lw.Scenarios.List(ctx)
func (s *ScenariosService) List(ctx context.Context) ([]Scenario, error) {
	resp, err := s.client.gen.GetApiScenarios(ctx)
	var out []Scenario
	if derr := decodeInto("Scenarios.List", resp, err, &out); derr != nil {
		return nil, derr
	}
	return out, nil
}

// Get fetches a single scenario by ID.
//
//	sc, err := lw.Scenarios.Get(ctx, "scenario_abc")
func (s *ScenariosService) Get(ctx context.Context, id string) (*Scenario, error) {
	resp, err := s.client.gen.GetApiScenariosById(ctx, id)
	var out Scenario
	if derr := decodeInto("Scenarios.Get", resp, err, &out); derr != nil {
		return nil, derr
	}
	return &out, nil
}

// Delete removes a scenario by ID.
//
//	err := lw.Scenarios.Delete(ctx, "scenario_abc")
func (s *ScenariosService) Delete(ctx context.Context, id string) error {
	resp, err := s.client.gen.DeleteApiScenariosById(ctx, id)
	return decodeInto("Scenarios.Delete", resp, err, nil)
}

// SimulationRunsParams controls cursor pagination and filtering for
// [ScenariosService.ListRuns]. All fields are optional.
type SimulationRunsParams struct {
	// ScenarioSetID filters to runs in a scenario set.
	ScenarioSetID string
	// BatchRunID filters to runs in a batch.
	BatchRunID string
	// Limit caps the page size.
	Limit int
	// Cursor continues a previous page; pass the value returned as NextCursor.
	Cursor string
}

// SimulationRunsPage is one cursor-paginated page of simulation runs. The runs
// themselves are returned as free-form maps because the run shape is large and
// evolving; HasMore and NextCursor drive pagination.
type SimulationRunsPage struct {
	Runs       []map[string]any `json:"runs"`
	HasMore    bool             `json:"hasMore"`
	NextCursor string           `json:"nextCursor"`
}

// ListRuns returns a cursor-paginated page of simulation runs.
//
//	page, err := lw.Scenarios.ListRuns(ctx, client.SimulationRunsParams{Limit: 50})
//	for page.HasMore {
//		// process page.Runs ...
//		page, err = lw.Scenarios.ListRuns(ctx, client.SimulationRunsParams{
//			Limit:  50,
//			Cursor: page.NextCursor,
//		})
//		if err != nil { break }
//	}
func (s *ScenariosService) ListRuns(ctx context.Context, params SimulationRunsParams) (*SimulationRunsPage, error) {
	p := &openapi.GetApiSimulationRunsParams{}
	if params.ScenarioSetID != "" {
		p.ScenarioSetId = &params.ScenarioSetID
	}
	if params.BatchRunID != "" {
		p.BatchRunId = &params.BatchRunID
	}
	if params.Limit > 0 {
		p.Limit = &params.Limit
	}
	if params.Cursor != "" {
		p.Cursor = &params.Cursor
	}
	resp, err := s.client.gen.GetApiSimulationRuns(ctx, p)
	var out SimulationRunsPage
	if derr := decodeInto("Scenarios.ListRuns", resp, err, &out); derr != nil {
		return nil, derr
	}
	return &out, nil
}
