package rules

import "encoding/json"

// AzureContentSafetySettings are langevals_azure's AzureContentSafetySettings.
type AzureContentSafetySettings struct {
	SeverityThreshold int                          `json:"severity_threshold" desc:"The minimum severity level to consider content as unsafe, from 1 to 7."                                                                                              enum:"1,2,3,4,5,6,7"`
	Categories        AzureContentSafetyCategories `json:"categories"         desc:"The categories of moderation to check for."`
	OutputType        string                       `json:"output_type"        desc:"The type of severity levels to return on the full 0-7 severity scale, it can be either the trimmed version with four values (0, 2, 4, 6 scores) or the whole range." enum:"FourSeverityLevels,EightSeverityLevels"`
}

// AzureContentSafetyCategories are the content safety categories to check.
type AzureContentSafetyCategories struct {
	Hate     bool `json:"Hate"`
	SelfHarm bool `json:"SelfHarm"`
	Sexual   bool `json:"Sexual"`
	Violence bool `json:"Violence"`
}

// DefaultAzureContentSafetySettings are the Python defaults.
func DefaultAzureContentSafetySettings() AzureContentSafetySettings {
	return AzureContentSafetySettings{
		SeverityThreshold: 1,
		Categories:        AzureContentSafetyCategories{Hate: true, SelfHarm: true, Sexual: true, Violence: true},
		OutputType:        "FourSeverityLevels",
	}
}

// ParseAzureContentSafetySettings parses azure/content_safety settings.
func ParseAzureContentSafetySettings(raw json.RawMessage) (AzureContentSafetySettings, error) {
	return ParseSettings(raw, DefaultAzureContentSafetySettings())
}

// azureContentSafetyDefinition is azure/content_safety in the catalogue.
func azureContentSafetyDefinition() Definition {
	return Definition{
		Slug: "azure/content_safety",
		Name: "Azure Content Safety",
		Description: `
This evaluator detects potentially unsafe content in text, including hate speech,
self-harm, sexual content, and violence. It allows customization of the severity
threshold and the specific categories to check.
`,
		Category:        "safety",
		DocsURL:         "https://learn.microsoft.com/en-us/azure/ai-services/content-safety/quickstart-text",
		IsGuardrail:     true,
		OptionalFields:  []string{FieldInput, FieldOutput},
		EnvVars:         []string{"AZURE_CONTENT_SAFETY_ENDPOINT", "AZURE_CONTENT_SAFETY_KEY"},
		Result:          ResultDescriptions{Score: "The severity level of the detected content from 0 to 7. A higher score indicates higher severity."},
		DefaultSettings: DefaultAzureContentSafetySettings(),
	}
}

// azureJailbreakDefinition is azure/jailbreak in the catalogue.
func azureJailbreakDefinition() Definition {
	return Definition{
		Slug: "azure/jailbreak",
		Name: "Azure Jailbreak Detection",
		Description: `
This evaluator checks for jailbreak-attempt in the input using Azure's Content Safety API.
`,
		Category:        "safety",
		DocsURL:         "",
		IsGuardrail:     true,
		RequiredFields:  []string{FieldInput},
		EnvVars:         []string{"AZURE_CONTENT_SAFETY_ENDPOINT", "AZURE_CONTENT_SAFETY_KEY"},
		Result:          ResultDescriptions{Passed: "If true then no jailbreak was detected, if false then a jailbreak was detected"},
		DefaultSettings: NoSettings{},
	}
}

// azurePromptInjectionDefinition is azure/prompt_injection in the catalogue.
func azurePromptInjectionDefinition() Definition {
	return Definition{
		Slug: "azure/prompt_injection",
		Name: "Azure Prompt Shield",
		Description: `
This evaluator checks for prompt injection attempt in the input and the contexts using Azure's Content Safety API.
`,
		Category:        "safety",
		DocsURL:         "https://learn.microsoft.com/en-us/azure/ai-services/content-safety/concepts/jailbreak-detection",
		IsGuardrail:     true,
		RequiredFields:  []string{FieldInput},
		OptionalFields:  []string{FieldContexts},
		EnvVars:         []string{"AZURE_CONTENT_SAFETY_ENDPOINT", "AZURE_CONTENT_SAFETY_KEY"},
		Result:          ResultDescriptions{Passed: "If true then no prompt injection was detected, if false then a prompt injection was detected"},
		DefaultSettings: NoSettings{},
	}
}
