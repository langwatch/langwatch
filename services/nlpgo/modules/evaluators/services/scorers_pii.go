package services

import (
	"bytes"
	"context"
	"encoding/json"
	"slices"
	"unicode/utf8"

	"github.com/langwatch/langwatch/services/nlpgo/modules/evaluators/channels"
	"github.com/langwatch/langwatch/services/nlpgo/modules/evaluators/contract"
	"github.com/langwatch/langwatch/services/nlpgo/modules/evaluators/rules"
)

// The PII entry error types, and the recognizer name model findings carry.
const (
	errorTypePIIModelNotConfigured = "PIIModelNotConfigured"
	errorTypePIIModelFailed        = "PIIModelFailed"
	piiModelRecognizer             = "PIIAnalyzer"
)

// piiNamesAndPlaces are what only a model can find.
func piiNamesAndPlaces() []contract.EntityType { return []contract.EntityType{"PERSON", "LOCATION"} }

// piiPrepares is presidio/pii_detection: Presidio's patterns, compiled once,
// plus the operator's PII model for what patterns cannot find (plan §9).
func piiPrepares() map[string]func(json.RawMessage) (Score, error) {
	patterns := rules.NewPIIPatterns()
	return map[string]func(json.RawMessage) (Score, error){
		"presidio/pii_detection": WithSettings(rules.ParsePresidioPIIDetectionSettings, piiScorer{patterns: patterns}.score),
	}
}

// piiRawResponse is pii_detection.py's raw_response.
type piiRawResponse struct {
	Results    []rules.PIIResultJSON `json:"results"`
	Anonymized string                `json:"anonymized"`
}

// piiScorer scores presidio/pii_detection entries with shared patterns.
type piiScorer struct {
	patterns *rules.PIIPatterns
}

func (s piiScorer) score(ctx context.Context, settings rules.PresidioPIIDetectionSettings, in EntryRun) (contract.Result, error) {
	content := rules.NewPIIContent(in.Entry)
	requested := rules.RequestedPIIEntities(settings.Entities)
	if refusal := s.refusal(content, requested); refusal != nil {
		return *refusal, nil
	}
	model, failure := in.Models.findWithModel(ctx, content.Text, piiModelEntities(requested, s.patterns.Covers(), in.Models.service.pii))
	if failure != nil {
		return *failure, nil
	}
	matches := rules.AboveThreshold(rules.MergePIIMatches(s.patterns.Analyze(content.Text, requested), model), settings.MinThreshold)
	return piiVerdict(content, matches)
}

// refusal is the entry's answer when there is nothing Presidio would analyze:
// empty text, text over the limit, or no recognizer for any requested entity.
func (s piiScorer) refusal(content rules.PIIContent, requested []contract.EntityType) *contract.Result {
	var result contract.Result
	switch {
	case content.Text == "":
		result = skippedResult("Input and output are both empty")
	case content.TooLong():
		result = errorResult("ValueError", "Content exceeds the maximum length of 524288 bytes allowed by PII Detection")
	case !slices.ContainsFunc(requested, s.served):
		result = errorResult("ValueError", "No matching recognizers were found to serve the request.")
	default:
		return nil
	}
	return &result
}

// served says a pattern or, in Presidio, spaCy has a recognizer for entity.
func (s piiScorer) served(entity contract.EntityType) bool {
	return slices.Contains(s.patterns.Covers(), entity) || slices.Contains(piiNamesAndPlaces(), entity)
}

// piiVerdict is pii_detection.py's result over the kept findings.
func piiVerdict(content rules.PIIContent, matches []rules.PIIMatch) (contract.Result, error) {
	raw, err := piiRawJSON(piiRawResponse{
		Results:    rules.PIIResultsJSON(matches),
		Anonymized: content.Escaped(rules.Anonymize(content.Text, rules.Findings(matches))),
	})
	if err != nil {
		return contract.Result{}, err
	}
	score, passed := float64(len(matches)), len(matches) == 0
	return contract.Result{Status: contract.StatusProcessed, Score: &score, Passed: &passed, Details: rules.PIIDetails(matches), RawResponse: raw}, nil
}

// piiModelEntities is (requested − pattern-covered) ∩ the analyzer's
// Covers(); PERSON and LOCATION stay listed when no analyzer is configured,
// so their request is refused rather than silently passed.
func piiModelEntities(requested, patternCovered []contract.EntityType, analyzer channels.PIIAnalyzer) []contract.EntityType {
	var covers []contract.EntityType
	if analyzer != nil {
		covers = analyzer.Covers()
	} else {
		covers = piiNamesAndPlaces()
	}
	var entities []contract.EntityType
	for _, entity := range requested {
		if !slices.Contains(patternCovered, entity) && slices.Contains(covers, entity) {
			entities = append(entities, entity)
		}
	}
	return entities
}

// findWithModel asks the operator's analyzer for entities. A failure is
// the entry's error result; neither it nor the text is logged.
func (m *Models) findWithModel(ctx context.Context, text string, entities []contract.EntityType) ([]rules.PIIMatch, *contract.Result) {
	if len(entities) == 0 {
		return nil, nil
	}
	analyzer := m.service.pii
	if analyzer == nil {
		failure := errorResult(errorTypePIIModelNotConfigured, "PERSON and LOCATION detection needs a PII model; none is configured")
		return nil, &failure
	}
	resp, err := analyzer.Analyze(ctx, channels.AnalyzeRequest{ProjectID: m.tenant.ProjectID, Text: text, Entities: entities, Language: "en"})
	if err != nil {
		failure := errorResult(errorTypePIIModelFailed, "The PII model could not analyze this entry.")
		return nil, &failure
	}
	length := utf8.RuneCountInString(text)
	var matches []rules.PIIMatch
	for _, f := range resp.Findings {
		if slices.Contains(entities, f.EntityType) && f.Start >= 0 && f.Start < f.End && f.End <= length && f.Score > 0 {
			matches = append(matches, rules.PIIMatch{PIIFinding: f, Recognizer: piiModelRecognizer})
		}
	}
	return matches, nil
}

// piiRawJSON marshals without HTML escaping, so anonymized text reads
// "<EMAIL_ADDRESS>" on the wire as Python's does.
func piiRawJSON(raw piiRawResponse) (json.RawMessage, error) {
	var buf bytes.Buffer
	encoder := json.NewEncoder(&buf)
	encoder.SetEscapeHTML(false)
	if err := encoder.Encode(raw); err != nil {
		return nil, err
	}
	return bytes.TrimRight(buf.Bytes(), "\n"), nil
}
