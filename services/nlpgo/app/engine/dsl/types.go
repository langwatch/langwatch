// Package dsl mirrors the Python langwatch_nlp.studio.types.dsl schema in
// Go. Every type here MUST round-trip-deserialize JSON produced by the
// Python service so that no customer workflow data is lost in the new
// engine. See _shared/contract.md §5.
package dsl

import (
	"encoding/json"
	"fmt"
)

// FieldType mirrors the Python FieldType enum.
type FieldType string

const (
	FieldTypeStr                FieldType = "str"
	FieldTypeImage              FieldType = "image"
	FieldTypeFloat              FieldType = "float"
	FieldTypeInt                FieldType = "int"
	FieldTypeBool               FieldType = "bool"
	FieldTypeList               FieldType = "list"
	FieldTypeListStr            FieldType = "list[str]"
	FieldTypeListFloat          FieldType = "list[float]"
	FieldTypeListInt            FieldType = "list[int]"
	FieldTypeListBool           FieldType = "list[bool]"
	FieldTypeDict               FieldType = "dict"
	FieldTypeJSONSchema         FieldType = "json_schema"
	FieldTypeChatMessages       FieldType = "chat_messages"
	FieldTypeSignature          FieldType = "signature"
	FieldTypeLLM                FieldType = "llm"
	FieldTypePromptingTechnique FieldType = "prompting_technique"
	FieldTypeDataset            FieldType = "dataset"
	FieldTypeCode               FieldType = "code"
)

// Field is a parameter / input / output declaration on a component.
type Field struct {
	Identifier string         `json:"identifier"`
	Type       FieldType      `json:"type"`
	Optional   *bool          `json:"optional,omitempty"`
	Value      json.RawMessage `json:"value,omitempty"`
	Desc       *string        `json:"desc,omitempty"`
	Prefix     *string        `json:"prefix,omitempty"`
	Hidden     *bool          `json:"hidden,omitempty"`
	JSONSchema map[string]any `json:"json_schema,omitempty"`
}

// ExecutionStatus mirrors the Python ExecutionStatus enum.
type ExecutionStatus string

const (
	StatusIdle    ExecutionStatus = "idle"
	StatusWaiting ExecutionStatus = "waiting"
	StatusRunning ExecutionStatus = "running"
	StatusSuccess ExecutionStatus = "success"
	StatusError   ExecutionStatus = "error"
)

// ComponentType mirrors the Python ComponentType enum.
type ComponentType string

const (
	ComponentEntry              ComponentType = "entry"
	ComponentEnd                ComponentType = "end"
	ComponentSignature          ComponentType = "signature"
	ComponentCode               ComponentType = "code"
	ComponentRetriever          ComponentType = "retriever"
	ComponentPromptingTechnique ComponentType = "prompting_technique"
	ComponentEvaluator          ComponentType = "evaluator"
	ComponentHTTP               ComponentType = "http"
	ComponentAgent              ComponentType = "agent"
	ComponentCustom             ComponentType = "custom"
)

// Timestamps mirrors the Python Timestamps model.
type Timestamps struct {
	StartedAt  *int64 `json:"started_at,omitempty"`
	FinishedAt *int64 `json:"finished_at,omitempty"`
	StoppedAt  *int64 `json:"stopped_at,omitempty"`
}

// ExecutionState mirrors the Python ExecutionState model. Used per-node
// inside a node's `data.execution_state` field.
type ExecutionState struct {
	Status     ExecutionStatus `json:"status"`
	TraceID    *string         `json:"trace_id,omitempty"`
	SpanID     *string         `json:"span_id,omitempty"`
	Error      *string         `json:"error,omitempty"`
	Parameters map[string]any  `json:"parameters,omitempty"`
	Inputs     map[string]any  `json:"inputs,omitempty"`
	Outputs    map[string]any  `json:"outputs,omitempty"`
	Cost       *float64        `json:"cost,omitempty"`
	Timestamps *Timestamps     `json:"timestamps,omitempty"`
}

// LLMConfig mirrors the Python LLMConfig model. The unified `Reasoning`
// field is the canonical source; legacy provider-specific fields are
// preserved on read so existing customer workflows stay parseable.
type LLMConfig struct {
	Model             *string           `json:"model,omitempty"`
	Temperature       *float64          `json:"temperature,omitempty"`
	MaxTokens         *int              `json:"max_tokens,omitempty"`
	TopP              *float64          `json:"top_p,omitempty"`
	FrequencyPenalty  *float64          `json:"frequency_penalty,omitempty"`
	PresencePenalty   *float64          `json:"presence_penalty,omitempty"`
	Seed              *int              `json:"seed,omitempty"`
	TopK              *int              `json:"top_k,omitempty"`
	MinP              *float64          `json:"min_p,omitempty"`
	RepetitionPenalty *float64          `json:"repetition_penalty,omitempty"`
	Reasoning         *string           `json:"reasoning,omitempty"`
	ReasoningEffort   *string           `json:"reasoning_effort,omitempty"`
	ThinkingLevel     *string           `json:"thinkingLevel,omitempty"`
	Effort            *string           `json:"effort,omitempty"`
	LiteLLMParams     map[string]string `json:"litellm_params,omitempty"`
}

