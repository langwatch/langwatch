package rules

import "encoding/json"

// OpenAIModerationSettings are langevals_openai's OpenAIModerationSettings.
// The model tag quotes backticks, so it is an interpreted string tagalign cannot align.
type OpenAIModerationSettings struct {
	Model      string                     "json:\"model\"      desc:\"The model version to use, `text-moderation-latest` will be automatically upgraded over time, while `text-moderation-stable` will only be updated with advanced notice by OpenAI.\" enum:\"text-moderation-stable,text-moderation-latest\"" //nolint:tagalign // backticks in the description force an interpreted string
	Categories OpenAIModerationCategories `json:"categories" desc:"The categories of content to check for moderation."`
}

// OpenAIModerationCategories are the moderation categories to check.
type OpenAIModerationCategories struct {
	Harassment            bool `json:"harassment"`
	HarassmentThreatening bool `json:"harassment_threatening"`
	Hate                  bool `json:"hate"`
	HateThreatening       bool `json:"hate_threatening"`
	SelfHarm              bool `json:"self_harm"`
	SelfHarmInstructions  bool `json:"self_harm_instructions"`
	SelfHarmIntent        bool `json:"self_harm_intent"`
	Sexual                bool `json:"sexual"`
	SexualMinors          bool `json:"sexual_minors"`
	Violence              bool `json:"violence"`
	ViolenceGraphic       bool `json:"violence_graphic"`
}

// DefaultOpenAIModerationSettings are the Python defaults.
func DefaultOpenAIModerationSettings() OpenAIModerationSettings {
	return OpenAIModerationSettings{
		Model: "text-moderation-stable",
		Categories: OpenAIModerationCategories{
			Harassment: true, HarassmentThreatening: true, Hate: true, HateThreatening: true,
			SelfHarm: true, SelfHarmInstructions: true, SelfHarmIntent: true, Sexual: true,
			SexualMinors: true, Violence: true, ViolenceGraphic: true,
		},
	}
}

// ParseOpenAIModerationSettings parses openai/moderation settings.
func ParseOpenAIModerationSettings(raw json.RawMessage) (OpenAIModerationSettings, error) {
	return ParseSettings(raw, DefaultOpenAIModerationSettings())
}

// openAIModerationDefinition is openai/moderation in the catalogue.
func openAIModerationDefinition() Definition {
	return Definition{
		Slug: "openai/moderation",
		Name: "OpenAI Moderation",
		Description: `
This evaluator uses OpenAI's moderation API to detect potentially harmful content in text,
including harassment, hate speech, self-harm, sexual content, and violence.
`,
		Category:        "safety",
		DocsURL:         "https://platform.openai.com/docs/guides/moderation/overview",
		IsGuardrail:     true,
		OptionalFields:  []string{FieldInput, FieldOutput},
		EnvVars:         []string{"OPENAI_API_KEY"},
		Result:          ResultDescriptions{Score: "The model's confidence on primary category where the input violates the OpenAI's policy. The value is between 0 and 1, where higher values denote higher confidence.", Passed: "Fails if any moderation category is flagged"},
		DefaultSettings: DefaultOpenAIModerationSettings(),
	}
}
