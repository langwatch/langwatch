package rules

import (
	"encoding/json"
	"reflect"
	"slices"
	"strings"
	"unicode"
	"unicode/utf8"

	"github.com/langwatch/langwatch/services/nlpgo/modules/evaluators/contract"
)

// PIIMaxContentChars is pii_detection.py's limit, counted in characters.
const PIIMaxContentChars = 524288

// PIIContent is the text pii_detection.py analyzes: input and output joined
// by a blank line and stripped. JSON content has its \n, \t and \r escapes
// unescaped so patterns see line breaks; IsJSON says to escape them back.
type PIIContent struct {
	Text   string
	IsJSON bool
}

// NewPIIContent builds the analyzed text from an entry.
func NewPIIContent(entry contract.Entry) PIIContent {
	text := strings.TrimFunc(deref(entry.Input)+"\n\n"+deref(entry.Output), isPIISpace)
	if !json.Valid([]byte(text)) {
		return PIIContent{Text: text}
	}
	unescaped := strings.NewReplacer(`\n`, "\n", `\t`, "\t", `\r`, "\r").Replace(text)
	return PIIContent{Text: unescaped, IsJSON: true}
}

// TooLong says the text is over PIIMaxContentChars.
func (c PIIContent) TooLong() bool {
	return utf8.RuneCountInString(c.Text) > PIIMaxContentChars
}

// Escaped puts back the escapes NewPIIContent took out, on anonymized text.
func (c PIIContent) Escaped(text string) string {
	if !c.IsJSON {
		return text
	}
	return strings.NewReplacer("\n", `\n`, "\t", `\t`, "\r", `\r`).Replace(text)
}

func deref(s *string) string {
	if s == nil {
		return ""
	}
	return *s
}

// isPIISpace is str.isspace, which also counts the information separators.
func isPIISpace(r rune) bool {
	return unicode.IsSpace(r) || (r >= 0x1c && r <= 0x1f)
}

// RequestedPIIEntities are the entity types the settings switch on, in the
// order PresidioEntities declares them.
func RequestedPIIEntities(entities PresidioEntities) []contract.EntityType {
	value := reflect.ValueOf(entities)
	var requested []contract.EntityType
	for i := range value.NumField() {
		if value.Field(i).Bool() {
			tag, _, _ := strings.Cut(value.Type().Field(i).Tag.Get("json"), ",")
			requested = append(requested, contract.EntityType(strings.ToUpper(tag)))
		}
	}
	return requested
}

// MergePIIMatches is the analyzer's last remove_duplicates over pattern and
// model findings together.
func MergePIIMatches(patterns, model []PIIMatch) []PIIMatch {
	return removeDuplicates(append(slices.Clone(patterns), model...))
}

// AboveThreshold keeps findings scoring at least minThreshold.
func AboveThreshold(matches []PIIMatch, minThreshold float64) []PIIMatch {
	var kept []PIIMatch
	for _, m := range matches {
		if m.Score >= minThreshold {
			kept = append(kept, m)
		}
	}
	return kept
}

// PIIDetails is pii_detection.py's details: nil with no finding.
func PIIDetails(matches []PIIMatch) *string {
	if len(matches) == 0 {
		return nil
	}
	findings := make([]string, len(matches))
	for i, m := range matches {
		findings[i] = string(m.EntityType) + " (likelihood: " + pyFloatRepr(m.Score) + ")"
	}
	details := "PII detected: " + strings.Join(findings, ", ")
	return &details
}

// Anonymize is presidio_anonymizer's AnonymizerEngine.anonymize with the
// default replace operator: each surviving span becomes <ENTITY_TYPE>.
func Anonymize(text string, findings []contract.PIIFinding) string {
	spans := resolveConflicts(findings)
	spans = mergeSpaceSeparated([]rune(text), spans)
	slices.SortStableFunc(spans, func(a, b contract.PIIFinding) int {
		if a.Start != b.Start {
			return b.Start - a.Start
		}
		return b.End - a.End
	})
	out := []rune(text)
	last := len(out)
	for _, s := range spans {
		end := min(s.End, last)
		replaced := append([]rune("<"+string(s.EntityType)+">"), out[end:]...)
		out = append(out[:s.Start:s.Start], replaced...)
		last = s.Start
	}
	return string(out)
}

// resolveConflicts is _remove_conflicts_and_get_text_manipulation_data under
// MERGE_SIMILAR_OR_CONTAINED: overlapping findings of one type merge, then a
// finding inside another (or at the same span, scoring no higher) drops.
func resolveConflicts(findings []contract.PIIFinding) []contract.PIIFinding {
	return dropConflicts(mergeSameType(sortedByPosition(findings)))
}

