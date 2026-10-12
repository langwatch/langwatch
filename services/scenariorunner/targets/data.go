package targets

import (
	"encoding/json"
	"errors"
	"fmt"

	"github.com/langwatch/langwatch/services/scenariorunner/internal/jsjson"
)

// IO is a declared input or output of a code, workflow or prompt target.
type IO struct {
	Identifier string `json:"identifier"`
	Type       string `json:"type"`
}

// AuthConfig is an HTTP target's authentication; which fields count depends
// on Type (none, bearer, api_key, basic).
type AuthConfig struct {
	Type     string  `json:"type"`
	Token    string  `json:"token,omitempty"`
	Header   string  `json:"header,omitempty"`
	Value    string  `json:"value,omitempty"`
	Username string  `json:"username,omitempty"`
	Password *string `json:"password,omitempty"`
}

// HeaderEntry is one configured request header.
type HeaderEntry struct {
	Key   string `json:"key"`
	Value string `json:"value"`
}

// HTTPAgentData is a prefetched HTTP target.
type HTTPAgentData struct {
	AgentID          string            `json:"agentId"`
	URL              string            `json:"url"`
	Method           string            `json:"method"`
	Headers          []HeaderEntry     `json:"headers"`
	Auth             *AuthConfig       `json:"auth,omitempty"`
	BodyTemplate     *string           `json:"bodyTemplate,omitempty"`
	OutputPath       *string           `json:"outputPath,omitempty"`
	SessionPath      *string           `json:"sessionPath,omitempty"`
	ScenarioMappings Mappings          `json:"scenarioMappings"`
	Secrets          map[string]string `json:"secrets"`
}

// CodeAgentData is a prefetched code target: Python run on the engine.
type CodeAgentData struct {
	AgentID             string            `json:"agentId"`
	Code                string            `json:"code"`
	Inputs              []IO              `json:"inputs"`
	Outputs             []IO              `json:"outputs"`
	ScenarioMappings    Mappings          `json:"scenarioMappings"`
	ScenarioOutputField *string           `json:"scenarioOutputField,omitempty"`
	Secrets             map[string]string `json:"secrets"`
	SandboxAPIKey       *string           `json:"sandboxApiKey,omitempty"`
	TimeoutMs           *int              `json:"timeoutMs,omitempty"`
}

// WorkflowAgentData is a prefetched published workflow.
type WorkflowAgentData struct {
	AgentID             string            `json:"agentId"`
	WorkflowID          string            `json:"workflowId"`
	Workflow            *jsjson.Object    `json:"-"`
	Inputs              []IO              `json:"inputs"`
	Outputs             []IO              `json:"outputs"`
	ScenarioMappings    Mappings          `json:"scenarioMappings"`
	ScenarioOutputField *string           `json:"scenarioOutputField,omitempty"`
	Secrets             map[string]string `json:"secrets"`
}

// ConnectedAgentData is a connected agent reached through the relay.
type ConnectedAgentData struct {
	AgentID   string `json:"agentId"`
	Endpoint  string `json:"endpoint"`
	TimeoutMs int    `json:"timeoutMs"`
}

// PromptMessage is one templated message of a prompt.
type PromptMessage struct {
	Role    string `json:"role"`
	Content string `json:"content"`
}

// PromptConfigData is a prefetched prompt.
type PromptConfigData struct {
	PromptID         string          `json:"promptId"`
	SystemPrompt     string          `json:"systemPrompt"`
	Messages         []PromptMessage `json:"messages"`
	Inputs           []IO            `json:"inputs"`
	ScenarioMappings Mappings        `json:"scenarioMappings"`
	Model            *string         `json:"model,omitempty"`
	Temperature      *float64        `json:"temperature,omitempty"`
	MaxTokens        *float64        `json:"maxTokens,omitempty"`
}

// VoiceAgentData is a voice target. The Go runner carries it only to refuse it.
type VoiceAgentData struct {
	AgentID     string `json:"agentId"`
	VoiceTarget struct {
		Transport     string `json:"transport"`
		CallDirection string `json:"callDirection,omitempty"`
	} `json:"voiceTarget"`
}

// AdapterData is the target a job runs against; exactly one field is set.
type AdapterData struct {
	Type      string
	Prompt    *PromptConfigData
	HTTP      *HTTPAgentData
	Code      *CodeAgentData
	Workflow  *WorkflowAgentData
	Connected *ConnectedAgentData
	Voice     *VoiceAgentData
}

// UnmarshalJSON decodes the union by its `type`.
func (a *AdapterData) UnmarshalJSON(data []byte) error {
	var head struct {
		Type string `json:"type"`
	}
	if err := json.Unmarshal(data, &head); err != nil {
		return err
	}
	a.Type = head.Type
	switch head.Type {
	case "prompt":
		return decodeInto(data, &a.Prompt)
	case "http":
		return decodeInto(data, &a.HTTP)
	case "code":
		return decodeInto(data, &a.Code)
	case "workflow":
		return a.decodeWorkflow(data)
	case "connected":
		return decodeInto(data, &a.Connected)
	case "voice":
		return decodeInto(data, &a.Voice)
	}
	return fmt.Errorf("adapterData.type: unknown target type %q", head.Type)
}

func decodeInto[T any](data []byte, dst **T) error {
	var v T
	if err := json.Unmarshal(data, &v); err != nil {
		return err
	}
	*dst = &v
	return nil
}

func (a *AdapterData) decodeWorkflow(data []byte) error {
	if err := decodeInto(data, &a.Workflow); err != nil {
		return err
	}
	var raw struct {
		Workflow json.RawMessage `json:"workflow"`
	}
	if err := json.Unmarshal(data, &raw); err != nil {
		return err
	}
	parsed, err := jsjson.Parse(raw.Workflow)
	if err != nil {
		return fmt.Errorf("adapterData.workflow: %w", err)
	}
	obj, ok := parsed.(*jsjson.Object)
	if !ok {
		return errors.New("adapterData.workflow: expected an object")
	}
	a.Workflow.Workflow = obj
	return nil
}

// UnmarshalJSON keeps the mappings in the order the job lists them.
func (m *Mappings) UnmarshalJSON(data []byte) error {
	parsed, err := jsjson.Parse(data)
	if err != nil {
		return err
	}
	if parsed == nil {
		return nil
	}
	obj, ok := parsed.(*jsjson.Object)
	if !ok {
		return errors.New("scenarioMappings: expected an object")
	}
	for _, k := range obj.Keys() {
		v, _ := obj.Get(k)
		var f FieldMapping
		if err := json.Unmarshal([]byte(jsjson.Stringify(v)), &f); err != nil {
			return fmt.Errorf("scenarioMappings.%s: %w", k, err)
		}
		if err := f.validate(); err != nil {
			return fmt.Errorf("scenarioMappings.%s: %w", k, err)
		}
		m.add(k, f)
	}
	return nil
}

func (f FieldMapping) validate() error {
	switch f.Type {
	case "source":
		if f.Path == nil {
			return errors.New("a source mapping needs a path")
		}
	case "value":
	default:
		return fmt.Errorf("unknown mapping type %q", f.Type)
	}
	return nil
}

// LiteLLMParams are the model params a role runs on: `model`, an optional
// `api_key`, and any other string the provider needs.
type LiteLLMParams map[string]string

// Model is the `model` param.
func (p LiteLLMParams) Model() string { return p["model"] }
