package scenario

import (
	"encoding/json"
	"strconv"
	"unicode/utf8"

	"github.com/langwatch/scenario/go/internal/jsjson"
)

const criterionParamNameMax = 70

// criterionToParamName sanitizes a criterion into a schema key: quotes
// dropped, every non-ASCII-alphanumeric UTF-16 unit replaced by "_",
// lowercased and cut to 70 characters, like the JS SDK.
func criterionToParamName(criterion string) string {
	b := make([]byte, 0, len(criterion))
	for i := 0; i < len(criterion); {
		c := criterion[i]
		if c < utf8.RuneSelf {
			i++
			switch {
			case c == '"':
				continue
			case c >= 'A' && c <= 'Z':
				b = append(b, c+'a'-'A')
			case (c >= 'a' && c <= 'z') || (c >= '0' && c <= '9'):
				b = append(b, c)
			default:
				b = append(b, '_')
			}
		} else {
			r, size := utf8.DecodeRuneInString(criterion[i:])
			i += size
			b = append(b, '_')
			if r >= 0x10000 {
				b = append(b, '_')
			}
		}
		if len(b) >= criterionParamNameMax {
			break
		}
	}
	if len(b) > criterionParamNameMax {
		b = b[:criterionParamNameMax]
	}
	return string(b)
}

// criteriaParamNames returns one unique schema key per criterion: a taken
// name gets a numeric suffix (starting at the criterion's index, as in JS)
// and the base is shortened so it still fits 70 characters.
func criteriaParamNames(criteria []string) []string {
	taken := make(map[string]bool, len(criteria))
	out := make([]string, len(criteria))
	for i, c := range criteria {
		base := criterionToParamName(c)
		name := base
		suffix := i
		for taken[name] {
			s := "_" + strconv.Itoa(suffix)
			suffix++
			cut := min(len(base), criterionParamNameMax-len(s))
			name = base[:cut] + s
		}
		taken[name] = true
		out[i] = name
	}
	return out
}

// emptyObjectSchema is the schema of the argument-free judge tools.
func emptyObjectSchema() map[string]any {
	return map[string]any{"type": "object", "properties": map[string]any{}, "additionalProperties": false}
}

// buildFinishTestTool returns the verdict tool. The criteria properties are
// pre-encoded JSON so they keep their declared order in the schema the
// model sees.
func buildFinishTestTool(criteria []string) ToolDefinition {
	names := criteriaParamNames(criteria)
	props := make(jsjson.Object, len(criteria))
	required := make([]any, len(criteria))
	for i, name := range names {
		props[i] = jsjson.Member{Key: name, Value: jsjson.Object{
			{Key: "type", Value: "object"},
			{Key: "properties", Value: jsjson.Object{
				{Key: "requirement", Value: jsjson.Object{{Key: "type", Value: "string"}, {Key: "description", Value: requirementDescription}}},
				{Key: "reasoning", Value: jsjson.Object{{Key: "type", Value: "string"}, {Key: "description", Value: criterionReasoningDescription}}},
				{Key: "status", Value: jsjson.Object{
					{Key: "type", Value: "string"},
					{Key: "enum", Value: []any{"passed", "failed", "inconclusive"}},
					{Key: "description", Value: statusDescription},
				}},
			}},
			{Key: "required", Value: []any{"requirement", "reasoning", "status"}},
			{Key: "additionalProperties", Value: false},
			{Key: "description", Value: "Criterion " + strconv.Itoa(i+1) + ": " + criteria[i]},
		}}
		required[i] = name
	}
	criteriaSchema := jsjson.Object{
		{Key: "type", Value: "object"},
		{Key: "properties", Value: props},
		{Key: "required", Value: required},
		{Key: "additionalProperties", Value: false},
		{Key: "description", Value: "The verdict on each criterion"},
	}
	return ToolDefinition{
		Name:        "finish_test",
		Description: finishTestDescription,
		Parameters: map[string]any{
			"type": "object",
			"properties": map[string]any{
				"criteria":  json.RawMessage(jsjson.Stringify(criteriaSchema)),
				"reasoning": map[string]any{"type": "string", "description": summaryDescription},
			},
			"required":             []any{"criteria", "reasoning"},
			"additionalProperties": false,
		},
	}
}

// criterionVerdicts is the run verdict derived from finish_test answers.
type criterionVerdicts struct {
	verdict      string // success, failure or inconclusive
	criteria     []CriterionResult
	met          []string
	unmet        []string
	inconclusive []string
}

// readAnswer reads one criterion's answer. A bare status (or the legacy
// true/false) still counts; anything else is a missing answer.
func readAnswer(answer any) (CriterionResult, bool) {
	switch a := answer.(type) {
	case bool:
		if a {
			return CriterionResult{Status: CriterionPassed}, true
		}
		return CriterionResult{Status: CriterionFailed}, true
	case string:
		switch a {
		case "passed", "true":
			return CriterionResult{Status: CriterionPassed}, true
		case "failed", "false":
			return CriterionResult{Status: CriterionFailed}, true
		case "inconclusive":
			return CriterionResult{Status: CriterionInconclusive}, true
		}
	case jsjson.Object:
		status, _ := a.Get("status")
		s, ok := status.(string)
		if !ok || (s != "passed" && s != "failed" && s != "inconclusive") {
			return CriterionResult{}, false
		}
		r := CriterionResult{Status: CriterionStatus(s)}
		if v, ok := a.Get("requirement"); ok {
			r.Requirement, _ = v.(string)
		}
		if v, ok := a.Get("reasoning"); ok {
			r.Reasoning, _ = v.(string)
		}
		return r, true
	}
	return CriterionResult{}, false
}

// parseCriterionVerdicts maps the answers back onto the declared criteria by
// schema key. Any failed criterion fails the run, otherwise any inconclusive
// (or no criteria at all) makes it inconclusive. A missing answer fails
// closed.
func parseCriterionVerdicts(criteria []string, answers any) criterionVerdicts {
	obj, _ := answers.(jsjson.Object)
	names := criteriaParamNames(criteria)
	v := criterionVerdicts{
		criteria: make([]CriterionResult, len(criteria)),
		met:      []string{},
		unmet:    []string{},
	}
	failed := false
	for i, c := range criteria {
		ans, _ := obj.Get(names[i])
		r, ok := readAnswer(ans)
		if !ok {
			r = CriterionResult{Status: CriterionFailed, Reasoning: "The judge returned no verdict for this criterion."}
		}
		r.Criterion = c
		v.criteria[i] = r
		switch r.Status {
		case CriterionPassed:
			v.met = append(v.met, c)
		case CriterionInconclusive:
			v.unmet = append(v.unmet, c)
			v.inconclusive = append(v.inconclusive, c)
		default:
			v.unmet = append(v.unmet, c)
			failed = true
		}
	}
	switch {
	case failed:
		v.verdict = "failure"
	case len(v.inconclusive) > 0 || len(criteria) == 0:
		v.verdict = "inconclusive"
	default:
		v.verdict = "success"
	}
	return v
}
