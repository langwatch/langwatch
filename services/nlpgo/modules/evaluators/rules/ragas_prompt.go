package rules

import (
	"encoding/json"
	"errors"
	"fmt"
	"math"
	"strconv"
	"strings"
)

// RagasField is one field of a ragas prompt's input model, in declaration
// order. Value is a string, a []string or a []RagasField (a dict); nil is
// None, which model_dump_json(exclude_none=True) leaves out.
type RagasField struct {
	Name  string
	Value any
}

// ragasKind is a pydantic field type a ragas output model uses.
type ragasKind int

const (
	ragasString ragasKind = iota
	ragasInt
	ragasBool
	ragasStrings
	ragasObjects
)

// ragasProp is one required field of an output model; items describe the
// objects of a ragasObjects list.
type ragasProp struct {
	name  string
	kind  ragasKind
	items []ragasProp
}

// RagasPrompt is one ragas PydanticPrompt: its rendered head and the output
// model its answers must validate against.
type RagasPrompt struct {
	head   string
	title  string
	output []ragasProp
}

// RagasFixOutputFormatPrompt is the repair prompt, output model StringIO.
func RagasFixOutputFormatPrompt() RagasPrompt {
	return RagasPrompt{ragasHeadFixOutputFormat, "StringIO", []ragasProp{{name: "text", kind: ragasString}}}
}

// RagasStatementGeneratorPrompt is Faithfulness' statement generator.
func RagasStatementGeneratorPrompt() RagasPrompt {
	return RagasPrompt{ragasHeadStatementGenerator, "StatementGeneratorOutput", []ragasProp{{name: "statements", kind: ragasStrings}}}
}

// RagasNLIStatementPrompt is the NLI verdict prompt Faithfulness and
// FactualCorrectness share.
func RagasNLIStatementPrompt() RagasPrompt {
	return RagasPrompt{ragasHeadNLIStatement, "NLIStatementOutput", []ragasProp{{name: "statements", kind: ragasObjects, items: []ragasProp{
		{name: "statement", kind: ragasString}, {name: "reason", kind: ragasString}, {name: "verdict", kind: ragasInt},
	}}}}
}

// RagasClaimDecompositionPrompt is FactualCorrectness' decomposition, its
// examples picked by atomicity and coverage ("low" or "high").
func RagasClaimDecompositionPrompt(atomicity, coverage string) RagasPrompt {
	heads := map[string]string{
		"low_low": ragasHeadClaimDecompositionLowLow, "low_high": ragasHeadClaimDecompositionLowHigh,
		"high_low": ragasHeadClaimDecompositionHighLow, "high_high": ragasHeadClaimDecompositionHighHigh,
	}
	return RagasPrompt{heads[atomicity+"_"+coverage], "ClaimDecompositionOutput", []ragasProp{{name: "claims", kind: ragasStrings}}}
}

// RagasContextRecallPrompt is LLMContextRecall's classification prompt.
func RagasContextRecallPrompt() RagasPrompt {
	return RagasPrompt{ragasHeadContextRecall, "ContextRecallClassifications", []ragasProp{{name: "classifications", kind: ragasObjects, items: []ragasProp{
		{name: "statement", kind: ragasString}, {name: "reason", kind: ragasString}, {name: "attributed", kind: ragasInt},
	}}}}
}

// RagasContextPrecisionPrompt is LLMContextPrecision's per-context verdict.
func RagasContextPrecisionPrompt() RagasPrompt {
	return RagasPrompt{ragasHeadContextPrecision, "Verification", []ragasProp{{name: "reason", kind: ragasString}, {name: "verdict", kind: ragasInt}}}
}

// RagasResponseRelevancePrompt is ResponseRelevancy's question generator.
func RagasResponseRelevancePrompt() RagasPrompt {
	return RagasPrompt{ragasHeadResponseRelevance, "ResponseRelevanceOutput", []ragasProp{{name: "question", kind: ragasString}, {name: "noncommittal", kind: ragasInt}}}
}

