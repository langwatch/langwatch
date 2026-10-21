package rules

import "encoding/json"

// LLMEvaluatorSettings are langevals_core's LLMEvaluatorSettings: the judge
// model and its token budget, embedded first by every langevals judge.
type LLMEvaluatorSettings struct {
	Model     string `json:"model"      desc:"The model to use for evaluation"`
	MaxTokens *int   `json:"max_tokens" desc:"Max tokens allowed for evaluation; unset reads as 128000"`
}

// JudgeDefaultMaxTokens is langevals_core's DEFAULT_MAX_TOKENS: what an unset
// max tokens reads as for the input budget.
const JudgeDefaultMaxTokens = 128_000

// JudgeMaxTokens is `settings.max_tokens or DEFAULT_MAX_TOKENS`: an unset (or
// zero) max tokens reads as 128000. Unset sends no max tokens to the provider;
// only the tenant's X_LITELLM_max_tokens ever does.
func (s LLMEvaluatorSettings) JudgeMaxTokens() int {
	if s.MaxTokens == nil || *s.MaxTokens == 0 {
		return JudgeDefaultMaxTokens
	}
	return *s.MaxTokens
}

// DefaultLLMEvaluatorSettings are the Python defaults: max tokens unset.
func DefaultLLMEvaluatorSettings() LLMEvaluatorSettings {
	return LLMEvaluatorSettings{Model: "openai/gpt-5-mini"}
}

// ParseLLMEvaluatorSettings parses langevals/query_resolution settings.
func ParseLLMEvaluatorSettings(raw json.RawMessage) (LLMEvaluatorSettings, error) {
	return ParseSettings(raw, DefaultLLMEvaluatorSettings())
}

// CustomBasicSettings are langevals/basic's settings.
type CustomBasicSettings struct {
	Rules []CustomBasicRule `json:"rules" desc:"List of rules to check, the message must pass all of them"`
}

// CustomBasicRule is one text or regex check.
type CustomBasicRule struct {
	Field string `json:"field" enum:"input,output"`
	Rule  string `json:"rule"  enum:"contains,not_contains,matches_regex,not_matches_regex" required:"true"`
	Value string `json:"value" required:"true"`
}

// Defaults are a rule's own defaults (rules.Defaulter).
func (CustomBasicRule) Defaults() any { return CustomBasicRule{Field: "output"} }

// DefaultCustomBasicSettings are the Python defaults.
func DefaultCustomBasicSettings() CustomBasicSettings {
	return CustomBasicSettings{Rules: []CustomBasicRule{{Field: "output", Rule: "not_contains", Value: "artificial intelligence"}}}
}

// ParseCustomBasicSettings parses langevals/basic settings.
func ParseCustomBasicSettings(raw json.RawMessage) (CustomBasicSettings, error) {
	return ParseSettings(raw, DefaultCustomBasicSettings())
}

// CompetitorBlocklistSettings are langevals/competitor_blocklist's settings.
type CompetitorBlocklistSettings struct {
	Competitors []string `json:"competitors" desc:"The competitors that must not be mentioned."`
}

// DefaultCompetitorBlocklistSettings are the Python defaults.
func DefaultCompetitorBlocklistSettings() CompetitorBlocklistSettings {
	return CompetitorBlocklistSettings{Competitors: []string{"OpenAI", "Google", "Microsoft"}}
}

// ParseCompetitorBlocklistSettings parses langevals/competitor_blocklist settings.
func ParseCompetitorBlocklistSettings(raw json.RawMessage) (CompetitorBlocklistSettings, error) {
	return ParseSettings(raw, DefaultCompetitorBlocklistSettings())
}

// CompetitorLLMSettings are langevals/competitor_llm's settings.
type CompetitorLLMSettings struct {
	LLMEvaluatorSettings
	Name        string `json:"name"        desc:"The name of your company"`
	Description string `json:"description" desc:"Description of what your company is specializing at"`
}

