package ingestionbench

import (
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"time"
)

// Tenant is one seeded project the load is sent as. The JSON tags are the
// wire contract between `ingestionbench seed` and `ingestionbench run`: seed
// prints this shape on stdout and the workflow feeds it straight back in.
type Tenant struct {
	ProjectID string `json:"projectId"`
	APIKey    string `json:"apiKey"`
}

// RunArgs is the resolved configuration for a benchmark run.
type RunArgs struct {
	Endpoint      string
	ClickHouse    string
	Tenants       []Tenant
	Scale         float64
	Seed          int64
	Out           string
	RunnerLabel   string
	SpanEventType string
	SettleTimeout time.Duration
	Namespace     string
}

// parseTenants decodes the --tenants JSON.
//
// Two tenants is a hard floor, not a suggestion: cross-tenant isolation has
// nothing to compare against with one project, and per-tenant dispatch
// fairness has nothing to be fair between. A single-tenant run would report
// those checks as passing while never actually exercising them.
func parseTenants(raw string) ([]Tenant, error) {
	if strings.TrimSpace(raw) == "" {
		return nil, errors.New(
			"no tenants provided: pass -tenants '[{\"projectId\":\"…\",\"apiKey\":\"sk-lw-…\"}]' " +
				"or set BENCHMARK_TENANTS (run `ingestionbench seed` to mint them)")
	}

	var tenants []Tenant
	if err := json.Unmarshal([]byte(raw), &tenants); err != nil {
		return nil, fmt.Errorf("could not parse -tenants as JSON: %w", err)
	}
	if len(tenants) < 2 {
		return nil, fmt.Errorf(
			"need at least 2 tenants to check cross-tenant isolation, got %d", len(tenants))
	}
	for i, tenant := range tenants {
		if tenant.ProjectID == "" || tenant.APIKey == "" {
			return nil, fmt.Errorf("tenant %d is missing projectId or apiKey", i)
		}
	}
	return tenants, nil
}

// validate rejects configuration that would produce a meaningless run.
//
// Every one of these arrives from a workflow_dispatch form, so it is whatever
// an engineer typed into a free-text box. Rejecting here costs a second;
// letting a zero scale or a negative timeout through costs an hour of runner
// time and produces a green run that measured nothing.
func (a RunArgs) validate() error {
	if a.ClickHouse == "" {
		return errors.New("-clickhouse is required: the correctness checks read from it")
	}
	if a.Scale <= 0 {
		return fmt.Errorf("-scale must be positive, got %v", a.Scale)
	}
	if a.SettleTimeout <= 0 {
		return fmt.Errorf("-settle-timeout must be positive, got %v", a.SettleTimeout)
	}
	if len(a.Tenants) < 2 {
		return fmt.Errorf("need at least 2 tenants, got %d", len(a.Tenants))
	}
	return nil
}

// seedArgs is the resolved configuration for tenant seeding.
type seedArgs struct {
	DatabaseURL string
	Count       int
}

func (a seedArgs) validate() error {
	if a.DatabaseURL == "" {
		return errors.New("-database-url is required (or set DATABASE_URL)")
	}
	// Mirrors parseTenants: the benchmark cannot check isolation with one.
	if a.Count < 2 {
		return fmt.Errorf("-count must be >= 2 (cross-tenant isolation needs at least two), got %d", a.Count)
	}
	return nil
}