// RagasExtractKeyphrasesPrompt is SummarizationScore's first prompt.
func RagasExtractKeyphrasesPrompt() RagasPrompt {
	return RagasPrompt{ragasHeadExtractKeyphrases, "ExtractedKeyphrases", []ragasProp{{name: "keyphrases", kind: ragasStrings}}}
}

// RagasGenerateQuestionsPrompt is SummarizationScore's second prompt.
func RagasGenerateQuestionsPrompt() RagasPrompt {
	return RagasPrompt{ragasHeadGenerateQuestions, "QuestionsGenerated", []ragasProp{{name: "questions", kind: ragasStrings}}}
}

// RagasGenerateAnswersPrompt is SummarizationScore's third prompt.
func RagasGenerateAnswersPrompt() RagasPrompt {
	return RagasPrompt{ragasHeadGenerateAnswers, "AnswersGenerated", []ragasProp{{name: "answers", kind: ragasStrings}}}
}

// RagasRubricsPrompt is InstanceRubrics' SingleTurnPrompt.
func RagasRubricsPrompt() RagasPrompt {
	return RagasPrompt{ragasHeadRubrics, "ScoreFeedback", []ragasProp{{name: "feedback", kind: ragasString}, {name: "score", kind: ragasInt}}}
}

// RagasSQLEquivalencePrompt is LLMSQLEquivalence's prompt.
func RagasSQLEquivalencePrompt() RagasPrompt {
	return RagasPrompt{ragasHeadSQLEquivalence, "EquivalenceOutput", []ragasProp{
		{name: "response_query_explaination", kind: ragasString},
		{name: "reference_query_explaination", kind: ragasString},
		{name: "equivalence", kind: ragasBool},
	}}
}

// Render is PydanticPrompt.to_string: the head, then the input as pydantic's
// model_dump_json(indent=4, exclude_none=True), then "Output: ".
func (p RagasPrompt) Render(input []RagasField) string {
	var b strings.Builder
	b.WriteString(p.head)
	b.WriteString("input: ")
	writePydanticObject(&b, input, 0)
	b.WriteString("\nOutput: ")
	return b.String()
}

func writePydanticObject(b *strings.Builder, fields []RagasField, depth int) {
	var present []RagasField
	for _, field := range fields {
		if field.Value != nil {
			present = append(present, field)
		}
	}
	if len(present) == 0 {
		b.WriteString("{}")
		return
	}
	b.WriteString("{")
	for i, field := range present {
		if i > 0 {
			b.WriteString(",")
		}
		writePydanticIndent(b, depth+1)
		writePydanticString(b, field.Name)
		b.WriteString(": ")
		writePydanticValue(b, field.Value, depth+1)
	}
	writePydanticIndent(b, depth)
	b.WriteString("}")
}

func writePydanticValue(b *strings.Builder, value any, depth int) {
	switch v := value.(type) {
	case string:
		writePydanticString(b, v)
	case []RagasField:
		writePydanticObject(b, v, depth)
	case []string:
		if len(v) == 0 {
			b.WriteString("[]")
			return
		}
		b.WriteString("[")
		for i, item := range v {
			if i > 0 {
				b.WriteString(",")
			}
			writePydanticIndent(b, depth+1)
			writePydanticString(b, item)
		}
		writePydanticIndent(b, depth)
		b.WriteString("]")
	default:
		panic(fmt.Sprintf("ragas prompt input of type %T", value))
	}
}

func writePydanticIndent(b *strings.Builder, depth int) {
	b.WriteString("\n")
	b.WriteString(strings.Repeat("    ", depth))
}

// writePydanticString escapes as serde_json does: quote, backslash and
// control characters only; everything else, non-ASCII included, stays raw.
func writePydanticString(b *strings.Builder, s string) {
	b.WriteByte('"')
	for _, r := range s {
		switch r {
		case '"':
			b.WriteString(`\"`)
		case '\\':
			b.WriteString(`\\`)
		case '\n':
			b.WriteString(`\n`)
		case '\r':
			b.WriteString(`\r`)
		case '\t':
			b.WriteString(`\t`)
		case '\b':
			b.WriteString(`\b`)
		case '\f':
			b.WriteString(`\f`)
		default:
			if r < 0x20 {
				fmt.Fprintf(b, `\u%04x`, r)
			} else {
				b.WriteRune(r)
			}
		}
	}
	b.WriteByte('"')
}

