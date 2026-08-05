package litellm

import (
	"reflect"
	"slices"
	"strings"
)

// Endpoint names the API surface a request is dispatched on. Reasoning
// capability is endpoint-scoped: the same model can accept reasoning
// alongside function tools on one endpoint and reject the pair on
// another. The values mirror the ModelEndpoint union in
// platform/app/src/server/modelProviders/llmModels.types.ts.
const (
	EndpointChatCompletions = "chat_completions"
	EndpointResponses       = "responses"
	EndpointMessages        = "messages"
)

// reasoningEffortDisabled is the value that turns reasoning off. Every
// model that declares it can be disabled spells it the same way, and it
// is the value the provider's own error message asks for.
const reasoningEffortDisabled = "none"

// reasoningToolConflict is one model's declared incompatibility between
// reasoning and function tools. Populated by reasoningcaps.generated.go
// from the model registry — do not hand-write entries.
type reasoningToolConflict struct {
	// conflictEndpoints are the endpoints on which the provider rejects
	// reasoning combined with function tools.
	conflictEndpoints []string
	// canDisable reports whether reasoning can be turned off, which is
	// what decides whether the conflict is fixable at dispatch.
	canDisable bool
}

// bareReasoningToolConflicts indexes the generated table by the
// provider-stripped model id, because the proxy path only ever sees the
// bare form ("gpt-5.6-sol", not "openai/gpt-5.6-sol"). A bare name that
// two providers declare differently is dropped rather than guessed at:
// silently picking one of them is how a correct model gets downgraded.
var bareReasoningToolConflicts = buildBareConflictIndex()

func buildBareConflictIndex() map[string]reasoningToolConflict {
	index := make(map[string]reasoningToolConflict, len(reasoningToolConflicts))
	ambiguous := make(map[string]bool)
	for id, conflict := range reasoningToolConflicts {
		_, bare := SplitProviderModel(id)
		if bare == "" || bare == id {
			continue
		}
		if _, seen := index[bare]; seen {
			ambiguous[bare] = true
			continue
		}
		index[bare] = conflict
	}
	for bare := range ambiguous {
		delete(index, bare)
	}
	return index
}

// reasoningToolConflictFor resolves a model id, prefixed or bare, against
// the generated table.
func reasoningToolConflictFor(modelID string) (reasoningToolConflict, bool) {
	key := strings.ToLower(modelID)
	if conflict, ok := reasoningToolConflicts[key]; ok {
		return conflict, true
	}
	conflict, ok := bareReasoningToolConflicts[key]
	return conflict, ok
}

// ReasoningToolOutcome is what EnforceReasoningToolCompat did about a
// request that carries function tools.
type ReasoningToolOutcome int

const (
	// ReasoningToolsCompatible means nothing needed doing: the model
	// declares no conflict on this endpoint, or the request carries no
	// tools. Nearly every request lands here.
	ReasoningToolsCompatible ReasoningToolOutcome = iota
	// ReasoningToolsDisabled means the conflict was resolved by pinning
	// reasoning effort to "none". The tools are untouched.
	ReasoningToolsDisabled
	// ReasoningToolsIrreconcilable means the model declares the conflict
	// on this endpoint and cannot turn reasoning off, so no rewrite of
	// this request satisfies both constraints. The body is left exactly
	// as the caller wrote it and the provider's own rejection stands.
	ReasoningToolsIrreconcilable
)

// String names the outcome for logs.
func (o ReasoningToolOutcome) String() string {
	switch o {
	case ReasoningToolsDisabled:
		return "reasoning_disabled"
	case ReasoningToolsIrreconcilable:
		return "irreconcilable"
	case ReasoningToolsCompatible:
		return "compatible"
	default:
		return "unknown"
	}
}

// EnforceReasoningToolCompat silently corrects a request whose model
// rejects reasoning combined with function tools on this endpoint.
//
// Some models 400 the pair rather than degrading:
//
//	Function tools with reasoning_effort are not supported for
//	gpt-5.6-sol in /v1/chat/completions. To use function tools, use
//	/v1/responses or set reasoning_effort to 'none'.
//
// We do not have to be sending reasoning_effort for this to bite — the
// model applies its own server-side default effort and rejects on that.
// So the fix is to pin the parameter to "none" rather than to strip it,
// and it has to happen for every request, not only the ones that set it.
//
// The correction is silent and automatic on purpose. The caller that
// triggered this in production is the scenario judge, whose whole output
// is a forced finish_test tool call: refusing the request, or dropping
// the tools to keep the reasoning, both produce a run with no verdict at
// all, which is the failure this exists to remove.
//
// It is deliberately NOT a blanket "no reasoning when tools are present"
// rule. Three conditions all have to hold, and all three come from the
// registry: the model reasons, the conflict is declared on THIS
// endpoint, and reasoning can be disabled. Most reasoning models handle
// tools fine and are left alone.
//
// modelID may be prefixed or bare. Returns the outcome so the caller can
// log it; the body is mutated in place.
func EnforceReasoningToolCompat(modelID, endpoint string, body map[string]any) ReasoningToolOutcome {
	if !bodyCarriesTools(body) {
		return ReasoningToolsCompatible
	}
	conflict, ok := reasoningToolConflictFor(modelID)
	if !ok {
		return ReasoningToolsCompatible
	}
	if !slices.Contains(conflict.conflictEndpoints, endpoint) {
		return ReasoningToolsCompatible
	}
	if !conflict.canDisable {
		// Nothing we can rewrite satisfies both constraints. Leaving the
		// request intact means the provider's own 400 surfaces with its
		// own explanation, which beats a confident answer produced by a
		// request we quietly stripped the tools out of. Routing these to
		// /v1/responses is the standing follow-up.
		return ReasoningToolsIrreconcilable
	}
	// Collapse the alias spellings first: setting reasoning_effort while
	// leaving a stale `reasoning` or `thinkingLevel` behind sends the
	// provider two answers to the same question.
	NormalizeReasoningEffort(body)
	body["reasoning_effort"] = reasoningEffortDisabled
	return ReasoningToolsDisabled
}

// bodyCarriesTools reports whether the request declares function tools.
// A present-but-empty `tools` array is not a tool call, and providers
// treat it as absent, so we do too.
func bodyCarriesTools(body map[string]any) bool {
	tools, ok := body["tools"]
	if !ok || tools == nil {
		return false
	}
	// The proxy path unmarshals JSON and hands us []any; the in-process
	// executor path builds the body in Go and hands us a typed slice
	// (today []app.Tool). Reflection covers both without this package
	// importing the executor's types.
	value := reflect.ValueOf(tools)
	switch value.Kind() {
	case reflect.Slice, reflect.Array:
		return value.Len() > 0
	default:
		return true
	}
}
