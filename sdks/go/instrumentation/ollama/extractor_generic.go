package ollama

import (
	"encoding/json"
	"strings"

	langwatch "github.com/langwatch/langwatch/sdks/go"
	"github.com/langwatch/langwatch/sdks/go/instrumentation/otelhttp"
)

// genericExtractor is the terminal fallback in the registry. It serves two
// roles:
//
//  1. As the request fallback for any unrecognised /api/* endpoint, recording
//     what it can from the JSON body so the span is still useful.
//  2. As the NON-STREAMING response dispatcher for the whole package. Ollama
//     responses carry no top-level "object" discriminator, so the base's
//     shape-based response matcher can never pick chat/generate/embeddings by
//     field; instead every non-streaming response lands here and is routed to
//     the right typed extractor by sniffing its body fields (message → chat,
//     response → generate, embeddings/embedding → embeddings).
//
// Its match methods always return true.
type genericExtractor struct{}

func (genericExtractor) Name() string { return "ollama" }

func (genericExtractor) MatchesRequest(otelhttp.JSONObject, string) bool { return true }

func (genericExtractor) MatchesResponse(string, string) bool { return true }

func (genericExtractor) ExtractRequest(span *langwatch.Span, raw []byte, capture langwatch.DataCaptureMode) bool {
	body, ok := otelhttp.ParseBody(raw)
	if !ok {
		return false
	}

	if model, ok := otelhttp.GetString(body, "model"); ok {
		span.SetRequestModel(model)
		span.SetName("ollama." + model)
	}

	// A malformed option is skipped; the rest still decode.
	var req struct {
		Options *optionsParams `json:"options"`
	}
	_ = json.Unmarshal(raw, &req)
	if req.Options != nil {
		span.SetGenAIRequestParams(req.Options.toGenAIRequestParams())
	}

	if capture.CaptureInput() {
		span.SetInputJSON(body)
	}

	return streamRequestedFromBody(body)
}

// ExtractNonStreaming routes a non-streaming Ollama response to the typed
// extractor matching its body shape, falling back to a permissive JSON dump.
func (genericExtractor) ExtractNonStreaming(span *langwatch.Span, raw []byte, capture langwatch.DataCaptureMode) {
	body, ok := otelhttp.ParseBody(raw)
	if !ok {
		return
	}

	switch {
	case otelhttp.HasKey(body, "message"):
		chatExtractor{}.ExtractNonStreaming(span, raw, capture)
	case otelhttp.HasKey(body, "response"):
		generateExtractor{}.ExtractNonStreaming(span, raw, capture)
	case otelhttp.HasKey(body, "embeddings") || otelhttp.HasKey(body, "embedding"):
		embeddingsExtractor{}.ExtractNonStreaming(span, raw, capture)
	default:
		genericRecordResponse(span, body, raw, capture)
	}
}

func (genericExtractor) NewStreamAccumulator() otelhttp.StreamAccumulator {
	return &genericStreamAccumulator{}
}

// genericRecordResponse records what it can from an unrecognised Ollama response
// body: the model, the done reason, any token counts, and the raw body as JSON
// output (gated by capture).
func genericRecordResponse(span *langwatch.Span, body otelhttp.JSONObject, raw []byte, capture langwatch.DataCaptureMode) {
	if model, ok := otelhttp.GetString(body, "model"); ok {
		span.SetResponseModel(model)
	}
	if reason, ok := otelhttp.GetString(body, "done_reason"); ok && reason != "" {
		span.SetGenAIResponseFinishReasons(reason)
	}
	recordUsage(span, metricsFrom(raw))

	if capture.CaptureOutput() {
		span.SetOutputJSON(body)
	}
}

// genericStreamAccumulator reconstructs an unrecognised Ollama NDJSON stream by
// best-effort probing of each line. It concatenates response / message.content
// text and reads the token counts + done_reason from the final line, so an
// endpoint no typed extractor claimed still produces a useful span.
type genericStreamAccumulator struct {
	model        string
	doneReason   string
	output       strings.Builder
	metrics      metricsPayload
	sawAnyOutput bool
}

func (a *genericStreamAccumulator) IsTerminal(string) bool { return false }

func (a *genericStreamAccumulator) Consume(line string) {
	event, ok := otelhttp.ParseBody([]byte(line))
	if !ok {
		return
	}

	if model, ok := otelhttp.GetString(event, "model"); ok && a.model == "" {
		a.model = model
	}
	if reason, ok := otelhttp.GetString(event, "done_reason"); ok && reason != "" {
		a.doneReason = reason
	}
	if response, ok := otelhttp.GetString(event, "response"); ok && response != "" {
		a.output.WriteString(response)
		a.sawAnyOutput = true
	}
	if message, ok := event["message"].(otelhttp.JSONObject); ok {
		if content, ok := otelhttp.GetString(message, "content"); ok && content != "" {
			a.output.WriteString(content)
			a.sawAnyOutput = true
		}
	}
	a.metrics.merge(metricsFrom([]byte(line)))
}

func (a *genericStreamAccumulator) Finish(span *langwatch.Span, capture langwatch.DataCaptureMode) {
	if a.model != "" {
		span.SetResponseModel(a.model)
	}
	if a.doneReason != "" {
		span.SetGenAIResponseFinishReasons(a.doneReason)
	}
	recordUsage(span, a.metrics)

	if capture.CaptureOutput() && a.sawAnyOutput {
		span.SetGenAIOutputMessages([]langwatch.ChatMessage{langwatch.TextMessage(langwatch.ChatRoleAssistant, a.output.String())})
	}
}

// streamRequestedFromBody reads the stream flag from an untyped request body,
// defaulting to true (Ollama streams by default) when absent.
func streamRequestedFromBody(body otelhttp.JSONObject) bool {
	if v, ok := otelhttp.GetBool(body, "stream"); ok {
		return v
	}
	return true
}

// metricsFrom decodes Ollama's token and duration fields from a body. A
// malformed field is skipped and the rest still decode.
func metricsFrom(raw []byte) metricsPayload {
	var m metricsPayload
	_ = json.Unmarshal(raw, &m)
	return m
}
