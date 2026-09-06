package providers

import (
	"fmt"
	"sort"
	"strings"

	bfschemas "github.com/maximhq/bifrost/core/schemas"
	"github.com/tidwall/gjson"
)

// Parameter policy for the translated chat lanes.
//
// Raw-forward lanes (OpenAI, Azure, vLLM) pass the body through
// byte-identical and are never consulted here: whatever the provider
// accepts, the client gets. The translated lanes (Anthropic, Bedrock,
// Gemini, Vertex, and the Bedrock VPCE path) are different: the gateway
// builds the provider request itself, so every OpenAI chat-completions
// parameter needs an explicit disposition or it silently disagrees with
// the client (#6290). This table is the single source of truth:
//
//   - dispMapped: the parameter reaches the provider faithfully, either
//     through the bifrost translator or through a mapping this layer
//     performs itself.
//   - dispDropped (tier 3): a tuning parameter with no equivalent on the
//     lane. With drop_tuning_params true (the default) the parameter is removed
//     and the request proceeds, and the drop is signaled on the response
//     (params_dropped, response header, span attribute). With drop_tuning_params
//     false the request is refused instead.
//   - dispRefused (tier 2): the request depends on the parameter
//     functionally; honoring the request without it would change what the
//     client observably gets. Always refused, regardless of drop_tuning_params.
//
// The docs page docs/ai-gateway/parameter-mapping.mdx renders
// this table; TestParamPolicyDocsInSync keeps the two from drifting.

// policyLane identifies a translated lane for parameter policy. Vertex
// dispatches through the gemini translation and shares laneGemini; the
// Bedrock VPCE path shares laneBedrock, which is what keeps it from
// diverging from the public bedrock lane again.
type policyLane string

const (
	laneAnthropic policyLane = "anthropic"
	laneBedrock   policyLane = "bedrock"
	laneGemini    policyLane = "gemini"
)

// policyLaneFor maps a dispatch target onto its policy lane. The second
// return is false for raw-forward providers, which bypass the policy
// entirely.
func policyLaneFor(provider bfschemas.ModelProvider) (policyLane, bool) {
	if isOpenAICompatibleProvider(provider) {
		return "", false
	}
	switch bfschemas.ModelProvider(baseProviderType(provider)) {
	case bfschemas.Anthropic:
		return laneAnthropic, true
	case bfschemas.Bedrock:
		return laneBedrock, true
	case bfschemas.Gemini, bfschemas.Vertex:
		return laneGemini, true
	default:
		// Other structured lanes (xai, groq, cerebras, elevenlabs ...)
		// speak the OpenAI parameter surface natively through bifrost's
		// openai-shape converters; nothing to police at this layer.
		return "", false
	}
}

// baseProviderType collapses derived provider keys (the per-endpoint
// anthropic-compat providers) onto their base type so the policy treats
// a self-hosted Anthropic-compatible server like the anthropic lane.
func baseProviderType(provider bfschemas.ModelProvider) string {
	if len(provider) > len(anthropicCompatPrefix) && string(provider[:len(anthropicCompatPrefix)]) == anthropicCompatPrefix {
		return string(bfschemas.Anthropic)
	}
	return string(provider)
}

type disposition int

const (
	dispMapped disposition = iota
	dispDropped
	dispRefused
)

// ruleCtx carries what value-dependent rules may inspect.
type ruleCtx struct {
	body   []byte
	params *bfschemas.ChatParameters
	lane   policyLane
	model  string
	value  gjson.Result
	// strict is `drop_tuning_params: false`: a droppable parameter refuses
	// instead of dropping.
	strict bool
}

func (rc ruleCtx) laneLabel() string {
	return fmt.Sprintf("%s/%s", rc.lane, rc.model)
}