// DatasetInline carries inline dataset records, stored column-oriented
// (one slice per column).
type DatasetInline struct {
	Records     map[string][]any `json:"records"`
	ColumnTypes []DatasetColumn  `json:"columnTypes,omitempty"`
}

// DatasetColumn is one column descriptor for an inline dataset.
type DatasetColumn struct {
	Name string    `json:"name"`
	Type FieldType `json:"type"`
}

// NodeDataset describes the dataset attached to an Entry node.
type NodeDataset struct {
	ID     *string        `json:"id,omitempty"`
	Name   *string        `json:"name,omitempty"`
	Inline *DatasetInline `json:"inline,omitempty"`
}

// EntrySelection is `Optional[str] | int` on the Python side. We carry
// the raw value and expose typed accessors so callers don't have to
// switch on `any`.
type EntrySelection struct {
	raw json.RawMessage
}

// MarshalJSON / UnmarshalJSON keep the field opaque on the wire but
// strongly typed in code.
func (e EntrySelection) MarshalJSON() ([]byte, error) {
	if len(e.raw) == 0 {
		return []byte("null"), nil
	}
	return e.raw, nil
}

func (e *EntrySelection) UnmarshalJSON(b []byte) error {
	e.raw = append(e.raw[:0], b...)
	return nil
}

// AsInt returns the int form when the selection is a number; ok is
// false otherwise (string / null / unset).
func (e EntrySelection) AsInt() (int, bool) {
	if len(e.raw) == 0 || string(e.raw) == "null" {
		return 0, false
	}
	var i int
	if err := json.Unmarshal(e.raw, &i); err != nil {
		return 0, false
	}
	return i, true
}

// AsString returns the string form when the selection is a string;
// ok is false otherwise.
func (e EntrySelection) AsString() (string, bool) {
	if len(e.raw) == 0 || string(e.raw) == "null" {
		return "", false
	}
	var s string
	if err := json.Unmarshal(e.raw, &s); err != nil {
		return "", false
	}
	return s, true
}

// IsSet reports whether the field was present in the source JSON.
func (e EntrySelection) IsSet() bool {
	return len(e.raw) > 0 && string(e.raw) != "null"
}

// Edge mirrors the Python Edge model. JSON field names use camelCase
// for sourceHandle / targetHandle to match the Python wire format.
type Edge struct {
	ID           string `json:"id"`
	Source       string `json:"source"`
	SourceHandle string `json:"sourceHandle"`
	Target       string `json:"target"`
	TargetHandle string `json:"targetHandle"`
	Type         string `json:"type"`
}

// HTTPAuthConfig describes the auth on an HTTP block.
type HTTPAuthConfig struct {
	Type     string  `json:"type"` // bearer | api_key | basic
	Token    *string `json:"token,omitempty"`
	Header   *string `json:"header,omitempty"`
	Value    *string `json:"value,omitempty"`
	Username *string `json:"username,omitempty"`
	Password *string `json:"password,omitempty"`
}

// HTTPConfig describes an HTTP request used by an HTTP block. The
// Python side stores these inside `parameters` rather than as a
// dedicated struct on the node; this type is provided for convenience
// when building executor inputs.
type HTTPConfig struct {
	URL          string            `json:"url"`
	Method       string            `json:"method,omitempty"`
	BodyTemplate *string           `json:"body_template,omitempty"`
	OutputPath   *string           `json:"output_path,omitempty"`
	Auth         *HTTPAuthConfig   `json:"auth,omitempty"`
	Headers      map[string]string `json:"headers,omitempty"`
	TimeoutMS    *int              `json:"timeout_ms,omitempty"`
}

// Component captures the union of fields a node's `data` may carry.
// Pydantic's BaseComponent is permissive — every field is optional and
// the union of subclasses can mostly be flattened. We model it as a
// single struct with optional fields rather than a Go interface to
// keep JSON round-trips byte-equivalent without per-type marshalers.
type Component struct {
	LibraryRef     *string         `json:"_library_ref,omitempty"`
	Name           *string         `json:"name,omitempty"`
	Description    *string         `json:"description,omitempty"`
	Cls            *string         `json:"cls,omitempty"`
	Parameters     []Field         `json:"parameters,omitempty"`
	Inputs         []Field         `json:"inputs,omitempty"`
	Outputs        []Field         `json:"outputs,omitempty"`
	ExecutionState *ExecutionState `json:"execution_state,omitempty"`
	WorkflowID     *string         `json:"workflow_id,omitempty"`
	PublishedID    *string         `json:"published_id,omitempty"`
	IsCustom       *bool           `json:"isCustom,omitempty"`
	VersionID      *string         `json:"version_id,omitempty"`
	BehaveAs       *string         `json:"behave_as,omitempty"`

	// Entry-specific
	Dataset        *NodeDataset    `json:"dataset,omitempty"`
	EntrySelection *EntrySelection `json:"entry_selection,omitempty"`
	TrainSize      *float64        `json:"train_size,omitempty"`
	TestSize       *float64        `json:"test_size,omitempty"`
	Seed           *int            `json:"seed,omitempty"`

	// Custom-specific
	Components  []Node          `json:"components,omitempty"`
	ForwardPass json.RawMessage `json:"forward_pass,omitempty"`

	// Agent-specific
	Agent     *string `json:"agent,omitempty"`
	AgentType *string `json:"agent_type,omitempty"`

	// Evaluator-specific
	Evaluator *string `json:"evaluator,omitempty"`
}