// DefaultCompetitorLLMSettings are the Python defaults.
func DefaultCompetitorLLMSettings() CompetitorLLMSettings {
	return CompetitorLLMSettings{
		LLMEvaluatorSettings: DefaultLLMEvaluatorSettings(),
		Name:                 "LangWatch",
		Description:          "We are providing an LLM observability and evaluation platform",
	}
}

// ParseCompetitorLLMSettings parses langevals/competitor_llm settings.
func ParseCompetitorLLMSettings(raw json.RawMessage) (CompetitorLLMSettings, error) {
	return ParseSettings(raw, DefaultCompetitorLLMSettings())
}

// CompetitorLLMFunctionCallSettings are langevals/competitor_llm_function_call's settings.
type CompetitorLLMFunctionCallSettings struct {
	CompetitorLLMSettings
	Competitors []string `json:"competitors" desc:"The competitors that must not be mentioned."`
}

// DefaultCompetitorLLMFunctionCallSettings are the Python defaults.
func DefaultCompetitorLLMFunctionCallSettings() CompetitorLLMFunctionCallSettings {
	return CompetitorLLMFunctionCallSettings{
		CompetitorLLMSettings: DefaultCompetitorLLMSettings(),
		Competitors:           []string{"OpenAI", "Google", "Microsoft"},
	}
}

// ParseCompetitorLLMFunctionCallSettings parses langevals/competitor_llm_function_call settings.
func ParseCompetitorLLMFunctionCallSettings(raw json.RawMessage) (CompetitorLLMFunctionCallSettings, error) {
	return ParseSettings(raw, DefaultCompetitorLLMFunctionCallSettings())
}

// ExactMatchSettings are langevals' ExactMatchSettings.
type ExactMatchSettings struct {
	CaseSensitive     bool `json:"case_sensitive"     desc:"True if the comparison should be case-sensitive, False otherwise"`
	TrimWhitespace    bool `json:"trim_whitespace"    desc:"True if the comparison should trim whitespace, False otherwise"`
	RemovePunctuation bool `json:"remove_punctuation" desc:"True if the comparison should remove punctuation, False otherwise"`
}

// DefaultExactMatchSettings are the Python defaults.
func DefaultExactMatchSettings() ExactMatchSettings {
	return ExactMatchSettings{CaseSensitive: false, TrimWhitespace: true, RemovePunctuation: true}
}

// ParseExactMatchSettings parses langevals/exact_match settings.
func ParseExactMatchSettings(raw json.RawMessage) (ExactMatchSettings, error) {
	return ParseSettings(raw, DefaultExactMatchSettings())
}

// LLMPromptSettings are a judge with one prompt: llm_boolean's, and the base
// of llm_score's and llm_category's.
type LLMPromptSettings struct {
	LLMEvaluatorSettings
	Prompt string `json:"prompt" desc:"The system prompt to use for the LLM to run the evaluation"`
}

// LLMAnswerMatchSettings are langevals/llm_answer_match's settings; its prompt
// is described differently.
type LLMAnswerMatchSettings struct {
	LLMEvaluatorSettings
	Prompt string `json:"prompt" desc:"Prompt for the comparison"`
}

// DefaultLLMAnswerMatchSettings are the Python defaults.
func DefaultLLMAnswerMatchSettings() LLMAnswerMatchSettings {
	return LLMAnswerMatchSettings{
		LLMEvaluatorSettings: DefaultLLMEvaluatorSettings(),
		Prompt:               "Verify that the predicted answer matches the gold answer for the question. Style does not matter, for example the gold answer may be more direct while the predicted answer more verbose and still be correct.",
	}
}

// ParseLLMAnswerMatchSettings parses langevals/llm_answer_match settings.
func ParseLLMAnswerMatchSettings(raw json.RawMessage) (LLMAnswerMatchSettings, error) {
	return ParseSettings(raw, DefaultLLMAnswerMatchSettings())
}

// DefaultCustomLLMBooleanSettings are langevals/llm_boolean's Python defaults.
func DefaultCustomLLMBooleanSettings() LLMPromptSettings {
	return LLMPromptSettings{
		LLMEvaluatorSettings: DefaultLLMEvaluatorSettings(),
		Prompt:               "You are an LLM evaluator. We need the guarantee that the output answers what is being asked on the input, please evaluate as False if it doesn't",
	}
}

