package scenariorunner

import (
	"context"
	"errors"

	scenario "github.com/langwatch/scenario/go"
	"go.uber.org/zap"

	"github.com/langwatch/langwatch/services/scenariorunner/internal/jsjson"
	"github.com/langwatch/langwatch/services/scenariorunner/llm"
	"github.com/langwatch/langwatch/services/scenariorunner/targets"
)

// Runtime is what a job runs with, read from the environment the parent stated.
type Runtime struct {
	Endpoint          string
	APIKey            string
	Verbose           bool
	HTTP              targets.HTTPDoer
	NLPInternalSecret string
	NLPTimeouts       targets.NLPTimeouts
	Logger            *zap.Logger
}

// RunSimulation runs a whole scenario. A failed verdict is still a
// successful execution: the verdict reaches LangWatch through the SDK's
// events, and only an error returns one here.
func RunSimulation(ctx context.Context, job *SimulationJob, rt Runtime) (SimulationResult, error) {
	target, err := targets.Build(targets.BuildInput{
		Data:              job.AdapterData,
		ModelParams:       job.ModelParams,
		NLPServiceURL:     job.NLPServiceURL,
		NLPInternalSecret: rt.NLPInternalSecret,
		ProjectAPIKey:     rt.APIKey,
		Route:             job.ExecuteSyncRoute,
		Parameters:        job.Parameters,
		HTTP:              rt.HTTP,
		Timeouts:          rt.NLPTimeouts,
		Logger:            rt.Logger,
	})
	if err != nil {
		return SimulationResult{}, err
	}
	agent := sdkAgentFor(job.AdapterData.Type, target)
	cfg, err := scenarioConfig(job, agent, rt)
	if err != nil {
		return SimulationResult{}, err
	}
	result, err := scenario.Run(ctx, cfg, runOptions(job, rt)...)
	var assertion *scenario.AssertionError
	if err != nil && !errors.As(err, &assertion) {
		return SimulationResult{}, err
	}
	return outcome(result, target, rt.Logger), nil
}

func outcome(result *scenario.ScenarioResult, target targets.Agent, logger *zap.Logger) SimulationResult {
	out := SimulationResult{}
	if result != nil {
		out.Success, out.Reasoning = result.Success, result.Reasoning
	}
	if out.Success {
		logger.Info("scenario passed")
	} else {
		logger.Warn("scenario failed", zap.String("reasoning", out.Reasoning))
	}
	if served, ok := target.(targets.Served); ok {
		out.AgentInstance = served.ServedInstance()
	}
	return out
}

func runOptions(job *SimulationJob, rt Runtime) []scenario.RunOption {
	opts := []scenario.RunOption{
		scenario.WithBatchRunID(job.Context.BatchRunID),
		scenario.WithLangWatch(scenario.LangWatchConfig{Endpoint: rt.Endpoint, APIKey: rt.APIKey}),
	}
	if job.ScenarioRunID != nil && *job.ScenarioRunID != "" {
		opts = append(opts, scenario.WithRunID(*job.ScenarioRunID))
	}
	return opts
}

// scenarioConfig is the SDK run: who takes part, the script for an agent
// test, the turn bounds and the metadata the platform reads back.
func scenarioConfig(job *SimulationJob, agent scenario.AgentAdapter, rt Runtime) (scenario.ScenarioConfig, error) {
	cfg := scenario.ScenarioConfig{
		ID:          job.Scenario.ID,
		Name:        job.Scenario.Name,
		Description: job.Scenario.Situation,
		SetID:       job.Context.SetID,
		Verbose:     rt.Verbose,
		Metadata:    runMetadata(job),
	}
	if job.Scenario.MaxTurns != nil {
		cfg.MaxTurns = *job.Scenario.MaxTurns
	}
	if job.Scenario.MinTurns != nil {
		cfg.MinTurns = *job.Scenario.MinTurns
	}
	if job.Script != nil {
		cfg.Agents = []scenario.AgentAdapter{agent, scriptedUserAgent{}}
		cfg.Script = []scenario.ScriptStep{
			scenario.User(job.Script.UserMessage), scenario.Agent(), scenario.Succeed("The agent answered"),
		}
		return cfg, nil
	}
	simulator, judge, err := roleModels(job, rt)
	if err != nil {
		return cfg, err
	}
	cfg.Agents = []scenario.AgentAdapter{
		agent,
		scenario.NewUserSimulatorAgent(scenario.UserSimulatorAgentConfig{ModelConfig: modelConfig(simulator)}),
		scenario.NewJudgeAgent(scenario.JudgeAgentConfig{ModelConfig: modelConfig(judge), Criteria: job.Scenario.Criteria}),
	}
	return cfg, nil
}

func modelConfig(c *llm.Client) scenario.ModelConfig {
	return scenario.ModelConfig{LLM: c, Model: c.Model()}
}

// roleModels are the simulator's and the judge's models, each role's own
// params falling back to the legacy shared modelParams.
func roleModels(job *SimulationJob, rt Runtime) (*llm.Client, *llm.Client, error) {
	simulator, judge := job.SimulatorModelParams, job.JudgeModelParams
	if simulator == nil {
		simulator = job.ModelParams
	}
	if judge == nil {
		judge = job.ModelParams
	}
	if simulator == nil || judge == nil {
		return nil, nil, errors.New("Job payload carries no model params for the user simulator or the judge, and no modelParams to fall back to")
	}
	opts := func(p targets.LiteLLMParams) llm.Options {
		return llm.Options{Params: p, NLPServiceURL: job.NLPServiceURL, Secret: rt.NLPInternalSecret}
	}
	return llm.New(opts(simulator)), llm.NewJudge(opts(judge)), nil
}

// runMetadata is what the platform reads back off the run.
func runMetadata(job *SimulationJob) map[string]any {
	md := map[string]any{
		"langwatch": map[string]any{
			"targetReferenceId": job.Target.ReferenceID,
			"targetType":        job.Target.Type,
		},
	}
	if job.Parameters != nil && job.Parameters.Len() > 0 {
		params := make(map[string]any, job.Parameters.Len())
		for _, k := range job.Parameters.Keys() {
			params[k], _ = job.Parameters.Get(k)
		}
		md["parameters"] = params
	}
	return md
}

// paramsOf is the run's parameters, never nil.
func paramsOf(p *jsjson.Object) *jsjson.Object {
	if p == nil {
		return jsjson.NewObject()
	}
	return p
}