type paramRule struct {
	disp disposition
	// why completes the refusal sentence for dispRefused ("the request
	// depends on it functionally (<why>)") and documents the drop for
	// dispDropped.
	why string
	// note is the docs-table annotation for value-dependent rules; the
	// rendered docs page carries it in the notes column.
	note string
	// refine adjusts the disposition based on the request value, model
	// family, or parameter combination. Optional.
	refine func(rc ruleCtx) (disposition, string)
	// clear removes the parameter from the typed params so a translator
	// that would forward it badly cannot see it. Only needed where the
	// translator reads the field; parameters the translators already
	// ignore need no clearing. Optional.
	clear func(p *bfschemas.ChatParameters)
}

// mapped is the shorthand for parameters the lane translates faithfully.
func mapped() paramRule { return paramRule{disp: dispMapped} }

func dropped(why string) paramRule { return paramRule{disp: dispDropped, why: why} }

func refused(why string) paramRule { return paramRule{disp: dispRefused, why: why} }

// paramPolicyDefaultRule governs request keys the table does not name
// (vendor params like min_p, repetition_penalty, chat_template_kwargs):
// no translated lane can map them, so they are droppable tuning knobs.
var paramPolicyDefaultRule = dropped("this lane has no mapping for it")

// paramPolicyIgnoredKeys are body keys that are not provider parameters:
// routing and transport fields the gateway consumes itself, plus the
// extension keys the parser lifts explicitly.
var paramPolicyIgnoredKeys = map[string]bool{
	"model":              true,
	"messages":           true,
	"stream":             true,
	"drop_tuning_params": true,
	// Lifted extension keys (see chatExtensionKeys).
	"cached_content":  true,
	"safety_settings": true,
	"labels":          true,
	// The cap pair is normalized by liftMaxTokensAlias and mapped on
	// every translated lane (#6285).
	"max_tokens":            true,
	"max_completion_tokens": true,
	// Anthropic-native knobs promoted to the neutral layer; they pass
	// through typed and are honored or ignored per provider feature set.
	"top_k":                true,
	"speed":                true,
	"inference_geo":        true,
	"mcp_servers":          true,
	"container":            true,
	"cache_control":        true,
	"task_budget":          true,
	"context_management":   true,
	"thinking":             true,
	"reasoning":            true,
	"reasoning_max_tokens": true,
	// fallbacks is bifrost transport config, stripped downstream.
	"fallbacks": true,
}

// refineN keeps n: 1 mapped (it is the default) and classifies n > 1 as
// droppable: the translators produce a single choice, so the drop is
// "you get one completion", signaled, never silent.
func refineN(rc ruleCtx) (disposition, string) {
	if rc.value.Type == gjson.Number && rc.value.Int() <= 1 {
		return dispMapped, ""
	}
	return dispDropped, "the lane returns a single completion; n was reduced to 1"
}

// refineResponseFormat: json_schema is enforced on every translated lane;
// json_object has no sound mechanism on the Anthropic families (the model
// answers fenced markdown, which breaks clients that json-parse the
// guarantee), so it is contract-refused there and mapped on gemini.
func refineResponseFormat(rc ruleCtx) (disposition, string) {
	switch rc.value.Get("type").String() {
	case "json_object":
		if rc.lane == laneGemini {
			return dispMapped, ""
		}
		return dispRefused, "the response would not be guaranteed parseable JSON on this lane"
	case "json_schema", "":
		return dispMapped, ""
	default:
		return dispMapped, ""
	}
}

// refineServiceTier: OpenAI's values do not exist on these lanes.
// Anthropic accepts "auto" natively so that single value is mapped;
// everything else would either 400 upstream (Bedrock validates it against
// a different enum) or mislead, so it is droppable, and clearing the
// typed field keeps the translators from forwarding it verbatim.
func refineServiceTier(rc ruleCtx) (disposition, string) {
	if rc.lane == laneAnthropic && rc.value.String() == "auto" {
		return dispMapped, ""
	}
	return dispDropped, "the lane has no OpenAI-compatible service tiers"
}

