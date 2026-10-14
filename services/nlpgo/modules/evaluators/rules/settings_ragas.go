package rules

import "encoding/json"

// RagasSettings are langevals_ragas' RagasSettings: the LLM metrics' own
// settings, and the whole settings of those that add none.
type RagasSettings struct {
	Model     string `json:"model"      desc:"The model to use for evaluation."`
	MaxTokens int    `json:"max_tokens" desc:"The maximum number of tokens allowed for evaluation, a too high number can be costly. Entries above this amount will be skipped."`
}

// DefaultRagasSettings are the Python defaults.
func DefaultRagasSettings() RagasSettings {
	return RagasSettings{Model: "openai/gpt-5-mini", MaxTokens: 2048}
}

// ParseRagasSettings parses response_context_precision,
// response_context_recall, sql_query_equivalence and summarization_score.
func ParseRagasSettings(raw json.RawMessage) (RagasSettings, error) {
	return ParseSettings(raw, DefaultRagasSettings())
}

// RagasContextDistanceSettings are the settings context_f1,
// context_precision and context_recall each declare alike.
type RagasContextDistanceSettings struct {
	DistanceMeasure string `json:"distance_measure" enum:"levenshtein,hamming,jaro,jaro_winkler"`
}

// DefaultRagasContextDistanceSettings are the Python defaults.
func DefaultRagasContextDistanceSettings() RagasContextDistanceSettings {
	return RagasContextDistanceSettings{DistanceMeasure: "levenshtein"}
}

// ParseRagasContextDistanceSettings parses the three context metrics' settings.
func ParseRagasContextDistanceSettings(raw json.RawMessage) (RagasContextDistanceSettings, error) {
	return ParseSettings(raw, DefaultRagasContextDistanceSettings())
}

// RagasFactualCorrectnessSettings are ragas/factual_correctness's settings.
type RagasFactualCorrectnessSettings struct {
	RagasSettings
	Mode      string `json:"mode"      desc:"The mode to use for the factual correctness metric." enum:"f1,precision,recall"`
	Atomicity string `json:"atomicity" desc:"The level of atomicity for claim decomposition."     enum:"low,high"`
	Coverage  string `json:"coverage"  desc:"The level of coverage for claim decomposition."      enum:"low,high"`
}

// DefaultRagasFactualCorrectnessSettings are the Python defaults.
func DefaultRagasFactualCorrectnessSettings() RagasFactualCorrectnessSettings {
	return RagasFactualCorrectnessSettings{RagasSettings: DefaultRagasSettings(), Mode: "f1", Atomicity: "low", Coverage: "low"}
}

// ParseRagasFactualCorrectnessSettings parses ragas/factual_correctness settings.
func ParseRagasFactualCorrectnessSettings(raw json.RawMessage) (RagasFactualCorrectnessSettings, error) {
	return ParseSettings(raw, DefaultRagasFactualCorrectnessSettings())
}

// RagasFaithfulnessSettings are ragas/faithfulness's settings.
type RagasFaithfulnessSettings struct {
	RagasSettings
	AutodetectDontKnow bool `json:"autodetect_dont_know" desc:"Whether to autodetect 'I don't know' in the output to avoid failing the evaluation."`
}

// DefaultRagasFaithfulnessSettings are the Python defaults.
func DefaultRagasFaithfulnessSettings() RagasFaithfulnessSettings {
	return RagasFaithfulnessSettings{RagasSettings: DefaultRagasSettings(), AutodetectDontKnow: true}
}

// ParseRagasFaithfulnessSettings parses ragas/faithfulness settings.
func ParseRagasFaithfulnessSettings(raw json.RawMessage) (RagasFaithfulnessSettings, error) {
	return ParseSettings(raw, DefaultRagasFaithfulnessSettings())
}

// RagasResponseRelevancySettings are ragas/response_relevancy's settings.
type RagasResponseRelevancySettings struct {
	RagasSettings
	EmbeddingsModel string `json:"embeddings_model" desc:"The model to use for embeddings."`
}

// DefaultRagasResponseRelevancySettings are the Python defaults.
func DefaultRagasResponseRelevancySettings() RagasResponseRelevancySettings {
	return RagasResponseRelevancySettings{RagasSettings: DefaultRagasSettings(), EmbeddingsModel: "openai/text-embedding-ada-002"}
}