// ParseCustomLLMBooleanSettings parses langevals/llm_boolean settings.
func ParseCustomLLMBooleanSettings(raw json.RawMessage) (LLMPromptSettings, error) {
	return ParseSettings(raw, DefaultCustomLLMBooleanSettings())
}

// CustomLLMScoreSettings are langevals/llm_score's settings. Min and max are
// the range the prompt asks for; langevals reads neither when it judges, so
// the score is the model's own, never clamped. The platform reads them.
type CustomLLMScoreSettings struct {
	LLMPromptSettings
	Min *float64 `json:"min" desc:"The lowest score the prompt asks for; unset reads as 0"`
	Max *float64 `json:"max" desc:"The highest score the prompt asks for; unset reads as 1"`
}

// DefaultCustomLLMScoreSettings are langevals/llm_score's Python defaults.
func DefaultCustomLLMScoreSettings() CustomLLMScoreSettings {
	return CustomLLMScoreSettings{LLMPromptSettings: LLMPromptSettings{
		LLMEvaluatorSettings: DefaultLLMEvaluatorSettings(),
		Prompt:               "You are an LLM evaluator. Please score from 0.0 to 1.0 how likely the user is to be satisfied with this answer, from 0.0 being not satisfied at all to 1.0 being completely satisfied",
	}}
}

// ParseCustomLLMScoreSettings parses langevals/llm_score settings.
func ParseCustomLLMScoreSettings(raw json.RawMessage) (CustomLLMScoreSettings, error) {
	return ParseSettings(raw, DefaultCustomLLMScoreSettings())
}

// CustomLLMCategorySettings are langevals/llm_category's settings.
type CustomLLMCategorySettings struct {
	LLMPromptSettings
	Categories []CustomLLMCategoryDefinition `json:"categories" desc:"The categories to use for the evaluation"`
}

// CustomLLMCategoryDefinition is one category the judge may answer.
type CustomLLMCategoryDefinition struct {
	Name        string `json:"name"        required:"true"`
	Description string `json:"description" required:"true"`
}

// DefaultCustomLLMCategorySettings are the Python defaults.
func DefaultCustomLLMCategorySettings() CustomLLMCategorySettings {
	return CustomLLMCategorySettings{
		LLMPromptSettings: LLMPromptSettings{
			LLMEvaluatorSettings: DefaultLLMEvaluatorSettings(),
			Prompt:               "You are an LLM category evaluator. Please categorize the message in one of the following categories",
		},
		Categories: []CustomLLMCategoryDefinition{
			{Name: "smalltalk", Description: "Smalltalk with the user"},
			{Name: "company", Description: "Questions about the company, what we do, etc"},
		},
	}
}

// ParseCustomLLMCategorySettings parses langevals/llm_category settings.
func ParseCustomLLMCategorySettings(raw json.RawMessage) (CustomLLMCategorySettings, error) {
	return ParseSettings(raw, DefaultCustomLLMCategorySettings())
}

// OffTopicSettings are langevals/off_topic's settings.
type OffTopicSettings struct {
	LLMEvaluatorSettings
	AllowedTopics []AllowedTopic `json:"allowed_topics" desc:"The list of topics and their short descriptions that the chatbot is allowed to talk about"`
}

// AllowedTopic is one topic the chatbot may talk about.
type AllowedTopic struct {
	Topic       string `json:"topic"       required:"true"`
	Description string `json:"description" required:"true"`
}

// DefaultOffTopicSettings are the Python defaults.
func DefaultOffTopicSettings() OffTopicSettings {
	return OffTopicSettings{
		LLMEvaluatorSettings: DefaultLLMEvaluatorSettings(),
		AllowedTopics: []AllowedTopic{
			{Topic: "simple_chat", Description: "Smalltalk with the user"},
			{Topic: "company", Description: "Questions about the company, what we do, etc"},
		},
	}
}

