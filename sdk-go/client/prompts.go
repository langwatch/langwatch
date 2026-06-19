package client

import (
	"context"

	"github.com/langwatch/langwatch/sdk-go/client/internal/openapi"
)

// PromptsService is the client for LangWatch prompt management: creating,
// reading, updating and deleting prompt configurations, listing their versions,
// and managing the organization's prompt tags.
//
// Access it via [Client.Prompts]:
//
//	prompt, err := lw.Prompts.Get(ctx, "support-greeting", nil)
//
// All methods take a context as their first argument and return a typed
// [*APIError] on any non-2xx response.
type PromptsService struct {
	client *Client
}

// List returns every prompt in the project.
//
//	prompts, err := lw.Prompts.List(ctx)
//	for _, p := range prompts {
//		fmt.Println(p.ID, p.Name)
//	}
func (s *PromptsService) List(ctx context.Context) ([]Prompt, error) {
	resp, err := s.client.gen.GetApiPrompts(ctx)
	var out []Prompt
	if derr := decodeInto("Prompts.List", resp, err, &out); derr != nil {
		return nil, derr
	}
	return out, nil
}

// Get fetches a single prompt by handle or ID.
//
// opts may be nil to fetch the latest version. To pin a version or resolve a
// tag, pass a non-nil [*GetPromptOptions]; alternatively the handle itself may
// carry a shorthand suffix the server understands, e.g. "my-prompt:production"
// (tag) or "my-prompt:3" (version). Do not combine a shorthand suffix with
// opts.
//
//	// Latest:
//	p, err := lw.Prompts.Get(ctx, "support-greeting", nil)
//
//	// Pin a version:
//	p, err := lw.Prompts.Get(ctx, "support-greeting", &client.GetPromptOptions{Version: 4})
//
//	// Resolve a tag:
//	p, err := lw.Prompts.Get(ctx, "support-greeting", &client.GetPromptOptions{Tag: "production"})
//
// A missing prompt yields an [*APIError] with status 404; use [IsNotFound] to
// detect it, or [PromptsService.Exists] for a boolean check.
func (s *PromptsService) Get(ctx context.Context, handleOrID string, opts *GetPromptOptions) (*Prompt, error) {
	params := &openapi.GetApiPromptsByIdParams{}
	if opts != nil {
		if opts.Version > 0 {
			v := opts.Version
			params.Version = &v
		}
		if opts.Tag != "" {
			t := opts.Tag
			params.Tag = &t
		}
	}
	resp, err := s.client.gen.GetApiPromptsById(ctx, handleOrID, params)
	var out Prompt
	if derr := decodeInto("Prompts.Get", resp, err, &out); derr != nil {
		return nil, derr
	}
	return &out, nil
}

// Exists reports whether a prompt with the given handle or ID exists. It is a
// convenience over [PromptsService.Get] that maps a 404 to (false, nil) and
// surfaces any other error.
//
//	ok, err := lw.Prompts.Exists(ctx, "support-greeting")
func (s *PromptsService) Exists(ctx context.Context, handleOrID string) (bool, error) {
	_, err := s.Get(ctx, handleOrID, nil)
	if err != nil {
		if IsNotFound(err) {
			return false, nil
		}
		return false, err
	}
	return true, nil
}

// Create creates a new prompt with a default initial version.
//
// params.Handle is required and must match ^[a-z0-9_-]+(?:/[a-z0-9_-]+)?$. A
// handle that already exists yields an [*APIError] with status 409; use
// [IsConflict] to detect it.
//
//	p, err := lw.Prompts.Create(ctx, client.CreatePromptParams{
//		Handle: "support-greeting",
//		Model:  "openai/gpt-5-mini",
//		Messages: []client.Message{
//			{Role: client.RoleSystem, Content: "You are a friendly support agent."},
//		},
//	})
func (s *PromptsService) Create(ctx context.Context, params CreatePromptParams) (*Prompt, error) {
	body, err := jsonReader(params)
	if err != nil {
		return nil, err
	}
	resp, err := s.client.gen.PostApiPromptsWithBody(ctx, contentTypeJSON, body)
	var out Prompt
	if derr := decodeInto("Prompts.Create", resp, err, &out); derr != nil {
		return nil, derr
	}
	return &out, nil
}

// Update updates a prompt, creating a new version. params.CommitMessage is
// required and documents the change.
//
//	p, err := lw.Prompts.Update(ctx, "support-greeting", client.UpdatePromptParams{
//		CommitMessage: "Warmer tone",
//		Model:         "openai/gpt-5-mini",
//	})
func (s *PromptsService) Update(ctx context.Context, handleOrID string, params UpdatePromptParams) (*Prompt, error) {
	body, err := jsonReader(params)
	if err != nil {
		return nil, err
	}
	resp, err := s.client.gen.PutApiPromptsByIdWithBody(ctx, handleOrID, contentTypeJSON, body)
	var out Prompt
	if derr := decodeInto("Prompts.Update", resp, err, &out); derr != nil {
		return nil, derr
	}
	return &out, nil
}

