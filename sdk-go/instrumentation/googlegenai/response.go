package googlegenai

import (
	"encoding/json"
	"strings"

	semconv "go.opentelemetry.io/otel/semconv/v1.40.0"

	langwatch "github.com/langwatch/langwatch/sdk-go"
)

// generateContentResponse is the subset of a Gemini GenerateContentResponse the
// tracer reads, shared by the non-streaming body and each streamed chunk.
type generateContentResponse struct {
	Candidates    []responseCandidate `json:"candidates"`
	ModelVersion  string              `json:"modelVersion"`
	ResponseID    string              `json:"responseId"`
	UsageMetadata *usageMetadata      `json:"usageMetadata"`
}

// responseCandidate is the subset of a Gemini Candidate the tracer reads.
type responseCandidate struct {
	Content      geminiContent `json:"content"`
	FinishReason string        `json:"finishReason"`
	Index        int           `json:"index"`
}

// recordResponse records the shared response attributes for both the
// non-streaming body and the final streamed chunk: response id, model version,
// usage (gen_ai.usage.* + langwatch.metrics), finish reasons and — gated by
// capture — the output text.
func recordResponse(span *langwatch.Span, resp *generateContentResponse, capture langwatch.DataCaptureMode) {
	if resp.ResponseID != "" {
		span.SetAttributes(semconv.GenAIResponseID(resp.ResponseID))
	}
	if resp.ModelVersion != "" {
		span.SetResponseModel(resp.ModelVersion)
	}

	recordUsage(span, resp.UsageMetadata)

	if reasons := candidateFinishReasons(resp.Candidates); len(reasons) > 0 {
		span.SetGenAIResponseFinishReasons(reasons...)
	}

	if capture.CaptureOutput() {
		// Record the assistant response as structured chat messages when it
		// carries functionCall parts (the common agent case), so they are not
		// discarded; otherwise keep the plain-text path for pure-text responses.
		if parts, hasToolCall := candidateParts(resp.Candidates); hasToolCall {
			span.SetGenAIOutputMessages([]langwatch.ChatMessage{{
				Role:    langwatch.ChatRoleAssistant,
				Content: parts,
			}})
		} else if text := candidatesText(resp.Candidates); text != "" {
			span.SetGenAIOutputMessages([]langwatch.ChatMessage{langwatch.TextMessage(langwatch.ChatRoleAssistant, text)})
		}
	}
}

// candidateParts expands the first candidate's content parts into LangWatch
// rich content: text parts become text parts; functionCall parts become
// tool_call parts. hasToolCall reports whether any functionCall part was present
// (mirroring candidatesText, which reads the first candidate only).
func candidateParts(candidates []responseCandidate) (parts []langwatch.ChatRichContent, hasToolCall bool) {
	if len(candidates) == 0 {
		return nil, false
	}
	return partsToRichContent(candidates[0].Content.Parts)
}

// partsToRichContent converts Gemini content parts into LangWatch rich content,
// keeping text and functionCall parts. hasToolCall reports whether a
// functionCall was seen.
func partsToRichContent(parts []geminiPart) (out []langwatch.ChatRichContent, hasToolCall bool) {
	for _, p := range parts {
		switch {
		case p.FunctionCall != nil:
			hasToolCall = true
			out = append(out, langwatch.ChatRichContent{
				Type:       langwatch.ChatContentTypeToolCall,
				ToolName:   p.FunctionCall.Name,
				ToolCallID: p.FunctionCall.ID,
				Args:       marshalArgs(p.FunctionCall.Args),
			})
		case p.Thought:
			// Thought summaries are not part of the visible output.
		case p.Text != "":
			out = append(out, langwatch.TextPart(p.Text))
		}
	}
	return out, hasToolCall
}

// marshalArgs renders a functionCall's args map to its JSON string form,
// returning "" when empty or on error.
func marshalArgs(args map[string]any) string {
	if len(args) == 0 {
		return ""
	}
	raw, err := json.Marshal(args)
	if err != nil {
		return ""
	}
	return string(raw)
}

// candidateFinishReasons returns the (deduplicated, non-empty) finish reasons
// across all candidates.
func candidateFinishReasons(candidates []responseCandidate) []string {
	var reasons []string
	for _, c := range candidates {
		if c.FinishReason != "" {
			reasons = append(reasons, c.FinishReason)
		}
	}
	return dedupe(reasons)
}