// ParseOffTopicSettings parses langevals/off_topic settings.
func ParseOffTopicSettings(raw json.RawMessage) (OffTopicSettings, error) {
	return ParseSettings(raw, DefaultOffTopicSettings())
}

// DefaultPairwisePrompt is DEFAULT_PAIRWISE_PROMPT, verbatim.
const DefaultPairwisePrompt = `Compare two candidate outputs against a known-good reference (golden answer).

Task:           {input}
Golden answer:  {golden}

Candidate A:    {candidate_a_output}
Candidate B:    {candidate_b_output}

Reason step-by-step about how closely each candidate matches the
golden answer in correctness, completeness, and style. Then pick
the better candidate, or "tie" if equivalent.
Prefer cheaper/faster only when quality is comparable.
`

// PairwiseCompareSettings are langevals/pairwise_compare's settings.
type PairwiseCompareSettings struct {
	LLMEvaluatorSettings
	Prompt          string   `json:"prompt"            desc:"Judge prompt template (golden-aware by default)"`
	HasGoldenAnswer bool     `json:"has_golden_answer" desc:"Compare each candidate against a reference answer. Turn off to have the judge compare Candidate A and Candidate B directly on their own merits, with no reference answer involved."`
	SwapAndConfirm  bool     `json:"swap_and_confirm"  desc:"Run two judge calls with A/B positions swapped; tie on disagreement. Doubles judge cost but materially reduces position bias (PandaLM: 68% -> 51%)."`
	AllowTie        bool     `json:"allow_tie"         desc:"Allow the judge to return 'tie' when candidates are equivalent"`
	IncludeMetrics  []string `json:"include_metrics"   desc:"Per-candidate metrics to inject into the judge prompt"                                                                                                                              enum:"cost,duration"`
}

// DefaultPairwiseCompareSettings are the Python defaults.
func DefaultPairwiseCompareSettings() PairwiseCompareSettings {
	return PairwiseCompareSettings{
		LLMEvaluatorSettings: DefaultLLMEvaluatorSettings(),
		Prompt:               DefaultPairwisePrompt,
		HasGoldenAnswer:      true,
		SwapAndConfirm:       true,
		AllowTie:             true,
		IncludeMetrics:       []string{},
	}
}

// ParsePairwiseCompareSettings parses langevals/pairwise_compare settings.
func ParsePairwiseCompareSettings(raw json.RawMessage) (PairwiseCompareSettings, error) {
	return ParseSettings(raw, DefaultPairwiseCompareSettings())
}

// DefaultSelectBestPrompt is DEFAULT_SELECT_BEST_PROMPT, verbatim.
const DefaultSelectBestPrompt = `Pick the best of N candidate replies to the task.

Task:       {input}
Reference:  {golden}

Candidates:
{candidates}

Look across the candidates and decide which one is the best reply.
Briefly explain WHY it's better than the others, then pick the winning
slot label. Use "tie" only when no candidate is clearly better.
`

// SelectBestCompareSettings are langevals/select_best_compare's settings.
type SelectBestCompareSettings struct {
	LLMEvaluatorSettings
	Prompt           string   `json:"prompt"             desc:"Judge prompt template. Placeholders: {input}, {golden}, {candidates} (a pre-rendered bulleted list with slot labels and optional per-candidate metrics)."`
	HasGoldenAnswer  bool     `json:"has_golden_answer"  desc:"Compare each candidate against a reference answer. Turn off to have the judge compare the candidates directly on their own merits, with no reference answer involved."`
	RandomizeOrder   bool     `json:"randomize_order"    desc:"Shuffle candidate order per row (deterministically, seeded by row_index) before presenting them to the judge. Reduces position bias when the judge is called once per row."`
	AllowTie         bool     `json:"allow_tie"          desc:"Allow the judge to return 'tie' when candidates are equivalent"`
	IncludeMetrics   []string `json:"include_metrics"    desc:"Per-candidate metrics to inject into the judge prompt"                                                                                                                                                                                                                                                                               enum:"cost,duration"`
	Temperature      float64  `json:"temperature"        desc:"Sampling temperature for the judge call. Lower is more deterministic."`
	SwapAndReconcile bool     `json:"swap_and_reconcile" desc:"Check each row twice, the second time with the candidate order reversed, and record no result for that row when the two disagree — rather than a tie, which would claim the candidates are equally good. Doubles judge-call cost per row (literature: swapping candidate order alone flips 10-30% of verdicts on contested rows)."`
}

