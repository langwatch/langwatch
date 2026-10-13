package targets

import (
	"go.uber.org/zap"

	"github.com/langwatch/langwatch/services/scenariorunner/internal/jsjson"
	"github.com/langwatch/langwatch/services/scenariorunner/llm"
)

// UnsupportedVoiceMessage is the refusal of a voice target. The Node child
// dials voice through transports that live with the scenario module's live
// voice session; the Go runner has no port of them yet.
const UnsupportedVoiceMessage = "Voice targets are not supported by the Go scenario runner yet; run this scenario on the Node scenario child."

// BuildInput is everything an adapter is built from.
type BuildInput struct {
	Data              AdapterData
	ModelParams       LiteLLMParams
	NLPServiceURL     string
	NLPInternalSecret string
	ProjectAPIKey     string
	Route             *ExecuteSyncRoute
	Parameters        *jsjson.Object
	HTTP              HTTPDoer
	Timeouts          NLPTimeouts
	Logger            *zap.Logger
}

// Build returns the adapter for a target, or the refusal the Node child's
// runtime table gives when the target lacks what it needs.
func Build(in BuildInput) (Agent, error) {
	switch in.Data.Type {
	case "prompt":
		return buildPrompt(in)
	case "http":
		return NewHTTPAgent(HTTPAgentOptions{Config: *in.Data.HTTP, Parameters: in.Parameters, HTTP: in.HTTP, Logger: in.Logger}), nil
	case "code":
		if in.ProjectAPIKey == "" {
			return nil, newError("Code adapter requires projectApiKey")
		}
		return NewCodeAgent(*in.Data.Code, in.engineOptions()), nil
	case "workflow":
		if in.ProjectAPIKey == "" {
			return nil, newError("Workflow adapter requires projectApiKey")
		}
		return NewWorkflowAgent(*in.Data.Workflow, in.engineOptions()), nil
	case "connected":
		if in.ProjectAPIKey == "" {
			return nil, newError("Connected adapter requires projectApiKey")
		}
		return NewConnectedAgent(*in.Data.Connected, ConnectedAgentOptions{
			ProjectAPIKey: in.ProjectAPIKey, Parameters: in.Parameters, Logger: in.Logger,
		}), nil
	}
	return nil, newError(UnsupportedVoiceMessage)
}

func buildPrompt(in BuildInput) (Agent, error) {
	if in.ModelParams == nil {
		return nil, newError("Prompt adapter requires modelParams")
	}
	model := llm.New(llm.Options{Params: in.ModelParams, NLPServiceURL: in.NLPServiceURL, Secret: in.NLPInternalSecret})
	return NewPromptAgent(*in.Data.Prompt, PromptAgentOptions{
		Model: model, ModelName: in.ModelParams.Model(), Parameters: in.Parameters, Logger: in.Logger,
	}), nil
}

func (in BuildInput) engineOptions() EngineAgentOptions {
	return EngineAgentOptions{
		ProjectAPIKey: in.ProjectAPIKey,
		Parameters:    in.Parameters,
		Timeouts:      in.Timeouts,
		Transport: TransportInput{
			Route:             in.Route,
			NLPServiceURL:     in.NLPServiceURL,
			NLPInternalSecret: in.NLPInternalSecret,
			ProjectAPIKey:     in.ProjectAPIKey,
		},
	}
}
