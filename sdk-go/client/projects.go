package client

import (
	"context"

	"github.com/langwatch/langwatch/sdk-go/client/internal/openapi"
)

// ProjectsService is the client for organization projects.
//
// Access it via [Client.Projects]. Unlike the project-scoped services, these
// endpoints require an admin-scoped API key (sk-lw-{id}_{secret}); a
// project-scoped key will be rejected with a 401.
type ProjectsService struct {
	client *Client
}

// Project is an organization project, re-exported from the API's shared schema.
type Project = openapi.Project

// ListProjectsParams controls offset pagination for [ProjectsService.List]. Zero
// values mean "use the server default".
type ListProjectsParams struct {
	Page  int
	Limit int
}

// List returns a page of projects in the organization along with pagination
// metadata.
//
//	projects, pg, err := lw.Projects.List(ctx, client.ListProjectsParams{Page: 1, Limit: 50})
func (s *ProjectsService) List(ctx context.Context, params ListProjectsParams) ([]Project, Pagination, error) {
	p := &openapi.ListProjectsParams{}
	if params.Page > 0 {
		p.Page = &params.Page
	}
	if params.Limit > 0 {
		p.Limit = &params.Limit
	}
	resp, err := s.client.gen.ListProjects(ctx, p)
	var env struct {
		Data       []Project  `json:"data"`
		Pagination Pagination `json:"pagination"`
	}
	if derr := decodeInto("Projects.List", resp, err, &env); derr != nil {
		return nil, Pagination{}, derr
	}
	return env.Data, env.Pagination, nil
}

// Get fetches a single project by ID (project_...).
//
//	p, err := lw.Projects.Get(ctx, "project_abc123")
func (s *ProjectsService) Get(ctx context.Context, id string) (*Project, error) {
	resp, err := s.client.gen.GetProject(ctx, id)
	var out Project
	if derr := decodeInto("Projects.Get", resp, err, &out); derr != nil {
		return nil, derr
	}
	return &out, nil
}

// Archive archives (soft-deletes) a project by ID. The decoded API response is
// returned as a free-form map.
//
//	_, err := lw.Projects.Archive(ctx, "project_abc123")
func (s *ProjectsService) Archive(ctx context.Context, id string) (map[string]any, error) {
	resp, err := s.client.gen.ArchiveProject(ctx, id)
	var out map[string]any
	if derr := decodeInto("Projects.Archive", resp, err, &out); derr != nil {
		return nil, derr
	}
	return out, nil
}