// DefaultSelectBestCompareSettings are the Python defaults.
func DefaultSelectBestCompareSettings() SelectBestCompareSettings {
	return SelectBestCompareSettings{
		LLMEvaluatorSettings: DefaultLLMEvaluatorSettings(),
		Prompt:               DefaultSelectBestPrompt,
		RandomizeOrder:       true,
		AllowTie:             true,
		IncludeMetrics:       []string{},
		SwapAndReconcile:     true,
	}
}

// ParseSelectBestCompareSettings parses langevals/select_best_compare settings.
func ParseSelectBestCompareSettings(raw json.RawMessage) (SelectBestCompareSettings, error) {
	return ParseSettings(raw, DefaultSelectBestCompareSettings())
}

// SentimentSettings are langevals/sentiment's settings.
type SentimentSettings struct {
	EmbeddingsModel     string  `json:"embeddings_model"     desc:"The embeddings model to use for sentiment analysis"`
	PositiveReference   string  `json:"positive_reference"   desc:"Reference phrase representing the positive end of the sentiment scale"`
	NegativeReference   string  `json:"negative_reference"   desc:"Reference phrase representing the negative end of the sentiment scale"`
	NormalizationFactor float64 `json:"normalization_factor" desc:"Controls sentiment sensitivity. Decrease to make scores more extreme (fewer neutrals), increase to make scores more moderate (more neutrals)"`
}

// DefaultSentimentSettings are the Python defaults.
func DefaultSentimentSettings() SentimentSettings {
	return SentimentSettings{
		EmbeddingsModel:     "openai/text-embedding-3-small",
		PositiveReference:   "Comment of a very happy and satisfied user",
		NegativeReference:   "Comment of a user who is extremely dissatisfied",
		NormalizationFactor: 0.1,
	}
}

// ParseSentimentSettings parses langevals/sentiment settings.
func ParseSentimentSettings(raw json.RawMessage) (SentimentSettings, error) {
	return ParseSettings(raw, DefaultSentimentSettings())
}

// CustomSimilaritySettings are langevals/similarity's settings.
type CustomSimilaritySettings struct {
	Field           string  `json:"field"            enum:"input,output"`
	Rule            string  `json:"rule"             enum:"is_not_similar_to,is_similar_to"`
	Value           string  `json:"value"`
	Threshold       float64 `json:"threshold"`
	EmbeddingsModel string  `json:"embeddings_model"`
}

// DefaultCustomSimilaritySettings are the Python defaults.
func DefaultCustomSimilaritySettings() CustomSimilaritySettings {
	return CustomSimilaritySettings{
		Field:           "output",
		Rule:            "is_not_similar_to",
		Value:           "example",
		Threshold:       0.3,
		EmbeddingsModel: "openai/text-embedding-3-small",
	}
}

// ParseCustomSimilaritySettings parses langevals/similarity settings.
func ParseCustomSimilaritySettings(raw json.RawMessage) (CustomSimilaritySettings, error) {
	return ParseSettings(raw, DefaultCustomSimilaritySettings())
}

// ValidFormatSettings are langevals/valid_format's settings.
type ValidFormatSettings struct {
	Format     string  `json:"format"      enum:"json,markdown,python,sql"`
	JSONSchema *string `json:"json_schema" desc:"JSON schema to validate against when format is 'json'"`
}

// DefaultValidFormatSettings are the Python defaults.
func DefaultValidFormatSettings() ValidFormatSettings {
	return ValidFormatSettings{Format: "json"}
}