// refineTopP drops top_p (with a signal) when temperature is also set
// and the target is an Anthropic model: the models reject the pair with a
// hard 400 ("temperature and top_p cannot both be specified"), verified
// live on both the anthropic and bedrock lanes. Temperature wins, which
// matches what bifrost's translator silently did; the difference is the
// drop is now visible. Alone, top_p maps faithfully everywhere.
func refineTopP(rc ruleCtx) (disposition, string) {
	if rc.params.Temperature == nil || rc.params.TopP == nil {
		return dispMapped, ""
	}
	if rc.lane == laneBedrock && !bfschemas.IsAnthropicModel(rc.model) {
		return dispMapped, ""
	}
	return dispDropped, "Anthropic models reject temperature and top_p together; temperature wins"
}

func clearTopP(p *bfschemas.ChatParameters) { p.TopP = nil }

// refineBedrockReasoning refuses reasoning_effort for Bedrock model
// families where bifrost would silently drop the reasoning AND force the
// output cap to a model default the caller never sent. Anthropic and Nova
// families map it faithfully.
func refineBedrockReasoning(rc ruleCtx) (disposition, string) {
	if bedrockModelSupportsReasoning(rc.model) {
		return dispMapped, ""
	}
	return dispRefused, "this Bedrock model family has no reasoning mapping and the requested reasoning depth would be silently ignored"
}

// refineToolChoice polices the shapes the translators mistranslate:
//   - "none" on Bedrock: Converse has no none mode and bifrost drops the
//     field, which lets the model call tools it was told not to call. The
//     policy maps it faithfully by removing the tools instead.
//   - a named function that is not in tools: bifrost's bedrock translator
//     silently nulls it and Converse rejects it downstream; refuse with a
//     message that names the problem.
//   - "allowed_tools": Anthropic's translator collapses it to "any" and
//     discards the list; the other lanes drop it. Functional, refused.
func refineToolChoice(rc ruleCtx) (disposition, string) {
	if rc.value.Type == gjson.String {
		return dispMapped, ""
	}
	choiceType := rc.value.Get("type").String()
	switch choiceType {
	case "allowed_tools":
		return dispRefused, "the allowed tool list would be discarded in translation"
	case "function":
		name := rc.value.Get("function.name").String()
		if name != "" && !toolListContains(rc.body, name) {
			return dispRefused, fmt.Sprintf("tool_choice names %q but no tool with that name is in tools", name)
		}
	}
	return dispMapped, ""
}

func toolListContains(body []byte, name string) bool {
	found := false
	gjson.GetBytes(body, "tools").ForEach(func(_, tool gjson.Result) bool {
		if tool.Get("function.name").String() == name {
			found = true
			return false
		}
		return true
	})
	return found
}

