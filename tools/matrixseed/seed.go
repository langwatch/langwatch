package matrixseed

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"time"
)

// Options is one seed run.
type Options struct {
	// BaseURL is the control plane, e.g. http://localhost:5560.
	BaseURL string
	// InstanceAdminKey is the api's LANGWATCH_INSTANCE_ADMIN_API_KEY.
	InstanceAdminKey string
	// Env supplies the provider credentials.
	Env Getenv
	// HTTP defaults to a client with a 30 second timeout.
	HTTP *http.Client
}

// Export is one variable the seed hands the matrix step.
type Export struct{ Name, Value string }

// Failure is a provider whose credentials were present but which the control
// plane refused to seed.
type Failure struct {
	Provider Provider
	Err      error
}

// Result is what a run seeded. Exports holds LW_PROJECT_API_KEY first, then one
// TEST_VK_ variable per provider seeded.
type Result struct {
	Exports  []Export
	Skipped  []Skipped
	Failures []Failure
}

// Err is non-nil when a provider with credentials could not be seeded: that is
// the control plane failing, which the matrix exists to catch.
func (r Result) Err() error {
	var errs []error
	for _, f := range r.Failures {
		errs = append(errs, fmt.Errorf("%s: %w", f.Provider.Name, f.Err))
	}
	return errors.Join(errs...)
}

// Run provisions the organization and project, then seeds each provider in
// turn. A bootstrap failure returns an error and no exports; a provider failure
// is recorded and the remaining providers are still seeded.
func Run(ctx context.Context, opts Options) (Result, error) {
	if opts.InstanceAdminKey == "" {
		return Result{}, errors.New("no instance administrator key: set LANGWATCH_INSTANCE_ADMIN_API_KEY on the api and the seed")
	}
	httpClient := opts.HTTP
	if httpClient == nil {
		httpClient = &http.Client{Timeout: 30 * time.Second}
	}
	c := &client{base: opts.BaseURL, http: httpClient}

	org, err := c.as(opts.InstanceAdminKey).provisionOrganization(ctx, "Gateway matrix")
	if err != nil {
		return Result{}, err
	}
	proj, err := c.as(org.AdminAPIKey.Token).createProject(ctx, org.Team.ID, "gateway-matrix")
	if err != nil {
		return Result{}, err
	}
	asProject := c.as(proj.ServiceAPIKey)

	planned, skipped := Plan(opts.Env)
	result := Result{Exports: []Export{{Name: "LW_PROJECT_API_KEY", Value: proj.ServiceAPIKey}}, Skipped: skipped}
	for _, p := range planned {
		secret, err := seedProvider(ctx, asProject, p)
		if err != nil {
			result.Failures = append(result.Failures, Failure{Provider: p.Provider, Err: err})
			continue
		}
		result.Exports = append(result.Exports, Export{Name: p.Provider.Export, Value: secret})
	}
	return result, nil
}

// seedProvider stores p's model provider and mints its key, as the project.
func seedProvider(ctx context.Context, c *client, p Planned) (string, error) {
	id, err := c.putModelProvider(ctx, p.Provider.Name, p.CustomKeys)
	if err != nil {
		return "", err
	}
	return c.createVirtualKey(ctx, "matrix-"+p.Provider.Name, id)
}
