package rules

import (
	"fmt"
	"slices"
	"sort"
)

// token_budget.py's numbers. Spec: specs/evaluators/langevals-judge-long-content.feature.
const (
	judgeMaxTokensHardLimit    = 1_048_576
	judgeAnswerReserveTokens   = 8_192
	judgeFieldOverheadTokens   = 8
	judgeContextOverheadTokens = 4
	judgeMinKeptEndTokens      = 32
	judgeMinContentTokens      = 256
)

// judgeModelInputWindow is litellm's max_input_tokens, 0 when unknown. No Go
// model registry carries input windows, so this covers the recorded models.
// ponytail: a hand table; read the model catalogue's windows when one reaches Go.
func judgeModelInputWindow(model string) int {
	switch model {
	case "openai/gpt-4o-mini", "gpt-4o-mini", "openai/gpt-4o-mini-2024-07-18", "gpt-4o-mini-2024-07-18", "openai/gpt-4o", "gpt-4o":
		return 128_000
	case "openai/gpt-5-mini", "gpt-5-mini", "openai/gpt-5", "gpt-5":
		return 272_000
	}
	return 0
}

// JudgeTokenBudget is judge_token_budget: the max tokens setting, capped by
// the hard limit and by the model's window less room for the answer.
func JudgeTokenBudget(model string, maxTokens int) int {
	budget := min(maxTokens, judgeMaxTokensHardLimit)
	if window := judgeModelInputWindow(model); window > judgeAnswerReserveTokens {
		budget = min(budget, window-judgeAnswerReserveTokens)
	}
	return budget
}

func judgeElisionMarker(omitted int) string {
	return fmt.Sprintf("\n\n[... %d tokens omitted from the middle to fit the length limit ...]\n\n", omitted)
}

// CutKeepingEnds is cut_keeping_ends: text cut to maxTokens keeping both
// ends, and the tokens omitted. Slices count code points, as Python's do.
func (c *TokenCounter) CutKeepingEnds(model, text string, maxTokens int) (string, int) {
	total := c.Count(model, text)
	if total <= maxTokens {
		return text, 0
	}
	runes := []rune(text)
	charsPerToken := float64(len(runes)) / float64(max(1, total))
	room := maxTokens - c.Count(model, judgeElisionMarker(total))
	if room < judgeMinKeptEndTokens*2 {
		head := c.cutHead(model, runes[:clampIndex(int(float64(maxTokens)*charsPerToken), len(runes))], maxTokens)
		return head, total - c.Count(model, head)
	}
	keep := room
	var head, tail string
	kept := 0
	for range 8 {
		half := clampIndex(int(float64(keep)/2*charsPerToken), len(runes))
		head, tail = string(runes[:half]), string(runes[len(runes)-half:])
		kept = c.Count(model, head) + c.Count(model, tail)
		if kept <= room {
			break
		}
		keep = int(float64(keep*room) / float64(kept) * 0.97)
	}
	omitted := max(1, total-kept)
	return head + judgeElisionMarker(omitted) + tail, omitted
}

// cutHead drops a tenth of the head until it fits.
func (c *TokenCounter) cutHead(model string, head []rune, maxTokens int) string {
	for len(head) > 0 && c.Count(model, string(head)) > maxTokens {
		head = head[:int(float64(len(head))*0.9)]
	}
	return string(head)
}

func clampIndex(index, length int) int {
	return max(0, min(index, length))
}

// FitContexts is fit_contexts: whole contexts kept from both ends, a marker
// entry for those left out between, and one oversized context cut at its ends.
func (c *TokenCounter) FitContexts(model string, contexts []string, budget int) ([]string, int) {
	sizes := make([]int, len(contexts))
	total := 0
	for i, context := range contexts {
		sizes[i] = c.Count(model, context) + judgeContextOverheadTokens
		total += sizes[i]
	}
	if total <= budget {
		return contexts, 0
	}
	half := budget / 2
	headCount := wholeContextsFitting(sizes, half)
	tailCount := wholeContextsFitting(reversedSizes(sizes[headCount:]), half)
	head := slices.Clone(contexts[:headCount])
	tail := slices.Clone(contexts[len(contexts)-tailCount:])
	omitted := 0
	if len(head) == 0 && len(tail) == 0 {
		first, leftOut := c.CutKeepingEnds(model, contexts[0], half)
		head, omitted = []string{first}, leftOut
	}
	if len(tail) == 0 && len(contexts) > len(head) {
		last, leftOut := c.CutKeepingEnds(model, contexts[len(contexts)-1], half)
		tail, omitted = []string{last}, omitted+leftOut
	}
	start, end := len(head), max(len(head), len(contexts)-len(tail))
	for _, size := range sizes[start:end] {
		omitted += size
	}
	if end > start {
		head = append(head, fmt.Sprintf("[... %d contexts, %d tokens, omitted from the middle to fit the length limit ...]", end-start, omitted))
	}
	return append(head, tail...), omitted
}

// wholeContextsFitting counts the leading contexts whose sizes fit limit together.
func wholeContextsFitting(sizes []int, limit int) int {
	used := 0
	for i, size := range sizes {
		if used+size > limit {
			return i
		}
		used += size
	}
	return len(sizes)
}