// paramPolicyTable is the per-parameter, per-lane disposition table. Keys
// are the OpenAI wire names. A parameter absent here falls to
// paramPolicyDefaultRule.
var paramPolicyTable = map[string]map[policyLane]paramRule{
	"temperature": {
		laneAnthropic: mapped(), laneBedrock: mapped(), laneGemini: mapped(),
	},
	"top_p": {
		laneAnthropic: {disp: dispMapped, refine: refineTopP, clear: clearTopP, note: "dropped with a signal when temperature is also set (Anthropic models reject the pair)"},
		laneBedrock:   {disp: dispMapped, refine: refineTopP, clear: clearTopP, note: "dropped with a signal when temperature is also set on Anthropic models (they reject the pair); other families take both"},
		laneGemini:    mapped(),
	},
	"stop": {
		// The bare-string form is normalized to a list by the parser
		// (liftStopString), so both OpenAI shapes map on every lane.
		laneAnthropic: mapped(), laneBedrock: mapped(), laneGemini: mapped(),
	},
	"n": {
		laneAnthropic: {disp: dispDropped, refine: refineN, note: "n: 1 passes; n > 1 is reduced to one completion and signaled"},
		laneBedrock:   {disp: dispDropped, refine: refineN, note: "n: 1 passes; n > 1 is reduced to one completion and signaled"},
		laneGemini:    {disp: dispDropped, refine: refineN, note: "n: 1 passes; n > 1 is reduced to one completion and signaled"},
	},
	"presence_penalty": {
		laneAnthropic: dropped("Anthropic has no presence penalty"),
		laneBedrock:   dropped("Bedrock Converse has no presence penalty"),
		laneGemini:    mapped(),
	},
	"frequency_penalty": {
		laneAnthropic: dropped("Anthropic has no frequency penalty"),
		laneBedrock:   dropped("Bedrock Converse has no frequency penalty"),
		laneGemini:    mapped(),
	},
	"logit_bias": {
		laneAnthropic: dropped("Anthropic has no logit bias"),
		laneBedrock:   dropped("Bedrock Converse has no logit bias"),
		laneGemini:    dropped("Gemini has no logit bias"),
	},
	"logprobs": {
		laneAnthropic: refused("the requested log probabilities would be silently absent from the response"),
		laneBedrock:   refused("the requested log probabilities would be silently absent from the response"),
		laneGemini:    mapped(),
	},
	"top_logprobs": {
		laneAnthropic: refused("the requested log probabilities would be silently absent from the response"),
		laneBedrock:   refused("the requested log probabilities would be silently absent from the response"),
		laneGemini:    mapped(),
	},
	"seed": {
		laneAnthropic: dropped("Anthropic has no sampling seed"),
		laneBedrock:   dropped("Bedrock Converse has no sampling seed"),
		laneGemini:    dropped("the Gemini translation does not map a sampling seed"),
	},
	"user": {
		laneAnthropic: dropped("not mapped on this lane"),
		laneBedrock:   dropped("not mapped on this lane"),
		laneGemini:    dropped("not mapped on this lane"),
	},
	"response_format": {
		laneAnthropic: {disp: dispMapped, refine: refineResponseFormat, note: "json_schema enforced; json_object refused (no parseable-JSON guarantee)"},
		laneBedrock:   {disp: dispMapped, refine: refineResponseFormat, note: "json_schema enforced; json_object refused (no parseable-JSON guarantee); a customer VPC endpoint enforces json_schema for Anthropic models only"},
		laneGemini:    {disp: dispMapped, refine: refineResponseFormat, note: "json_object and json_schema both enforced"},
	},
	"tools": {
		laneAnthropic: mapped(), laneBedrock: mapped(), laneGemini: mapped(),
	},
	"tool_choice": {
		laneAnthropic: {disp: dispMapped, refine: refineToolChoice, note: "none/auto/required/named mapped; named must exist in tools; allowed_tools refused"},
		laneBedrock:   {disp: dispMapped, refine: refineToolChoice, note: "none maps by removing tools (Converse has no none mode); named must exist in tools; allowed_tools refused"},
		laneGemini:    {disp: dispMapped, refine: refineToolChoice, note: "none/auto/required/named mapped; named must exist in tools; allowed_tools refused"},
	},
	"parallel_tool_calls": {
		laneAnthropic: dropped("not mapped on this lane"),
		laneBedrock:   dropped("not mapped on this lane"),
		laneGemini:    dropped("not mapped on this lane"),
	},
	"stream_options": {
		// Translated lanes emit native usage on every stream; the flag has
		// nothing to switch.
		laneAnthropic: mapped(), laneBedrock: mapped(), laneGemini: mapped(),
	},
	"reasoning_effort": {
		laneAnthropic: mapped(),
		laneBedrock:   {disp: dispMapped, refine: refineBedrockReasoning, note: "mapped for Anthropic (thinking) and Nova; refused for other families; a customer VPC endpoint maps Anthropic only"},
		laneGemini:    mapped(),
	},
	"verbosity": {
		laneAnthropic: dropped("not mapped on this lane"),
		laneBedrock:   dropped("not mapped on this lane"),
		laneGemini:    dropped("not mapped on this lane"),
	},
	"prediction": {
		laneAnthropic: dropped("predicted outputs are OpenAI-only"),
		laneBedrock:   dropped("predicted outputs are OpenAI-only"),
		laneGemini:    dropped("predicted outputs are OpenAI-only"),
	},
	"modalities": {
		laneAnthropic: dropped("not mapped on this lane"),
		laneBedrock:   dropped("not mapped on this lane"),
		laneGemini:    dropped("not mapped on this lane"),
	},
	"audio": {
		laneAnthropic: dropped("audio output is not mapped on this lane"),
		laneBedrock:   dropped("audio output is not mapped on this lane"),
		laneGemini:    dropped("audio output is not mapped on this lane"),
	},
	"store": {
		laneAnthropic: dropped("not mapped on this lane"),
		laneBedrock:   dropped("not mapped on this lane"),
		laneGemini:    dropped("not mapped on this lane"),
	},
	"metadata": {
		laneAnthropic: dropped("not mapped on this lane"),
		laneBedrock:   dropped("not mapped on this lane"),
		laneGemini:    dropped("not mapped on this lane"),
	},
	"service_tier": {
		laneAnthropic: {disp: dispDropped, refine: refineServiceTier, clear: clearServiceTier, note: "\"auto\" passes natively; other values dropped"},
		laneBedrock:   {disp: dispDropped, refine: refineServiceTier, clear: clearServiceTier, note: "dropped (AWS validates a different enum)"},
		laneGemini:    {disp: dispDropped, refine: refineServiceTier, clear: clearServiceTier, note: "dropped"},
	},
	"web_search_options": {
		laneAnthropic: dropped("web search is not mapped on this lane"),
		laneBedrock:   dropped("web search is not mapped on this lane"),
		laneGemini:    dropped("web search is not mapped on this lane"),
	},
	"prompt_cache_key": {
		laneAnthropic: dropped("OpenAI prompt-cache routing does not exist on this lane"),
		laneBedrock:   dropped("OpenAI prompt-cache routing does not exist on this lane"),
		laneGemini:    dropped("OpenAI prompt-cache routing does not exist on this lane"),
	},
	"prompt_cache_retention": {
		laneAnthropic: dropped("OpenAI prompt-cache routing does not exist on this lane"),
		laneBedrock:   dropped("OpenAI prompt-cache routing does not exist on this lane"),
		laneGemini:    dropped("OpenAI prompt-cache routing does not exist on this lane"),
	},
	"safety_identifier": {
		laneAnthropic: dropped("not mapped on this lane"),
		laneBedrock:   dropped("not mapped on this lane"),
		laneGemini:    dropped("not mapped on this lane"),
	},
	"functions": {
		laneAnthropic: refused("the legacy function-calling tools would be silently discarded; use tools"),
		laneBedrock:   refused("the legacy function-calling tools would be silently discarded; use tools"),
		laneGemini:    refused("the legacy function-calling tools would be silently discarded; use tools"),
	},
	"function_call": {
		laneAnthropic: refused("the legacy function-calling directive would be silently discarded; use tool_choice"),
		laneBedrock:   refused("the legacy function-calling directive would be silently discarded; use tool_choice"),
		laneGemini:    refused("the legacy function-calling directive would be silently discarded; use tool_choice"),
	},
}

