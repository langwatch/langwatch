package client

// This file defines the clean, hand-written domain types for the Prompts
// service. They deliberately replace the deeply-nested, operation-prefixed
// structs the OpenAPI generator emits for the prompt routes (whose schemas are
// inlined rather than shared), giving callers stable, readable types that match
// the TypeScript SDK's prompt surface.

// PromptScope identifies whether a prompt is owned by a single project or shared
// across the organization.
type PromptScope string

const (
	// PromptScopeProject scopes a prompt to one project.
	PromptScopeProject PromptScope = "PROJECT"
	// PromptScopeOrganization shares a prompt across the whole organization.
	PromptScopeOrganization PromptScope = "ORGANIZATION"
)

// MessageRole is the role of a chat message in a prompt.
type MessageRole string

const (
	RoleSystem    MessageRole = "system"
	RoleUser      MessageRole = "user"
	RoleAssistant MessageRole = "assistant"
)

// Message is a single chat message in a prompt's message list.
type Message struct {
	Role    MessageRole `json:"role"`
	Content string      `json:"content"`
}

// PromptInput declares one templated input variable a prompt expects.
type PromptInput struct {
	Identifier string `json:"identifier"`
	// Type is the input's declared type, e.g. "str", "float", "bool",
	// "chat_messages". See the LangWatch docs for the full set.
	Type string `json:"type"`
}

// PromptOutput declares one output a prompt produces.
type PromptOutput struct {
	Identifier string `json:"identifier"`
	// Type is the output's declared type, e.g. "str", "float", "bool",
	// "json_schema".
	Type string `json:"type"`
	// JSONSchema carries the JSON Schema when Type is "json_schema".
	JSONSchema map[string]any `json:"json_schema,omitempty"`
}

// PromptTagRef links a prompt version to a named tag (e.g. "production").
type PromptTagRef struct {
	Name      string `json:"name"`
	VersionID string `json:"versionId"`
}

// Prompt is a prompt configuration as returned by the LangWatch API. It is the
// canonical read model for the Prompts service; every Get/Create/Update method
// returns one.
type Prompt struct {
	// ID is the prompt's stable identifier (prompt_...).
	ID string `json:"id"`
	// Handle is the human-friendly, project-unique slug, or nil for an
	// unhandled prompt.
	Handle *string `json:"handle"`
	// Scope is PROJECT or ORGANIZATION.
	Scope PromptScope `json:"scope"`
	// Name is the display name.
	Name string `json:"name"`
	// Version is the integer version number this representation reflects.
	Version int `json:"version"`
	// VersionID is the identifier of the underlying version row
	// (prompt_version_...).
	VersionID string `json:"versionId"`
	// Model is the configured model identifier, e.g. "openai/gpt-5-mini".
	Model string `json:"model"`
	// Prompt is the system-prompt string (also typically present as the first
	// system Message).
	Prompt string `json:"prompt"`
	// Messages is the chat message template.
	Messages []Message `json:"messages"`
	// Inputs and Outputs declare the prompt's templated variables and produced
	// outputs.
	Inputs  []PromptInput  `json:"inputs"`
	Outputs []PromptOutput `json:"outputs"`
	// Temperature and MaxTokens are model parameters, when set.
	Temperature *float64 `json:"temperature,omitempty"`
	MaxTokens   *int     `json:"maxTokens,omitempty"`
	// Tags lists the named tags pointing at versions of this prompt.
	Tags []PromptTagRef `json:"tags"`
	// Parameters is a free-form bag of additional model/runtime parameters.
	Parameters map[string]any `json:"parameters"`
	// ProjectID and OrganizationID identify the owning project/org.
	ProjectID      string `json:"projectId"`
	OrganizationID string `json:"organizationId"`
	// CommitMessage is the message recorded when this version was created.
	CommitMessage *string `json:"commitMessage,omitempty"`
	// AuthorID is the user who authored this version, when known.
	AuthorID *string `json:"authorId,omitempty"`
	// CreatedAt and UpdatedAt are RFC 3339 timestamps as returned by the API.
	CreatedAt string `json:"createdAt"`
	UpdatedAt string `json:"updatedAt"`
}