// ParseRagasResponseRelevancySettings parses ragas/response_relevancy settings.
func ParseRagasResponseRelevancySettings(raw json.RawMessage) (RagasResponseRelevancySettings, error) {
	return ParseSettings(raw, DefaultRagasResponseRelevancySettings())
}

// RagasROUGEScoreSettings are ragas/rouge_score's settings.
type RagasROUGEScoreSettings struct {
	RougeType   string `json:"rouge_type"   desc:"ROUGE type"         enum:"rouge1,rougeL"`
	MeasureType string `json:"measure_type" desc:"ROUGE measure type" enum:"fmeasure,precision,recall"`
}

// DefaultRagasROUGEScoreSettings are the Python defaults.
func DefaultRagasROUGEScoreSettings() RagasROUGEScoreSettings {
	return RagasROUGEScoreSettings{RougeType: "rouge1", MeasureType: "fmeasure"}
}

// ParseRagasROUGEScoreSettings parses ragas/rouge_score settings.
func ParseRagasROUGEScoreSettings(raw json.RawMessage) (RagasROUGEScoreSettings, error) {
	return ParseSettings(raw, DefaultRagasROUGEScoreSettings())
}

// RagasRubricsBasedScoringSettings are ragas/rubrics_based_scoring's settings.
type RagasRubricsBasedScoringSettings struct {
	RagasSettings
	Rubrics []RagasRubric `json:"rubrics"`
}

// RagasRubric is one score's description.
type RagasRubric struct {
	Description string `json:"description" required:"true"`
}

// DefaultRagasRubricsBasedScoringSettings are the Python defaults.
func DefaultRagasRubricsBasedScoringSettings() RagasRubricsBasedScoringSettings {
	return RagasRubricsBasedScoringSettings{RagasSettings: DefaultRagasSettings(), Rubrics: []RagasRubric{
		{Description: "The response is incorrect, irrelevant."},
		{Description: "The response partially answers the question but includes significant errors, omissions, or irrelevant information."},
		{Description: "The response partially answers the question but includes minor errors, omissions, or irrelevant information."},
		{Description: "The response fully answers the question and includes minor errors, omissions, or irrelevant information."},
		{Description: "The response fully answers the question and includes no errors, omissions, or irrelevant information."},
	}}
}

// ParseRagasRubricsBasedScoringSettings parses ragas/rubrics_based_scoring settings.
func ParseRagasRubricsBasedScoringSettings(raw json.RawMessage) (RagasRubricsBasedScoringSettings, error) {
	return ParseSettings(raw, DefaultRagasRubricsBasedScoringSettings())
}

// ragasBLEUScoreDefinition is ragas/bleu_score in the catalogue.
func ragasBLEUScoreDefinition() Definition {
	return Definition{
		Slug: "ragas/bleu_score",
		Name: "BLEU Score",
		Description: `
Traditional NLP metric. BLEU score for evaluating the similarity between two strings.
`,
		Category:        "quality",
		DocsURL:         "https://docs.ragas.io/en/stable/concepts/metrics/available_metrics/traditional/#bleu-score",
		IsGuardrail:     false,
		RequiredFields:  []string{FieldOutput, FieldExpectedOutput},
		Result:          ResultDescriptions{Score: "BLEU similarity score"},
		DefaultSettings: NoSettings{},
	}
}

// ragasContextF1Definition is ragas/context_f1 in the catalogue.
func ragasContextF1Definition() Definition {
	return Definition{
		Slug: "ragas/context_f1",
		Name: "Context F1",
		Description: `
Balances between precision and recall for context retrieval, increasing it means a better signal-to-noise ratio. Uses traditional string distance metrics.
`,
		Category:        "rag",
		DocsURL:         "https://docs.ragas.io/en/stable/concepts/metrics/available_metrics/context_F1/#non-llm-based-context-F1",
		IsGuardrail:     false,
		RequiredFields:  []string{FieldContexts, FieldExpectedContexts},
		Result:          ResultDescriptions{Score: "A score between 0.0 and 1.0 indicating the F1 score."},
		DefaultSettings: DefaultRagasContextDistanceSettings(),
	}
}

// ragasContextPrecisionDefinition is ragas/context_precision in the catalogue.
func ragasContextPrecisionDefinition() Definition {
	return Definition{
		Slug: "ragas/context_precision",
		Name: "Context Precision",
		Description: `
Measures how accurate is the retrieval compared to expected contexts, increasing it means less noise in the retrieval. Uses traditional string distance metrics.
`,
		Category:        "rag",
		DocsURL:         "https://docs.ragas.io/en/stable/concepts/metrics/available_metrics/context_precision/#non-llm-based-context-precision",
		IsGuardrail:     false,
		RequiredFields:  []string{FieldContexts, FieldExpectedContexts},
		Result:          ResultDescriptions{Score: "A score between 0.0 and 1.0 indicating the precision score."},
		DefaultSettings: DefaultRagasContextDistanceSettings(),
	}
}