func clearServiceTier(p *bfschemas.ChatParameters) { p.ServiceTier = nil }

// bedrockModelSupportsReasoning mirrors the families bifrost maps
// reasoning for on Converse: Anthropic models (thinking) and Amazon Nova
// (maxReasoningEffort). Everything else drops reasoning inside bifrost
// while force-setting an output cap, which is what the policy refuses.
// Uses bifrost's own family matchers so the policy and the translator
// can never disagree about a model's family.
func bedrockModelSupportsReasoning(model string) bool {
	return bfschemas.IsAnthropicModel(model) || bfschemas.IsNovaModel(model)
}

// paramPolicyResult is what applyParamPolicy reports back for the
// response-side signals.
type paramPolicyResult struct {
	dropped []string
}

// dropParamsDefault: tier-3 parameters are dropped (with a signal) unless
// the client opts into strict mode with "drop_tuning_params": false.
func dropTuningParamsEnabled(body []byte) bool {
	return gjson.GetBytes(body, "drop_tuning_params").Type != gjson.False
}

// ruleFor is the lane's rule for one request key; a key the table does
// not know falls back to the default (dropped) rule.
func ruleFor(name string, lane policyLane) paramRule {
	laneRules, known := paramPolicyTable[name]
	if !known {
		return paramPolicyDefaultRule
	}
	return laneRules[lane]
}