// ParseValidFormatSettings parses langevals/valid_format settings.
func ParseValidFormatSettings(raw json.RawMessage) (ValidFormatSettings, error) {
	return ParseSettings(raw, DefaultValidFormatSettings())
}

// basicDefinition is langevals/basic in the catalogue.
func basicDefinition() Definition {
	return Definition{
		Slug: "langevals/basic",
		Name: "Custom Basic Evaluator",
		Description: `
Allows you to check for simple text matches or regex evaluation.
`,
		Category:        "custom",
		DocsURL:         "",
		IsGuardrail:     true,
		OptionalFields:  []string{FieldInput, FieldOutput},
		Result:          ResultDescriptions{Passed: "True if all rules pass, False if any rule fails"},
		DefaultSettings: DefaultCustomBasicSettings(),
	}
}

// competitorBlocklistDefinition is langevals/competitor_blocklist in the catalogue.
func competitorBlocklistDefinition() Definition {
	return Definition{
		Slug: "langevals/competitor_blocklist",
		Name: "Competitor Blocklist",
		Description: `
This evaluator checks if any of the specified competitors was mentioned
`,
		Category:        "policy",
		DocsURL:         "https://path/to/official/docs",
		IsGuardrail:     true,
		OptionalFields:  []string{FieldOutput, FieldInput},
		Result:          ResultDescriptions{Score: "Number of competitors mentioned in the input and output", Passed: "Is the message containing explicit mention of competitor"},
		DefaultSettings: DefaultCompetitorBlocklistSettings(),
	}
}

// competitorLLMDefinition is langevals/competitor_llm in the catalogue.
func competitorLLMDefinition() Definition {
	return Definition{
		Slug: "langevals/competitor_llm",
		Name: "Competitor Allowlist Check",
		Description: `
This evaluator use an LLM-as-judge to check if the conversation is related to competitors, without having to name them explicitly
`,
		Category:        "policy",
		DocsURL:         "",
		IsGuardrail:     true,
		OptionalFields:  []string{FieldOutput, FieldInput},
		Result:          ResultDescriptions{Score: "Confidence that the message is competitor free", Passed: "Is the message related to the competitors"},
		DefaultSettings: DefaultCompetitorLLMSettings(),
	}
}

// competitorLLMFunctionCallDefinition is langevals/competitor_llm_function_call in the catalogue.
func competitorLLMFunctionCallDefinition() Definition {
	return Definition{
		Slug: "langevals/competitor_llm_function_call",
		Name: "Competitor LLM Check",
		Description: `
This evaluator implements LLM-as-a-judge with a function call approach to check if the message contains a mention of a competitor.
`,
		Category:        "policy",
		DocsURL:         "",
		IsGuardrail:     true,
		OptionalFields:  []string{FieldOutput, FieldInput},
		Result:          ResultDescriptions{Score: "Number of unique competitors mentioned", Passed: "Is the message related to the competitors"},
		DefaultSettings: DefaultCompetitorLLMFunctionCallSettings(),
	}
}

// exactMatchDefinition is langevals/exact_match in the catalogue.
func exactMatchDefinition() Definition {
	return Definition{
		Slug: "langevals/exact_match",
		Name: "Exact Match Evaluator",
		Description: `
A simple evaluator that checks if the output matches the expected_output exactly.
`,
		Category:        "quality",
		DocsURL:         "",
		IsGuardrail:     false,
		RequiredFields:  []string{FieldOutput, FieldExpectedOutput},
		Result:          ResultDescriptions{Passed: "True if the output matched the expected_output exactly, False otherwise"},
		DefaultSettings: DefaultExactMatchSettings(),
	}
}

// llmAnswerMatchDefinition is langevals/llm_answer_match in the catalogue.
func llmAnswerMatchDefinition() Definition {
	return Definition{
		Slug: "langevals/llm_answer_match",
		Name: "LLM Answer Match",
		Description: `
Uses an LLM to check if the generated output answers a question correctly the same way as the expected output, even if their style is different.
`,
		Category:        "quality",
		DocsURL:         "",
		IsGuardrail:     false,
		RequiredFields:  []string{FieldOutput, FieldExpectedOutput},
		OptionalFields:  []string{FieldInput},
		Result:          ResultDescriptions{Passed: "Whether the predicted answer matches the gold answer"},
		DefaultSettings: DefaultLLMAnswerMatchSettings(),
	}
}