func reversedSizes(sizes []int) []int {
	reversed := slices.Clone(sizes)
	slices.Reverse(reversed)
	return reversed
}

// JudgeFit is fit_judge_content's answer. Skip holds the details when the
// prompt leaves no room for any content.
type JudgeFit struct {
	Fields        JudgeFields
	OmittedTokens int
	Budget        int
	Skip          string
}

// WithNote is FittedContent.with_note: details plus what the judge did not see.
func (f JudgeFit) WithNote(details string) string {
	if f.OmittedTokens == 0 {
		return details
	}
	note := fmt.Sprintf("%d tokens were omitted from the middle of the content to fit the maximum of %d tokens.", f.OmittedTokens, f.Budget)
	if details == "" {
		return note
	}
	return details + "\n\n" + note
}

// JudgeFitRequest is what fit_judge_content fits: the fields, beside the
// judge's own prompt texts (Reserved), within the model's budget.
type JudgeFitRequest struct {
	Model     string
	MaxTokens int
	Reserved  []string
	Fields    JudgeFields
}

type judgeSizedField struct {
	key      string
	text     string
	contexts []string
	tokens   int
}

// judgeSizing is every cuttable field with its size, and the contexts split
// into text (cuttable) and image references (never cut).
type judgeSizing struct {
	fields        []judgeSizedField
	textContexts  []string
	imageContexts []string
}

func (c *TokenCounter) sizeJudgeFields(model string, fields JudgeFields) judgeSizing {
	var sizing judgeSizing
	for _, field := range []struct {
		key   string
		value *string
	}{{"input", fields.Input}, {"output", fields.Output}, {"expected_output", fields.ExpectedOutput}} {
		if field.value != nil && *field.value != "" && DetectImage(*field.value) == "" {
			sizing.fields = append(sizing.fields, judgeSizedField{key: field.key, text: *field.value, tokens: c.Count(model, *field.value) + judgeFieldOverheadTokens})
		}
	}
	contextTokens := 0
	for _, context := range fields.Contexts {
		if DetectImage(context) != "" {
			sizing.imageContexts = append(sizing.imageContexts, context)
			continue
		}
		sizing.textContexts = append(sizing.textContexts, context)
		contextTokens += c.Count(model, context) + judgeContextOverheadTokens
	}
	if len(sizing.textContexts) > 0 {
		sizing.fields = append(sizing.fields, judgeSizedField{key: "contexts", contexts: sizing.textContexts, tokens: contextTokens + judgeFieldOverheadTokens})
	}
	return sizing
}

// FitJudgeContent is fit_judge_content: the fields cut so that they and the
// judge's own prompt texts fit the budget. Image references are never cut.
func (c *TokenCounter) FitJudgeContent(req JudgeFitRequest) JudgeFit {
	budget := JudgeTokenBudget(req.Model, req.MaxTokens)
	needed, reservedTokens := 0, 0
	for _, text := range req.Reserved {
		reservedTokens += c.Count(req.Model, text)
	}
	sizing := c.sizeJudgeFields(req.Model, req.Fields)
	for _, field := range sizing.fields {
		needed += field.tokens
	}
	if reservedTokens+needed <= budget {
		return JudgeFit{Fields: req.Fields, Budget: budget}
	}
	slack := 0.03
	room := int(float64(budget-reservedTokens) * (1 - slack))
	if room < judgeMinContentTokens {
		return JudgeFit{Budget: budget, Skip: fmt.Sprintf("The evaluator prompt takes %d tokens, which leaves no room for the content within the maximum of %d tokens.", reservedTokens, budget)}
	}
	fit := c.shareJudgeRoom(req, sizing, room)
	fit.Budget = budget
	return fit
}

// shareJudgeRoom gives the smallest fields their whole size first; the rest
// split what is left and are cut to their share.
func (c *TokenCounter) shareJudgeRoom(req JudgeFitRequest, sizing judgeSizing, room int) JudgeFit {
	sort.SliceStable(sizing.fields, func(i, j int) bool { return sizing.fields[i].tokens < sizing.fields[j].tokens })
	fitted, textContexts := req.Fields, sizing.textContexts
	omitted, remaining := 0, room
	for position, field := range sizing.fields {
		share := remaining / (len(sizing.fields) - position)
		if field.tokens <= share {
			remaining -= field.tokens
			continue
		}
		remaining -= share
		var leftOut int
		if field.key == "contexts" {
			textContexts, leftOut = c.FitContexts(req.Model, field.contexts, share-judgeFieldOverheadTokens)
		} else {
			var cut string
			cut, leftOut = c.CutKeepingEnds(req.Model, field.text, share-judgeFieldOverheadTokens)
			fitted = withJudgeField(fitted, field.key, cut)
		}
		omitted += leftOut
	}
	if req.Fields.Contexts != nil {
		fitted.Contexts = append(slices.Clone(textContexts), sizing.imageContexts...)
	}
	return JudgeFit{Fields: fitted, OmittedTokens: omitted}
}

func withJudgeField(fields JudgeFields, key, value string) JudgeFields {
	switch key {
	case "input":
		fields.Input = &value
	case "output":
		fields.Output = &value
	default:
		fields.ExpectedOutput = &value
	}
	return fields
}