// Delete removes a prompt and reports success.
//
//	res, err := lw.Prompts.Delete(ctx, "support-greeting")
//	if err == nil && res.Success { /* deleted */ }
func (s *PromptsService) Delete(ctx context.Context, handleOrID string) (*DeletePromptResult, error) {
	resp, err := s.client.gen.DeleteApiPromptsById(ctx, handleOrID)
	var out DeletePromptResult
	if derr := decodeInto("Prompts.Delete", resp, err, &out); derr != nil {
		return nil, derr
	}
	return &out, nil
}

// Versions returns every version of a prompt. The entries carry only versioned
// data, not the base prompt record.
//
//	versions, err := lw.Prompts.Versions(ctx, "support-greeting")
func (s *PromptsService) Versions(ctx context.Context, handleOrID string) ([]Prompt, error) {
	resp, err := s.client.gen.GetApiPromptsByIdVersions(ctx, handleOrID)
	var out []Prompt
	if derr := decodeInto("Prompts.Versions", resp, err, &out); derr != nil {
		return nil, derr
	}
	return out, nil
}

// RestoreVersion restores a prompt to a previous version, creating a new version
// with the same configuration as versionID.
//
//	p, err := lw.Prompts.RestoreVersion(ctx, "support-greeting", "prompt_version_abc")
func (s *PromptsService) RestoreVersion(ctx context.Context, handleOrID, versionID string) (*Prompt, error) {
	resp, err := s.client.gen.PostApiPromptsByIdVersionsByVersionIdRestore(ctx, handleOrID, versionID)
	var out Prompt
	if derr := decodeInto("Prompts.RestoreVersion", resp, err, &out); derr != nil {
		return nil, derr
	}
	return &out, nil
}

// ListTags returns every prompt tag definition in the organization.
//
//	tags, err := lw.Prompts.ListTags(ctx)
func (s *PromptsService) ListTags(ctx context.Context) ([]PromptTag, error) {
	resp, err := s.client.gen.GetApiPromptsTags(ctx)
	var out []PromptTag
	if derr := decodeInto("Prompts.ListTags", resp, err, &out); derr != nil {
		return nil, derr
	}
	return out, nil
}

// CreateTag creates a custom prompt tag definition. name must match
// ^[a-z][a-z0-9_-]*$.
//
//	tag, err := lw.Prompts.CreateTag(ctx, "production")
func (s *PromptsService) CreateTag(ctx context.Context, name string) (*PromptTag, error) {
	body, err := jsonReader(map[string]string{"name": name})
	if err != nil {
		return nil, err
	}
	resp, err := s.client.gen.PostApiPromptsTagsWithBody(ctx, contentTypeJSON, body)
	var out PromptTag
	if derr := decodeInto("Prompts.CreateTag", resp, err, &out); derr != nil {
		return nil, derr
	}
	return &out, nil
}

// RenameTag renames an existing prompt tag definition.
//
//	tag, err := lw.Prompts.RenameTag(ctx, "prod", "production")
func (s *PromptsService) RenameTag(ctx context.Context, currentName, newName string) (*PromptTag, error) {
	body, err := jsonReader(map[string]string{"name": newName})
	if err != nil {
		return nil, err
	}
	resp, err := s.client.gen.PutApiPromptsTagsByTagWithBody(ctx, currentName, contentTypeJSON, body)
	var out PromptTag
	if derr := decodeInto("Prompts.RenameTag", resp, err, &out); derr != nil {
		return nil, derr
	}
	return &out, nil
}

// DeleteTag deletes a prompt tag definition and cascades to its assignments.
//
//	err := lw.Prompts.DeleteTag(ctx, "staging")
func (s *PromptsService) DeleteTag(ctx context.Context, name string) error {
	resp, err := s.client.gen.DeleteApiPromptsTagsByTag(ctx, name)
	return decodeInto("Prompts.DeleteTag", resp, err, nil)
}

// AssignTag points a tag (e.g. "production") at a specific prompt version.
//
//	res, err := lw.Prompts.AssignTag(ctx, "support-greeting", "production", "prompt_version_abc")
func (s *PromptsService) AssignTag(ctx context.Context, handleOrID, tag, versionID string) (*AssignTagResult, error) {
	body, err := jsonReader(map[string]string{"versionId": versionID})
	if err != nil {
		return nil, err
	}
	resp, err := s.client.gen.PutApiPromptsByIdTagsByTagWithBody(ctx, handleOrID, tag, contentTypeJSON, body)
	var out AssignTagResult
	if derr := decodeInto("Prompts.AssignTag", resp, err, &out); derr != nil {
		return nil, derr
	}
	return &out, nil
}