// resolveDisposition applies the rule's refinement, if it has one, keeping
// the table's static reason when the refinement supplies none.
func resolveDisposition(rule paramRule, rc ruleCtx) (disposition, string) {
	if rule.refine == nil {
		return rule.disp, rule.why
	}
	disp, why := rule.refine(rc)
	if why == "" {
		why = rule.why
	}
	return disp, why
}

func refusedFunctionally(name, laneLabel, why string) *paramRefusalError {
	return &paramRefusalError{msg: fmt.Sprintf(
		"refusing to drop '%s' for %s: the request depends on it functionally (%s). Remove it, or use a model that supports it",
		name, laneLabel, why)}
}

func refusedStrictMode(name, laneLabel, why string) *paramRefusalError {
	return &paramRefusalError{msg: fmt.Sprintf(
		"refusing to drop '%s' for %s: drop_tuning_params is false and %s. Remove it, set drop_tuning_params to true, or use a model that supports it",
		name, laneLabel, why)}
}

// paramVerdict is what the policy decided about one request key: refuse
// the request, drop the key (optionally clearing it off the parsed
// parameters first), or let it through.
type paramVerdict struct {
	refusal *paramRefusalError
	drop    bool
	clear   func(*bfschemas.ChatParameters)
}

// applyDrop records a dropped key and clears it off the parsed parameters
// so the translator never sees it. A no-op for anything but a drop.
func (v paramVerdict) applyDrop(result *paramPolicyResult, params *bfschemas.ChatParameters, name string) {
	if !v.drop {
		return
	}
	if v.clear != nil {
		v.clear(params)
	}
	result.dropped = append(result.dropped, name)
}

// classifyParam decides one request key against the lane's rule.
func classifyParam(rc ruleCtx, name string) paramVerdict {
	if paramPolicyIgnoredKeys[name] {
		return paramVerdict{}
	}
	rule := ruleFor(name, rc.lane)
	disp, why := resolveDisposition(rule, rc)
	switch disp {
	case dispRefused:
		return paramVerdict{refusal: refusedFunctionally(name, rc.laneLabel(), why)}
	case dispDropped:
		if rc.strict {
			return paramVerdict{refusal: refusedStrictMode(name, rc.laneLabel(), why)}
		}
		return paramVerdict{drop: true, clear: rule.clear}
	default:
		return paramVerdict{}
	}
}

// policyTarget is the dispatch destination the policy is evaluated
// against: the provider picks the lane, the model refines rules that vary
// by family.
type policyTarget struct {
	provider bfschemas.ModelProvider
	model    string
}

// applyParamPolicy walks the request's top-level keys and applies the
// table: mapped keys pass, droppable keys are dropped (signaled) or
// refused in strict mode, contract keys always refuse. It also performs
// the mapping-side fixes the table promises (anthropic top_p coexistence,
// bedrock tool_choice none).
func applyParamPolicy(target policyTarget, body []byte, params *bfschemas.ChatParameters) (paramPolicyResult, error) {
	var result paramPolicyResult
	lane, ok := policyLaneFor(target.provider)
	if !ok {
		return result, nil
	}
	base := ruleCtx{
		body:   body,
		params: params,
		lane:   lane,
		model:  target.model,
		strict: !dropTuningParamsEnabled(body),
	}

	var refusal *paramRefusalError
	gjson.ParseBytes(body).ForEach(func(key, value gjson.Result) bool {
		rc := base
		rc.value = value
		name := key.String()
		verdict := classifyParam(rc, name)
		if verdict.refusal != nil {
			refusal = verdict.refusal
			return false
		}
		verdict.applyDrop(&result, params, name)
		return true
	})
	if refusal != nil {
		return paramPolicyResult{}, refusal
	}
	sort.Strings(result.dropped)

	applyPolicyMappings(body, params, lane)
	return result, nil
}