// ragasContextRecallDefinition is ragas/context_recall in the catalogue.
func ragasContextRecallDefinition() Definition {
	return Definition{
		Slug: "ragas/context_recall",
		Name: "Context Recall",
		Description: `
Measures how many relevant contexts were retrieved compared to expected contexts, increasing it means more signal in the retrieval. Uses traditional string distance metrics.
`,
		Category:        "rag",
		DocsURL:         "https://docs.ragas.io/en/stable/concepts/metrics/available_metrics/context_recall/#non-llm-based-context-recall",
		IsGuardrail:     false,
		RequiredFields:  []string{FieldContexts, FieldExpectedContexts},
		Result:          ResultDescriptions{Score: "A score between 0.0 and 1.0 indicating the Recall score."},
		DefaultSettings: DefaultRagasContextDistanceSettings(),
	}
}

// ragasFactualCorrectnessDefinition is ragas/factual_correctness in the catalogue.
func ragasFactualCorrectnessDefinition() Definition {
	return Definition{
		Slug: "ragas/factual_correctness",
		Name: "LLM Factual Match",
		Description: `
Computes with an LLM how factually similar the generated answer is to the expected output.
`,
		Category:        "quality",
		DocsURL:         "https://docs.ragas.io/en/stable/concepts/metrics/available_metrics/factual_correctness/",
		IsGuardrail:     false,
		RequiredFields:  []string{FieldOutput, FieldExpectedOutput},
		Result:          ResultDescriptions{Score: "A score between 0.0 and 1.0 indicating how factually similar the generated answer is to the expected output."},
		DefaultSettings: DefaultRagasFactualCorrectnessSettings(),
	}
}

// ragasFaithfulnessDefinition is ragas/faithfulness in the catalogue.
func ragasFaithfulnessDefinition() Definition {
	return Definition{
		Slug: "ragas/faithfulness",
		Name: "Ragas Faithfulness",
		Description: `
This evaluator assesses the extent to which the generated answer is consistent with the provided context. Higher scores indicate better faithfulness to the context, useful for detecting hallucinations.
`,
		Category:        "rag",
		DocsURL:         "https://docs.ragas.io/en/stable/concepts/metrics/available_metrics/faithfulness/",
		IsGuardrail:     false,
		RequiredFields:  []string{FieldOutput, FieldContexts},
		OptionalFields:  []string{FieldInput},
		Result:          ResultDescriptions{Score: "A score between 0.0 and 1.0 indicating the faithfulness of the answer."},
		DefaultSettings: DefaultRagasFaithfulnessSettings(),
	}
}

// ragasResponseContextPrecisionDefinition is ragas/response_context_precision in the catalogue.
func ragasResponseContextPrecisionDefinition() Definition {
	return Definition{
		Slug: "ragas/response_context_precision",
		Name: "Ragas Response Context Precision",
		Description: `
Uses an LLM to measure the proportion of chunks in the retrieved context that were relevant to generate the output or the expected output.
`,
		Category:        "rag",
		DocsURL:         "https://docs.ragas.io/en/stable/concepts/metrics/available_metrics/context_precision/#context-precision-without-reference",
		IsGuardrail:     false,
		RequiredFields:  []string{FieldInput, FieldContexts},
		OptionalFields:  []string{FieldOutput, FieldExpectedOutput},
		Result:          ResultDescriptions{Score: "A score between 0.0 and 1.0 indicating the precision of the retrieved context."},
		DefaultSettings: DefaultRagasSettings(),
	}
}

// ragasResponseContextRecallDefinition is ragas/response_context_recall in the catalogue.
func ragasResponseContextRecallDefinition() Definition {
	return Definition{
		Slug: "ragas/response_context_recall",
		Name: "Ragas Response Context Recall",
		Description: `
Uses an LLM to measure how many of relevant documents attributable the claims in the output were successfully retrieved in order to generate an expected output.
`,
		Category:        "rag",
		DocsURL:         "https://docs.ragas.io/en/stable/concepts/metrics/available_metrics/context_recall/#llm-based-context-recall",
		IsGuardrail:     false,
		RequiredFields:  []string{FieldInput, FieldOutput, FieldContexts, FieldExpectedOutput},
		Result:          ResultDescriptions{Score: "A score between 0.0 and 1.0 indicating the recall of the retrieved context."},
		DefaultSettings: DefaultRagasSettings(),
	}
}