// llmBooleanDefinition is langevals/llm_boolean in the catalogue.
func llmBooleanDefinition() Definition {
	return Definition{
		Slug: "langevals/llm_boolean",
		Name: "LLM-as-a-Judge Boolean Evaluator",
		Description: `
Use an LLM as a judge with a custom prompt to do a true/false boolean evaluation of the message.
`,
		Category:        "custom",
		DocsURL:         "",
		IsGuardrail:     true,
		OptionalFields:  []string{FieldInput, FieldOutput, FieldContexts},
		Result:          ResultDescriptions{Passed: "The veredict given by the LLM"},
		DefaultSettings: DefaultCustomLLMBooleanSettings(),
	}
}

// llmCategoryDefinition is langevals/llm_category in the catalogue.
func llmCategoryDefinition() Definition {
	return Definition{
		Slug: "langevals/llm_category",
		Name: "LLM-as-a-Judge Category Evaluator",
		Description: `
Use an LLM as a judge with a custom prompt to classify the message into custom defined categories.
`,
		Category:        "custom",
		DocsURL:         "",
		IsGuardrail:     false,
		OptionalFields:  []string{FieldInput, FieldOutput, FieldContexts},
		Result:          ResultDescriptions{Label: "The detected category of the message"},
		DefaultSettings: DefaultCustomLLMCategorySettings(),
	}
}

// llmScoreDefinition is langevals/llm_score in the catalogue.
func llmScoreDefinition() Definition {
	return Definition{
		Slug: "langevals/llm_score",
		Name: "LLM-as-a-Judge Score Evaluator",
		Description: `
Use an LLM as a judge with custom prompt to do a numeric score evaluation of the message.
`,
		Category:        "custom",
		DocsURL:         "",
		IsGuardrail:     false,
		OptionalFields:  []string{FieldInput, FieldOutput, FieldContexts},
		Result:          ResultDescriptions{Score: "The score given by the LLM, according to the prompt"},
		DefaultSettings: DefaultCustomLLMScoreSettings(),
	}
}

// offTopicDefinition is langevals/off_topic in the catalogue.
func offTopicDefinition() Definition {
	return Definition{
		Slug: "langevals/off_topic",
		Name: "Off Topic Evaluator",
		Description: `
This evaluator checks if the user message is concerning one of the allowed topics of the chatbot
`,
		Category:        "policy",
		DocsURL:         "",
		IsGuardrail:     true,
		RequiredFields:  []string{FieldInput},
		Result:          ResultDescriptions{Score: "Confidence level of the intent prediction", Passed: "Is the message concerning allowed topic", Label: "The detected intent or 'other' if the intent is not in the allowed topics"},
		DefaultSettings: DefaultOffTopicSettings(),
	}
}

// pairwiseCompareDefinition is langevals/pairwise_compare in the catalogue.
func pairwiseCompareDefinition() Definition {
	return Definition{
		Slug: "langevals/pairwise_compare",
		Name: "Pairwise Compare (deprecated)",
		Description: `
Compare two candidate outputs against a reference answer and pick the
better one. Superseded by Comparison, which judges two or more candidates.
`,
		Category:        "quality",
		DocsURL:         "",
		IsGuardrail:     false,
		RequiredFields:  []string{"candidate_a_id", "candidate_a_output", "candidate_b_id", "candidate_b_output"},
		OptionalFields:  []string{FieldInput, "golden", "candidate_a_cost", "candidate_a_duration", "candidate_b_cost", "candidate_b_duration"},
		Result:          ResultDescriptions{Score: "0=A wins, 1=B wins, 0.5=tie", Label: "Winner identifier: candidate_a_id, candidate_b_id, or 'tie'. Programmatic consumers can read this directly without dereferencing the evaluator's candidate slot mapping."},
		DefaultSettings: DefaultPairwiseCompareSettings(),
	}
}

