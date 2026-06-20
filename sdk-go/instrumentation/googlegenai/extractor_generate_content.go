package googlegenai

import (
	"encoding/json"
	"strings"

	langwatch "github.com/langwatch/langwatch/sdk-go"
	"github.com/langwatch/langwatch/sdk-go/instrumentation/otelhttp"
)

// generateContentExtractor handles the Gemini content-generation endpoints,
// POST .../models/{model}:generateContent and .../models/{model}:streamGenerateContent.
//
// Discriminators: the request body carries a contents[] array (the model and the
// action live in the URL path, not the body — see operation.go); the
// non-streaming response is a GenerateContentResponse carrying candidates[]; the
// stream is a sequence of GenerateContentResponse chunks over SSE with NO [DONE]
// sentinel (it ends on EOF).
//
// The wire format is Gemini's camelCase JSON, so we read it directly with the
// otelhttp helpers rather than depending on genai's typed structs (which mirror
// the wire but carry far more than the tracer needs).
type generateContentExtractor struct{}

func (generateContentExtractor) Name() string { return "generate_content" }

func (generateContentExtractor) MatchesRequest(body otelhttp.JSONObject, pathHint string) bool {
	// The defining shape is a contents[] array. The path hint claims the
	// generateContent / streamGenerateContent actions on a model resource.
	if _, ok := body["contents"].([]any); ok {
		return true
	}
	return strings.Contains(pathHint, ":generateContent") ||
		strings.Contains(pathHint, ":streamGenerateContent")
}

func (generateContentExtractor) MatchesResponse(objectField, contentType string) bool {
	if strings.HasPrefix(contentType, "text/event-stream") {
		return false // streaming dispatch is decided from the request shape
	}
	// Gemini responses have no top-level "object" discriminator, so this matches
	// only as the request-shape's paired response; the generic fallback handles
	// anything the request extractor did not claim.
	return false
}

// generateContentRequest is the subset of a Gemini generateContent request body
// the tracer reads. The model is NOT here — it is in the URL path.
type generateContentRequest struct {
	Contents          json.RawMessage   `json:"contents"`
	SystemInstruction *geminiContent    `json:"systemInstruction"`
	GenerationConfig  *generationConfig `json:"generationConfig"`
	Tools             json.RawMessage   `json:"tools"`
}

// generationConfig is the subset of generationConfig the tracer reads.
type generationConfig struct {
	Temperature     *float64        `json:"temperature"`
	TopP            *float64        `json:"topP"`
	TopK            *float64        `json:"topK"`
	MaxOutputTokens *int            `json:"maxOutputTokens"`
	CandidateCount  *int            `json:"candidateCount"`
	StopSequences   []string        `json:"stopSequences"`
	ThinkingConfig  *thinkingConfig `json:"thinkingConfig"`
}

// thinkingConfig is the subset of thinkingConfig the tracer reads.
type thinkingConfig struct {
	IncludeThoughts bool   `json:"includeThoughts"`
	ThinkingBudget  *int   `json:"thinkingBudget"`
	ThinkingLevel   string `json:"thinkingLevel"`
}

// geminiContent mirrors a Gemini Content ({role, parts}). Used for both the
// systemInstruction and the request/response contents.
type geminiContent struct {
	Role  string       `json:"role"`
	Parts []geminiPart `json:"parts"`
}

// geminiPart is the subset of a Gemini Part the tracer reads. Text parts feed
// the visible output; functionCall parts are recorded as tool calls. Other
// non-text parts (inlineData, …) are preserved via the JSON fallback.
type geminiPart struct {
	Text         string              `json:"text"`
	Thought      bool                `json:"thought"`
	FunctionCall *geminiFunctionCall `json:"functionCall"`
}

// geminiFunctionCall mirrors a Gemini FunctionCall ({id, name, args}) — a
// model-requested tool invocation carried in a response (or request) part.
type geminiFunctionCall struct {
	ID   string         `json:"id"`
	Name string         `json:"name"`
	Args map[string]any `json:"args"`
}