// Node is a workflow graph node. Type discriminates the union; Data
// carries the BaseComponent payload. Custom UnmarshalJSON validates
// Type against ComponentType but accepts unknown kinds (they are
// rejected later by the engine planner with ErrUnsupportedNodeKind).
type Node struct {
	ID   string        `json:"id"`
	Type ComponentType `json:"type"`
	Data Component     `json:"data"`
}

// WorkflowExecutionState mirrors the Python model. `Result` is left as
// a generic map so the engine can write whatever the workflow author's
// End node demands.
type WorkflowExecutionState struct {
	Status      ExecutionStatus `json:"status"`
	TraceID     *string         `json:"trace_id,omitempty"`
	UntilNodeID *string         `json:"until_node_id,omitempty"`
	Error       *string         `json:"error,omitempty"`
	Timestamps  *Timestamps     `json:"timestamps,omitempty"`
	Result      map[string]any  `json:"result,omitempty"`
}

// EvaluationExecutionState mirrors the Python model.
type EvaluationExecutionState struct {
	ExperimentID *string          `json:"experiment_id,omitempty"`
	RunID        *string          `json:"run_id,omitempty"`
	RunName      *string          `json:"run_name,omitempty"`
	Status       *ExecutionStatus `json:"status,omitempty"`
	Error        *string          `json:"error,omitempty"`
	Progress     *int             `json:"progress,omitempty"`
	Total        *int             `json:"total,omitempty"`
	Timestamps   *Timestamps      `json:"timestamps,omitempty"`
}

// OptimizationExecutionState mirrors the Python model. Retained for
// JSON round-trip parity even though the Go engine refuses to perform
// optimization (see contract.md §1 + feedback memory).
type OptimizationExecutionState struct {
	ExperimentID *string          `json:"experiment_id,omitempty"`
	RunID        *string          `json:"run_id,omitempty"`
	RunName      *string          `json:"run_name,omitempty"`
	Status       *ExecutionStatus `json:"status,omitempty"`
	Error        *string          `json:"error,omitempty"`
	Timestamps   *Timestamps      `json:"timestamps,omitempty"`
	Stdout       *string          `json:"stdout,omitempty"`
}

// WorkflowState bundles the three execution-state slots.
type WorkflowState struct {
	Execution    *WorkflowExecutionState     `json:"execution,omitempty"`
	Evaluation   *EvaluationExecutionState   `json:"evaluation,omitempty"`
	Optimization *OptimizationExecutionState `json:"optimization,omitempty"`
}

// Workflow is the top-level DSL document. Field names match the Python
// schema 1:1 so JSON produced by the Python service deserializes here
// without any massaging.
type Workflow struct {
	APIKey          string         `json:"api_key"`
	WorkflowID      string         `json:"workflow_id"`
	ProjectID       *string        `json:"project_id,omitempty"`
	ExperimentID    *string        `json:"experiment_id,omitempty"`
	SpecVersion     string         `json:"spec_version"`
	Name            string         `json:"name"`
	Icon            string         `json:"icon"`
	Description     string         `json:"description"`
	Version         string         `json:"version"`
	DefaultLLM      *LLMConfig     `json:"default_llm,omitempty"`
	Nodes           []Node         `json:"nodes"`
	Edges           []Edge         `json:"edges"`
	State           WorkflowState  `json:"state"`
	TemplateAdapter string         `json:"template_adapter"`
	EnableTracing   *bool          `json:"enable_tracing,omitempty"`
	WorkflowType    *string        `json:"workflow_type,omitempty"`
	Secrets         map[string]string `json:"secrets,omitempty"`
}

// ParseWorkflow deserializes a Workflow from JSON, returning a wrapped
// error that includes the offending offset.
func ParseWorkflow(b []byte) (*Workflow, error) {
	var w Workflow
	dec := json.NewDecoder(stringReader(b))
	dec.UseNumber() // unused for now; future-proofs precise number round-trip
	if err := json.Unmarshal(b, &w); err != nil {
		return nil, fmt.Errorf("dsl: parse workflow: %w", err)
	}
	return &w, nil
}

// stringReader is a minimal byte-slice reader used to construct a
// json.Decoder without pulling in bytes/strings packages just for the
// reader wrapper. Avoids an extra alloc per parse.
type stringReader []byte

func (s stringReader) Read(p []byte) (int, error) {
	if len(s) == 0 {
		return 0, fmt.Errorf("EOF")
	}
	n := copy(p, s)
	return n, nil
}