func sortedByPosition(findings []contract.PIIFinding) []*contract.PIIFinding {
	sorted := make([]*contract.PIIFinding, len(findings))
	for i := range findings {
		f := findings[i]
		sorted[i] = &f
	}
	slices.SortStableFunc(sorted, func(a, b *contract.PIIFinding) int {
		if a.Start != b.Start {
			return a.Start - b.Start
		}
		return a.End - b.End
	})
	return sorted
}

// mergeSameType folds each finding into an overlapping one of its type,
// widening that one in place, as Presidio mutates its list.
func mergeSameType(sorted []*contract.PIIFinding) []*contract.PIIFinding {
	var merged []*contract.PIIFinding
	others := slices.Clone(sorted)
	for _, result := range sorted {
		others = removeFirstEqual(others, result)
		if !mergedIntoOther(result, others) {
			others = append(others, result)
			merged = append(merged, result)
		}
	}
	return merged
}

func mergedIntoOther(result *contract.PIIFinding, others []*contract.PIIFinding) bool {
	for _, other := range others {
		if other.EntityType == result.EntityType && intersects(*result, *other) > 0 {
			other.Start = min(result.Start, other.Start)
			other.End = max(result.End, other.End)
			other.Score = max(result.Score, other.Score)
			return true
		}
	}
	return false
}

func dropConflicts(merged []*contract.PIIFinding) []contract.PIIFinding {
	var unique []contract.PIIFinding
	others := slices.Clone(merged)
	for _, result := range merged {
		others = removeFirstEqual(others, result)
		conflicted := slices.ContainsFunc(others, func(other *contract.PIIFinding) bool { return hasConflict(*result, *other) })
		if !conflicted {
			others = append(others, result)
			unique = append(unique, *result)
		}
	}
	return unique
}

// removeFirstEqual is list.remove: the first element equal by value.
func removeFirstEqual(list []*contract.PIIFinding, target *contract.PIIFinding) []*contract.PIIFinding {
	for i, item := range list {
		if *item == *target {
			return slices.Delete(slices.Clone(list), i, i+1)
		}
	}
	return list
}

func intersects(a, b contract.PIIFinding) int {
	if a.End < b.Start || b.End < a.Start {
		return 0
	}
	return min(a.End, b.End) - max(a.Start, b.Start)
}

func hasConflict(a, other contract.PIIFinding) bool {
	if a.Start == other.Start && a.End == other.End {
		return a.Score <= other.Score
	}
	return other.Start <= a.Start && other.End >= a.End
}

// mergeSpaceSeparated is _merge_entities_with_spaces_between: neighbors of
// one type separated only by spaces become one span.
func mergeSpaceSeparated(runes []rune, spans []contract.PIIFinding) []contract.PIIFinding {
	var merged []contract.PIIFinding
	for i, s := range spans {
		if i > 0 {
			prev := spans[i-1]
			if prev.EntityType == s.EntityType && prev.End < s.Start && strings.Trim(string(runes[prev.End:s.Start]), " ") == "" {
				merged = merged[:len(merged)-1]
				s.Start = prev.Start
				spans[i] = s
			}
		}
		merged = append(merged, s)
	}
	return merged
}

// PIIResultJSON is one finding in raw_response.results, RecognizerResult's
// to_dict. The identifier is Presidio's name plus a fixed suffix where
// Presidio appends the recognizer's memory address.
type PIIResultJSON struct {
	EntityType          contract.EntityType `json:"entity_type"`
	Start               int                 `json:"start"`
	End                 int                 `json:"end"`
	Score               float64             `json:"score"`
	AnalysisExplanation *struct{}           `json:"analysis_explanation"`
	RecognitionMetadata map[string]string   `json:"recognition_metadata"`
}

// PIIResultsJSON renders findings as raw_response.results.
func PIIResultsJSON(matches []PIIMatch) []PIIResultJSON {
	out := make([]PIIResultJSON, len(matches))
	for i, m := range matches {
		out[i] = PIIResultJSON{
			EntityType: m.EntityType, Start: m.Start, End: m.End, Score: m.Score,
			RecognitionMetadata: map[string]string{"recognizer_name": m.Recognizer, "recognizer_identifier": m.Recognizer + "_0"},
		}
	}
	return out
}

// Findings strips the recognizer names.
func Findings(matches []PIIMatch) []contract.PIIFinding {
	out := make([]contract.PIIFinding, len(matches))
	for i, m := range matches {
		out[i] = m.PIIFinding
	}
	return out
}
