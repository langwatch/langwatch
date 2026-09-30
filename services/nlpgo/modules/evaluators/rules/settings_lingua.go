package rules

import "encoding/json"

// LinguaLanguageDetectionSettings are langevals_lingua's
// LinguaLanguageDetectionSettings.
type LinguaLanguageDetectionSettings struct {
	CheckFor         string  `json:"check_for"         desc:"What should be checked"                                                                                                                               enum:"input_matches_output,output_matches_language"`
	ExpectedLanguage *string `json:"expected_language" desc:"The specific language that the output is expected to be"                                                                                              enum:"AF,AR,AZ,BE,BG,BN,BS,CA,CS,CY,DA,DE,EL,EN,EO,ES,ET,EU,FA,FI,FR,GA,GU,HE,HI,HR,HU,HY,ID,IS,IT,JA,KA,KK,KO,LA,LG,LT,LV,MI,MK,MN,MR,MS,NB,NL,NN,PA,PL,PT,RO,RU,SK,SL,SN,SO,SQ,SR,ST,SV,SW,TA,TE,TH,TL,TN,TR,TS,UK,UR,VI,XH,YO,ZH,ZU"`
	MinWords         int     `json:"min_words"         desc:"Minimum number of words to check, as the language detection can be unreliable for very short texts. Inputs shorter than the minimum will be skipped."`
	Threshold        float64 `json:"threshold"         desc:"Minimum confidence threshold for the language detection. If the confidence is lower than this, the evaluation will be skipped."`
}

// DefaultLinguaLanguageDetectionSettings are the Python defaults.
func DefaultLinguaLanguageDetectionSettings() LinguaLanguageDetectionSettings {
	return LinguaLanguageDetectionSettings{CheckFor: "input_matches_output", MinWords: 7, Threshold: 0.25}
}

// ParseLinguaLanguageDetectionSettings parses lingua/language_detection settings.
func ParseLinguaLanguageDetectionSettings(raw json.RawMessage) (LinguaLanguageDetectionSettings, error) {
	return ParseSettings(raw, DefaultLinguaLanguageDetectionSettings())
}

// linguaLanguageDetectionDefinition is lingua/language_detection in the catalogue.
func linguaLanguageDetectionDefinition() Definition {
	return Definition{
		Slug: "lingua/language_detection",
		Name: "Lingua Language Detection",
		Description: `
This evaluator detects the language of the input and output text to check for example if the generated answer is in the same language as the prompt,
or if it's in a specific expected language.
`,
		Category:        "quality",
		DocsURL:         "https://github.com/pemistahl/lingua-py",
		IsGuardrail:     true,
		RequiredFields:  []string{FieldOutput},
		OptionalFields:  []string{FieldInput},
		Result:          ResultDescriptions{Passed: "Passes if the detected language on the output matches the detected language on the input, or if the output matches the expected language", Label: "Language detected on the input for input_matches_output, or language detected on the output for output_matches_language"},
		DefaultSettings: DefaultLinguaLanguageDetectionSettings(),
	}
}