// queryResolutionDefinition is langevals/query_resolution in the catalogue.
func queryResolutionDefinition() Definition {
	return Definition{
		Slug: "langevals/query_resolution",
		Name: "Query Resolution",
		Description: `
This evaluator checks if all the user queries in the conversation were resolved. Useful to detect when the bot doesn't know how to answer or can't help the user.
`,
		Category:        "quality",
		DocsURL:         "",
		IsGuardrail:     false,
		RequiredFields:  []string{FieldConversation},
		DefaultSettings: DefaultLLMEvaluatorSettings(),
	}
}

// selectBestCompareDefinition is langevals/select_best_compare in the catalogue.
func selectBestCompareDefinition() Definition {
	return Definition{
		Slug: "langevals/select_best_compare",
		Name: "Comparison",
		Description: `
Compare two or more candidate outputs and pick the best one, optionally
against a reference answer. The judge sees every candidate at once and
explains why the winner is better. Candidate order is shuffled so that a
candidate's position never sways the verdict, and by default each row is
checked twice — once more with the order reversed — recording no result
for that row when the two checks disagree, rather than guessing.
`,
		Category:        "quality",
		DocsURL:         "",
		IsGuardrail:     false,
		OptionalFields:  []string{FieldInput, "golden", "candidates", "row_index"},
		Result:          ResultDescriptions{Score: "1.0 when a winner was picked, 0.5 for tie", Label: "The winning candidate id (matches the id supplied in entry.candidates), or 'tie'."},
		DefaultSettings: DefaultSelectBestCompareSettings(),
	}
}

// sentimentDefinition is langevals/sentiment in the catalogue.
func sentimentDefinition() Definition {
	return Definition{
		Slug: "langevals/sentiment",
		Name: "Sentiment Evaluator",
		Description: `
Analyzes the sentiment of the input text by comparing its embedding similarity
to positive and negative reference phrases. Returns a score from -1.0 (very negative)
to 1.0 (very positive) and a corresponding label.
`,
		Category:        "quality",
		DocsURL:         "",
		IsGuardrail:     false,
		RequiredFields:  []string{FieldInput},
		Result:          ResultDescriptions{Score: "Sentiment score from -1.0 (very negative) to 1.0 (very positive)", Label: "Sentiment label: 'positive' or 'negative'"},
		DefaultSettings: DefaultSentimentSettings(),
	}
}

// similarityDefinition is langevals/similarity in the catalogue.
func similarityDefinition() Definition {
	return Definition{
		Slug: "langevals/similarity",
		Name: "Semantic Similarity Evaluator",
		Description: `
Allows you to check for semantic similarity or dissimilarity between input and output and a
target value, so you can avoid sentences that you don't want to be present without having to
match on the exact text.
`,
		Category:        "custom",
		DocsURL:         "",
		IsGuardrail:     true,
		OptionalFields:  []string{FieldInput, FieldOutput},
		Result:          ResultDescriptions{Score: "How similar the input and output semantically, from 0.0 to 1.0, with 1.0 meaning the sentences are identical", Passed: "Passes if the cosine similarity crosses the threshold for the defined rule"},
		DefaultSettings: DefaultCustomSimilaritySettings(),
	}
}

// validFormatDefinition is langevals/valid_format in the catalogue.
func validFormatDefinition() Definition {
	return Definition{
		Slug: "langevals/valid_format",
		Name: "Valid Format Evaluator",
		Description: `
Allows you to check if the output is a valid json, markdown, python, sql, etc.
For JSON, can optionally validate against a provided schema.
`,
		Category:        "quality",
		DocsURL:         "",
		IsGuardrail:     true,
		OptionalFields:  []string{FieldOutput},
		Result:          ResultDescriptions{Passed: "True if the output is formatted correctly, False otherwise"},
		DefaultSettings: DefaultValidFormatSettings(),
	}
}