// candidatesText concatenates the text parts of the first candidate's content,
// mirroring genai's GenerateContentResponse.Text() (first candidate only).
func candidatesText(candidates []responseCandidate) string {
	if len(candidates) == 0 {
		return ""
	}
	return partsText(candidates[0].Content.Parts)
}

// generateContentStreamAccumulator reconstructs a Gemini streamGenerateContent
// response. Each SSE data line is a GenerateContentResponse chunk carrying
// candidates[].content.parts[].text deltas; the final chunk carries usageMetadata,
// the finish reason and modelVersion. The stream has NO [DONE] sentinel — it ends
// on EOF (IsTerminal always returns false).
type generateContentStreamAccumulator struct {
	output        strings.Builder
	finishReasons []string
	modelVersion  string
	responseID    string
	usage         *usageMetadata
	// toolCalls collects functionCall parts as they stream from the first
	// candidate. Gemini emits each functionCall whole (it does not stream partial
	// args), so each is appended as it arrives.
	toolCalls []langwatch.ChatRichContent
}

func (a *generateContentStreamAccumulator) IsTerminal(string) bool {
	// Gemini's SSE stream ends on EOF, not on a sentinel line.
	return false
}

func (a *generateContentStreamAccumulator) Consume(dataLine string) {
	var chunk generateContentResponse
	if err := json.Unmarshal([]byte(dataLine), &chunk); err != nil {
		return
	}

	if a.responseID == "" && chunk.ResponseID != "" {
		a.responseID = chunk.ResponseID
	}
	if chunk.ModelVersion != "" {
		a.modelVersion = chunk.ModelVersion
	}

	// Accumulate text and tool calls from the first candidate (mirroring Text()),
	// and collect finish reasons across candidates as they arrive.
	if len(chunk.Candidates) > 0 {
		parts, hasToolCall := partsToRichContent(chunk.Candidates[0].Content.Parts)
		if hasToolCall {
			for _, p := range parts {
				if p.Type == langwatch.ChatContentTypeToolCall {
					a.toolCalls = append(a.toolCalls, p)
				}
			}
		}
		a.output.WriteString(partsText(chunk.Candidates[0].Content.Parts))
		for _, c := range chunk.Candidates {
			if c.FinishReason != "" {
				a.finishReasons = append(a.finishReasons, c.FinishReason)
			}
		}
	}

	// Usage arrives on the final chunk; keep the latest non-nil block.
	if chunk.UsageMetadata != nil {
		a.usage = chunk.UsageMetadata
	}
}

func (a *generateContentStreamAccumulator) Finish(span *langwatch.Span, capture langwatch.DataCaptureMode) {
	if a.responseID != "" {
		span.SetAttributes(semconv.GenAIResponseID(a.responseID))
	}
	if a.modelVersion != "" {
		span.SetResponseModel(a.modelVersion)
	}
	recordUsage(span, a.usage)
	span.SetGenAIResponseFinishReasons(dedupe(a.finishReasons)...)

	if capture.CaptureOutput() {
		// Record structured chat messages when functionCall parts were streamed
		// (the common agent case), so they are not discarded; otherwise keep the
		// plain-text path for pure-text responses.
		if len(a.toolCalls) > 0 {
			parts := a.toolCalls
			if a.output.Len() > 0 {
				parts = append([]langwatch.ChatRichContent{langwatch.TextPart(a.output.String())}, parts...)
			}
			span.SetGenAIOutputMessages([]langwatch.ChatMessage{{
				Role:    langwatch.ChatRoleAssistant,
				Content: parts,
			}})
		} else if a.output.Len() > 0 {
			span.SetGenAIOutputMessages([]langwatch.ChatMessage{langwatch.TextMessage(langwatch.ChatRoleAssistant, a.output.String())})
		}
	}
}

// dedupe returns the unique values of in, preserving first-seen order.
func dedupe(in []string) []string {
	if len(in) == 0 {
		return nil
	}
	seen := make(map[string]struct{}, len(in))
	out := make([]string, 0, len(in))
	for _, v := range in {
		if _, ok := seen[v]; ok {
			continue
		}
		seen[v] = struct{}{}
		out = append(out, v)
	}
	return out
}