// applyPolicyMappings performs the gateway-side mappings the table
// classifies as mapped but the vendored translators get wrong.
func applyPolicyMappings(body []byte, params *bfschemas.ChatParameters, lane policyLane) {
	if params == nil {
		return
	}
	// Bedrock: Converse has no tool_choice "none"; bifrost drops the field
	// and the model may call tools it was told not to call. Removing the
	// tools is the faithful translation of "never call a tool".
	if lane == laneBedrock && params.ToolChoice != nil && toolChoiceIsNone(body) {
		params.Tools = nil
		params.ToolChoice = nil
	}
}

func toolChoiceIsNone(body []byte) bool {
	v := gjson.GetBytes(body, "tool_choice")
	return v.Type == gjson.String && v.String() == "none"
}

// renderParamPolicyTable renders the policy table as the markdown the
// docs page carries; TestParamPolicyDocsInSync diffs the two so the table
// in the code and the table customers read cannot drift apart.
func renderParamPolicyTable() string {
	names := make([]string, 0, len(paramPolicyTable))
	for name := range paramPolicyTable {
		names = append(names, name)
	}
	sort.Strings(names)

	var b strings.Builder
	b.WriteString("| Parameter | anthropic | bedrock | gemini / vertex | Notes |\n")
	b.WriteString("|---|---|---|---|---|\n")
	for _, name := range names {
		rules := paramPolicyTable[name]
		fmt.Fprintf(&b, "| `%s` | %s | %s | %s | %s |\n",
			name,
			dispositionLabel(rules[laneAnthropic]),
			dispositionLabel(rules[laneBedrock]),
			dispositionLabel(rules[laneGemini]),
			renderPolicyNote(rules))
	}
	b.WriteString("| any other key | dropped | dropped | dropped | vendor params with no mapping on translated lanes |\n")
	return b.String()
}

// dispositionLabel is the table cell for one lane's rule.
func dispositionLabel(r paramRule) string {
	switch r.disp {
	case dispMapped:
		return "mapped"
	case dispDropped:
		return "dropped"
	default:
		return "refused"
	}
}

// renderPolicyNote composes one parameter's Notes cell: a note the three
// lanes share is printed once, otherwise each non-empty note is prefixed
// with the lane it belongs to.
func renderPolicyNote(rules map[policyLane]paramRule) string {
	anthropic, bedrock, gemini := rules[laneAnthropic].note, rules[laneBedrock].note, rules[laneGemini].note
	if anthropic == bedrock && bedrock == gemini {
		return anthropic
	}
	parts := make([]string, 0, 3)
	for _, lane := range []policyLane{laneAnthropic, laneBedrock, laneGemini} {
		if n := rules[lane].note; n != "" {
			parts = append(parts, string(lane)+": "+n)
		}
	}
	return strings.Join(parts, "; ")
}

// paramRefusalError marks a policy refusal so the dispatch call sites can
// classify it as unsupported_parameter (400) instead of a generic parse
// failure. The message is the full client-facing sentence.
type paramRefusalError struct{ msg string }

func (e *paramRefusalError) Error() string { return e.msg }