// ragasResponseRelevancyDefinition is ragas/response_relevancy in the catalogue.
func ragasResponseRelevancyDefinition() Definition {
	return Definition{
		Slug: "ragas/response_relevancy",
		Name: "Ragas Response Relevancy",
		Description: `
Evaluates how pertinent the generated answer is to the given prompt. Higher scores indicate better relevancy.
`,
		Category:        "quality",
		DocsURL:         "https://docs.ragas.io/en/stable/concepts/metrics/available_metrics/answer_relevance/",
		IsGuardrail:     false,
		RequiredFields:  []string{FieldInput, FieldOutput},
		Result:          ResultDescriptions{Score: "A score between 0.0 and 1.0 indicating the relevance of the answer."},
		DefaultSettings: DefaultRagasResponseRelevancySettings(),
	}
}

// ragasROUGEScoreDefinition is ragas/rouge_score in the catalogue.
func ragasROUGEScoreDefinition() Definition {
	return Definition{
		Slug: "ragas/rouge_score",
		Name: "ROUGE Score",
		Description: `
Traditional NLP metric. ROUGE score for evaluating the similarity between two strings.
`,
		Category:        "quality",
		DocsURL:         "https://docs.ragas.io/en/stable/concepts/metrics/available_metrics/traditional/#rouge-score",
		IsGuardrail:     false,
		RequiredFields:  []string{FieldOutput, FieldExpectedOutput},
		Result:          ResultDescriptions{Score: "ROUGE similarity score"},
		DefaultSettings: DefaultRagasROUGEScoreSettings(),
	}
}

// ragasRubricsBasedScoringDefinition is ragas/rubrics_based_scoring in the catalogue.
func ragasRubricsBasedScoringDefinition() Definition {
	return Definition{
		Slug: "ragas/rubrics_based_scoring",
		Name: "Rubrics Based Scoring",
		Description: `
Rubric-based evaluation metric that is used to evaluate responses. The rubric consists of descriptions for each score, typically ranging from 1 to 5
`,
		Category:        "quality",
		DocsURL:         "https://docs.ragas.io/en/stable/concepts/metrics/available_metrics/general_purpose/#rubrics-based-criteria-scoring",
		IsGuardrail:     false,
		RequiredFields:  []string{FieldInput, FieldOutput},
		OptionalFields:  []string{FieldExpectedOutput},
		Result:          ResultDescriptions{Score: "A score according to the rubrics, typically between 1 and 5."},
		DefaultSettings: DefaultRagasRubricsBasedScoringSettings(),
	}
}

// ragasSQLQueryEquivalenceDefinition is ragas/sql_query_equivalence in the catalogue.
func ragasSQLQueryEquivalenceDefinition() Definition {
	return Definition{
		Slug: "ragas/sql_query_equivalence",
		Name: "SQL Query Equivalence",
		Description: `
Checks if the SQL query is equivalent to a reference one by using an LLM to infer if it would generate the same results given the table schemas.
`,
		Category:        "quality",
		DocsURL:         "https://docs.ragas.io/en/stable/concepts/metrics/available_metrics/sql/#sql-query-semantic-equivalence",
		IsGuardrail:     false,
		RequiredFields:  []string{FieldOutput, FieldExpectedOutput, FieldExpectedContexts},
		Result:          ResultDescriptions{Passed: "Whether the SQL query is equivalent to the expected one."},
		DefaultSettings: DefaultRagasSettings(),
	}
}

// ragasSummarizationScoreDefinition is ragas/summarization_score in the catalogue.
func ragasSummarizationScoreDefinition() Definition {
	return Definition{
		Slug: "ragas/summarization_score",
		Name: "Summarization Score",
		Description: `
Measures how well the summary captures important information from the retrieved contexts.
`,
		Category:        "quality",
		DocsURL:         "https://docs.ragas.io/en/stable/concepts/metrics/available_metrics/summarization_score/",
		IsGuardrail:     false,
		RequiredFields:  []string{FieldOutput, FieldContexts},
		Result:          ResultDescriptions{Score: "A score between 0.0 and 1.0 indicating the summarization quality."},
		DefaultSettings: DefaultRagasSettings(),
	}
}