func (generateContentExtractor) ExtractRequest(span *langwatch.Span, raw []byte, capture langwatch.DataCaptureMode) bool {
	var req generateContentRequest
	if err := json.Unmarshal(raw, &req); err != nil {
		return genericExtractor{}.ExtractRequest(span, raw, capture)
	}

	if cfg := req.GenerationConfig; cfg != nil {
		reqParams := langwatch.GenAIRequestParams{}
		if cfg.Temperature != nil {
			reqParams.Temperature = cfg.Temperature
		}
		if cfg.TopP != nil {
			reqParams.TopP = cfg.TopP
		}
		if cfg.TopK != nil {
			reqParams.TopK = cfg.TopK
		}
		if cfg.MaxOutputTokens != nil {
			reqParams.MaxTokens = cfg.MaxOutputTokens
		}
		if cfg.CandidateCount != nil {
			reqParams.ChoiceCount = cfg.CandidateCount
		}
		if len(cfg.StopSequences) > 0 {
			reqParams.StopSequences = cfg.StopSequences
		}
		span.SetGenAIRequestParams(reqParams)

		if cfg.ThinkingConfig != nil {
			otelhttp.SetJSONAttribute(span, "gen_ai.request.thinking_config", cfg.ThinkingConfig)
		}
	}

	if len(req.Tools) > 0 {
		otelhttp.SetJSONAttribute(span, string(langwatch.AttributeGenAIRequestTools), json.RawMessage(req.Tools))
	}

	if capture.CaptureInput() {
		// gen_ai.system_instructions is content: record it only when input
		// capture is enabled.
		if si := systemInstructionText(req.SystemInstruction); si != "" {
			span.SetGenAISystemInstructions(si)
		}
		recordRequestInput(span, req.Contents)
	}

	// Gemini does not carry a "stream" flag in the body — the streaming variant
	// is a different URL action. The base decides streaming from the response
	// Content-Type, so report false here and let the response drive it.
	return false
}

// recordRequestInput records the request contents[] as chat messages, mapping
// the Gemini "model" role to "assistant" and concatenating each content's text
// parts. Falls back to the raw JSON when the contents cannot be represented as
// chat messages.
func recordRequestInput(span *langwatch.Span, rawContents json.RawMessage) {
	if len(rawContents) == 0 {
		return
	}
	var contents []geminiContent
	if err := json.Unmarshal(rawContents, &contents); err != nil || len(contents) == 0 {
		span.SetInputJSON(json.RawMessage(rawContents))
		return
	}

	messages := make([]langwatch.ChatMessage, 0, len(contents))
	for _, c := range contents {
		text := partsText(c.Parts)
		if text == "" {
			// A content with no plain text (e.g. only inlineData / functionCall):
			// fall back to recording the whole contents array as JSON so nothing
			// is silently dropped.
			span.SetInputJSON(json.RawMessage(rawContents))
			return
		}
		messages = append(messages, langwatch.ChatMessage{
			Role:    geminiRoleToChatRole(c.Role),
			Content: text,
		})
	}
	if len(messages) == 0 {
		span.SetInputJSON(json.RawMessage(rawContents))
		return
	}
	span.SetGenAIInputMessages(messages)
}

func (generateContentExtractor) ExtractNonStreaming(span *langwatch.Span, raw []byte, capture langwatch.DataCaptureMode) {
	var resp generateContentResponse
	if err := json.Unmarshal(raw, &resp); err != nil {
		genericExtractor{}.ExtractNonStreaming(span, raw, capture)
		return
	}
	recordResponse(span, &resp, capture)
}

func (generateContentExtractor) NewStreamAccumulator() otelhttp.StreamAccumulator {
	return &generateContentStreamAccumulator{}
}

// systemInstructionText concatenates the text parts of a system instruction
// Content, or returns "" when there is no plain-text instruction.
func systemInstructionText(si *geminiContent) string {
	if si == nil {
		return ""
	}
	return partsText(si.Parts)
}

// partsText concatenates the (non-thought) text parts of a Content.
func partsText(parts []geminiPart) string {
	var b strings.Builder
	for _, p := range parts {
		if p.Thought {
			continue
		}
		b.WriteString(p.Text)
	}
	return b.String()
}

// geminiRoleToChatRole maps a Gemini content role to a LangWatch chat role.
// Gemini uses "model" for the assistant turn; an empty role defaults to "user"
// (the genai server-side default).
func geminiRoleToChatRole(role string) langwatch.ChatRole {
	switch role {
	case "model":
		return langwatch.ChatRoleAssistant
	case "":
		return langwatch.ChatRoleUser
	default:
		return langwatch.ChatRole(role)
	}
}