// ── The codex Responses lane ─────────────────────────────────────────────
//
// The ChatGPT codex backend keeps an allowlist of its own and answers 400
// "Unsupported parameter: <name>" on anything outside it, before a token is
// generated, naming only the first offender. The gateway authors the
// outgoing body for this lane (codexRequestBody builds it from the mapped
// fields), so every field gets a disposition here just like the translated
// chat lanes: a tuning knob the backend refuses is dropped with a signal,
// and a field whose silent absence would change what the caller observably
// gets is refused by name before a provider round trip is paid.
//
// Every row is verified against the live backend; the env-gated probe in
// codex_live_conformance_test.go re-checks the table on demand. A field the
// table does not name falls to paramPolicyDefaultRule (dropped), which is
// the safe direction: the same field forwarded would have failed the whole
// request upstream anyway.
var codexParamPolicyTable = map[string]paramRule{
	// Accepted by the backend and forwarded faithfully. model, stream and
	// store are listed as mapped but pinned by codexRequestBody: bare model
	// name, stream on, store off (the backend is stateless).
	"model":               {disp: dispMapped, note: "pinned to the bare model name"},
	"input":               mapped(),
	"instructions":        mapped(),
	"stream":              {disp: dispMapped, note: "pinned on (the backend is SSE-only)"},
	"stream_options":      mapped(),
	"store":               {disp: dispMapped, note: "pinned off (the backend is stateless)"},
	"include":             mapped(),
	"tools":               mapped(),
	"tool_choice":         mapped(),
	"parallel_tool_calls": mapped(),
	"reasoning":           mapped(),
	"text":                mapped(),
	"prompt_cache_key":    mapped(),
	// Functional: the answer without the field is not the answer that was
	// asked for, so these refuse instead of dropping.
	"previous_response_id": refused("the codex lane pins store: false, so the response chain the caller asked to continue would silently not continue"),
	"background":           refused("the background response id the caller expects to poll would be silently absent"),
	"top_logprobs":         refused("the requested log probabilities would be silently absent from the response"),
	"max_tool_calls":       refused("the tool-call cap would be silently unenforced"),
	// Tuning knobs the backend refuses: dropped with a signal.
	"max_output_tokens":      dropped("the codex backend refuses an output cap"),
	"temperature":            dropped("the codex backend refuses sampling options"),
	"top_p":                  dropped("the codex backend refuses sampling options"),
	"truncation":             dropped("the codex backend manages its own context truncation"),
	"metadata":               dropped("the codex backend refuses request metadata"),
	"service_tier":           dropped("the codex backend has no service tiers"),
	"user":                   dropped("the codex backend refuses caller identifiers"),
	"safety_identifier":      dropped("the codex backend refuses caller identifiers"),
	"prompt_cache_options":   dropped("the codex backend manages its own prompt cache"),
	"prompt_cache_retention": dropped("the codex backend manages its own prompt cache"),
}

const codexPolicyLane = "codex"

// classifyCodexParam decides one Responses-body key against the codex
// table. Same defaults as the chat lanes: an unknown key is a droppable
// vendor param, and strict mode (drop_tuning_params false) turns drops
// into refusals. drop_tuning_params itself is the gateway's own directive,
// consumed by the caller before classification.
func classifyCodexParam(name, model string, strict bool) paramVerdict {
	rule, known := codexParamPolicyTable[name]
	if !known {
		rule = paramPolicyDefaultRule
	}
	label := fmt.Sprintf("%s/%s", codexPolicyLane, model)
	switch rule.disp {
	case dispRefused:
		return paramVerdict{refusal: refusedFunctionally(name, label, rule.why)}
	case dispDropped:
		if strict {
			return paramVerdict{refusal: refusedStrictMode(name, label, rule.why)}
		}
		return paramVerdict{drop: true}
	default:
		return paramVerdict{}
	}
}

// renderCodexParamPolicyTable renders the codex lane's table for the docs
// page; TestParamPolicyDocsInSync diffs it the same way as the chat table.
func renderCodexParamPolicyTable() string {
	names := make([]string, 0, len(codexParamPolicyTable))
	for name := range codexParamPolicyTable {
		names = append(names, name)
	}
	sort.Strings(names)

	var b strings.Builder
	b.WriteString("| Parameter | codex | Notes |\n")
	b.WriteString("|---|---|---|\n")
	for _, name := range names {
		rule := codexParamPolicyTable[name]
		note := rule.note
		if note == "" {
			note = rule.why
		}
		fmt.Fprintf(&b, "| `%s` | %s | %s |\n", name, dispositionLabel(rule), note)
	}
	b.WriteString("| any other key | dropped | the codex backend accepts a fixed set of fields |\n")
	return b.String()
}