// Parse is PydanticOutputParser.parse: the answer as langchain reads JSON,
// validated in pydantic's lax mode. The result is the validated object with
// values in their declared types.
func (p RagasPrompt) Parse(text string) (json.RawMessage, error) {
	decoded, err := RagasParseJSONMarkdown(strings.TrimSpace(text))
	if err != nil {
		return nil, fmt.Errorf("failed to parse %s from completion: invalid json", p.title)
	}
	validated, err := validateRagasObject(decoded, p.output)
	if err != nil {
		return nil, fmt.Errorf("failed to parse %s from completion: %w", p.title, err)
	}
	return json.Marshal(validated)
}

func validateRagasObject(value any, props []ragasProp) (map[string]any, error) {
	object, ok := value.(map[string]any)
	if !ok {
		return nil, errors.New("not an object")
	}
	out := make(map[string]any, len(props))
	for _, prop := range props {
		raw, present := object[prop.name]
		if !present {
			return nil, fmt.Errorf("%s: field required", prop.name)
		}
		converted, err := validateRagasValue(raw, prop)
		if err != nil {
			return nil, fmt.Errorf("%s: %w", prop.name, err)
		}
		out[prop.name] = converted
	}
	return out, nil
}

func validateRagasValue(raw any, prop ragasProp) (any, error) {
	switch prop.kind {
	case ragasString:
		if s, ok := raw.(string); ok {
			return s, nil
		}
		return nil, errors.New("input should be a valid string")
	case ragasInt:
		return laxInt(raw)
	case ragasBool:
		return laxBool(raw)
	case ragasStrings, ragasObjects:
		return validateRagasList(raw, prop)
	}
	return nil, fmt.Errorf("unknown field kind %d", prop.kind)
}

func validateRagasList(raw any, prop ragasProp) (any, error) {
	list, ok := raw.([]any)
	if !ok {
		return nil, errors.New("input should be a valid list")
	}
	item := func(value any) (any, error) { return validateRagasObject(value, prop.items) }
	if prop.kind == ragasStrings {
		item = func(value any) (any, error) { return validateRagasValue(value, ragasProp{kind: ragasString}) }
	}
	out := make([]any, len(list))
	for i, value := range list {
		var err error
		if out[i], err = item(value); err != nil {
			return nil, fmt.Errorf("%d: %w", i, err)
		}
	}
	return out, nil
}

// laxInt is pydantic's lax int: integers, whole floats, numeric strings and
// booleans.
func laxInt(raw any) (int64, error) {
	var text string
	switch v := raw.(type) {
	case bool:
		if v {
			return 1, nil
		}
		return 0, nil
	case json.Number:
		text = string(v)
	case string:
		text = strings.TrimSpace(v)
	default:
		return 0, errors.New("input should be a valid integer")
	}
	if n, err := strconv.ParseInt(text, 10, 64); err == nil {
		return n, nil
	}
	f, err := strconv.ParseFloat(text, 64)
	if err != nil || math.IsInf(f, 0) || f != math.Trunc(f) {
		return 0, errors.New("input should be a valid integer")
	}
	return int64(f), nil
}

// laxBool is pydantic's lax bool: booleans, 0 and 1, and its yes/no words.
func laxBool(raw any) (bool, error) {
	switch v := raw.(type) {
	case bool:
		return v, nil
	case json.Number:
		if f, err := v.Float64(); err == nil && (f == 0 || f == 1) {
			return f == 1, nil
		}
	case string:
		switch strings.ToLower(v) {
		case "1", "on", "t", "true", "y", "yes":
			return true, nil
		case "0", "off", "f", "false", "n", "no":
			return false, nil
		}
	}
	return false, errors.New("input should be a valid boolean")
}