// GetPromptOptions controls how a prompt is fetched. A nil *GetPromptOptions is
// valid and selects the latest version. Version and Tag are mutually exclusive
// and must not be combined with a shorthand suffix in the handle (e.g.
// "my-prompt:production").
type GetPromptOptions struct {
	// Version pins a specific version number. Zero means "unset" (latest).
	Version int
	// Tag fetches the version a named tag points at, e.g. "production".
	Tag string
}

// CreatePromptParams is the request body for creating a prompt. Handle is the
// only required field; everything else is optional and defaults server-side.
type CreatePromptParams struct {
	// Handle is the project-unique slug. Required. Must match
	// ^[a-z0-9_-]+(?:/[a-z0-9_-]+)?$.
	Handle string `json:"handle"`
	// Scope defaults to PROJECT when empty.
	Scope PromptScope `json:"scope,omitempty"`
	// Model, Prompt, Temperature, MaxTokens configure the initial version.
	Model       string   `json:"model,omitempty"`
	Prompt      string   `json:"prompt,omitempty"`
	Temperature *float64 `json:"temperature,omitempty"`
	MaxTokens   *int     `json:"maxTokens,omitempty"`
	// Messages, Inputs, Outputs define the initial template.
	Messages []Message      `json:"messages,omitempty"`
	Inputs   []PromptInput  `json:"inputs,omitempty"`
	Outputs  []PromptOutput `json:"outputs,omitempty"`
	// CommitMessage annotates the initial version.
	CommitMessage string `json:"commitMessage,omitempty"`
	// AuthorID records the author of the initial version.
	AuthorID string `json:"authorId,omitempty"`
	// Tags assigns existing tag names at creation time.
	Tags []string `json:"tags,omitempty"`
	// Parameters carries extra model/runtime parameters.
	Parameters map[string]any `json:"parameters,omitempty"`
}

// UpdatePromptParams is the request body for updating a prompt, which creates a
// new version. CommitMessage is required; it documents the change.
type UpdatePromptParams struct {
	// CommitMessage describes the change. Required.
	CommitMessage string `json:"commitMessage"`
	// Handle optionally renames the prompt.
	Handle string `json:"handle,omitempty"`
	// Scope optionally changes the prompt's scope.
	Scope PromptScope `json:"scope,omitempty"`
	// Model, Prompt, Temperature, MaxTokens update the configuration.
	Model       string   `json:"model,omitempty"`
	Prompt      string   `json:"prompt,omitempty"`
	Temperature *float64 `json:"temperature,omitempty"`
	MaxTokens   *int     `json:"maxTokens,omitempty"`
	// Messages, Inputs, Outputs replace the template.
	Messages []Message      `json:"messages,omitempty"`
	Inputs   []PromptInput  `json:"inputs,omitempty"`
	Outputs  []PromptOutput `json:"outputs,omitempty"`
	// AuthorID records the author of this version.
	AuthorID string `json:"authorId,omitempty"`
	// Tags assigns existing tag names.
	Tags []string `json:"tags,omitempty"`
	// Parameters carries extra model/runtime parameters.
	Parameters map[string]any `json:"parameters,omitempty"`
}

// DeletePromptResult is returned by [PromptsService.Delete].
type DeletePromptResult struct {
	Success bool `json:"success"`
}

// PromptTag is a prompt tag definition belonging to the organization.
type PromptTag struct {
	ID        string `json:"id"`
	Name      string `json:"name"`
	CreatedAt string `json:"createdAt"`
}

// AssignTagResult is returned when a tag is assigned to a specific prompt
// version via [PromptsService.AssignTag].
type AssignTagResult struct {
	ConfigID  string `json:"configId"`
	VersionID string `json:"versionId"`
	Tag       string `json:"tag"`
	UpdatedAt string `json:"updatedAt"`
}
