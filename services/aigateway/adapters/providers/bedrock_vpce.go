// Managed-Bedrock dispatch over a customer-owned PrivateLink VPC endpoint.
//
// Bifrost hardcodes the public bedrock-runtime.<region>.amazonaws.com host and
// signs SigV4 over it. Managed-Bedrock customers reach Bedrock through a
// customer-owned VPCE whose IAM policy only authorizes bedrock:InvokeModel when
// the request arrives via that endpoint, so the bifrost-signed call misses the
// VPCE and gets a 403. For Bedrock credentials carrying a runtime endpoint we
// dispatch through the official aws-sdk-go-v2 bedrockruntime client with
// aws.Config.BaseEndpoint set to the VPCE: the SDK signs SigV4 over that host
// and handles the eventstream for streaming. Every other Bedrock request and
// every other provider stays on bifrost.
package providers

import (
	"context"
	"errors"
	"fmt"
	"net/url"
	"strings"
	"time"

	"github.com/aws/aws-sdk-go-v2/aws"
	"github.com/aws/aws-sdk-go-v2/credentials"
	"github.com/aws/aws-sdk-go-v2/service/bedrockruntime"
	brdocument "github.com/aws/aws-sdk-go-v2/service/bedrockruntime/document"
	brtypes "github.com/aws/aws-sdk-go-v2/service/bedrockruntime/types"
	smithyhttp "github.com/aws/smithy-go/transport/http"

	"github.com/bytedance/sonic"
	bfschemas "github.com/maximhq/bifrost/core/schemas"

	"github.com/langwatch/langwatch/pkg/herr"
	"github.com/langwatch/langwatch/services/aigateway/domain"
)

// bedrockRuntimeEndpoint returns the customer's Bedrock runtime VPC endpoint
// from the credential's Extra map. Two nlpgo paths name the key differently, so
// we accept both. Returns "" when no endpoint is configured (the common
// non-managed Bedrock case, which stays on bifrost).
func bedrockRuntimeEndpoint(cred domain.Credential) string {
	return credExtra(cred, "bedrock_runtime_endpoint", "aws_bedrock_runtime_endpoint")
}

// credExtra reads the first non-empty value among the given Extra keys.
// The two nlpgo entry points name AWS credential fields differently: the
// dispatcheradapter (Studio / workflows) translates litellm_params to the
// Bifrost-canonical access_key / secret_key / session_token / region, while
// the gatewayproxy (/go/proxy) keeps the litellm aws_* names. Accepting both
// keeps the VPCE dispatch correct regardless of which route built the cred.
func credExtra(cred domain.Credential, keys ...string) string {
	for _, k := range keys {
		if v := cred.Extra[k]; v != "" {
			return v
		}
	}
	return ""
}

// newBedrockRuntimeClient builds an aws-sdk-go-v2 bedrockruntime client pinned
// to the VPC endpoint, using the static AWS credentials carried on the
// credential's Extra map.
func newBedrockRuntimeClient(cred domain.Credential, endpoint string) *bedrockruntime.Client {
	region := credExtra(cred, "region", "aws_region_name")
	if region == "" {
		region = "us-east-1"
	}
	cfg := aws.Config{
		Region: region,
		Credentials: credentials.NewStaticCredentialsProvider(
			credExtra(cred, "access_key", "aws_access_key_id"),
			credExtra(cred, "secret_key", "aws_secret_access_key"),
			credExtra(cred, "session_token", "aws_session_token"),
		),
		// endpoint already includes scheme, e.g. "https://vpce-....amazonaws.com".
		BaseEndpoint: aws.String(endpoint),
	}
	return bedrockruntime.NewFromConfig(cfg)
}

// validateBedrockEndpoint guards the customer-supplied runtime endpoint before
// it is used as the SDK BaseEndpoint. The endpoint reaches the gateway from
// credential Extra (set per-request by the nlpgo adapters), so an unconstrained
// value would let a request steer the gateway's outbound call at an arbitrary
// host — an SSRF surface. Public Bedrock (bedrock-runtime.<region>.amazonaws.com)
// and PrivateLink VPC endpoints (vpce-*.vpce.amazonaws.com) both live under the
// AWS-controlled amazonaws.com domain, so the endpoint must be an http/https URL
// whose host is within .amazonaws.com; anything else is rejected (fail closed).
func validateBedrockEndpoint(endpoint string) error {
	u, err := url.Parse(endpoint)
	if err != nil {
		return fmt.Errorf("bedrock vpce: invalid runtime endpoint %q: %w", endpoint, err)
	}
	if u.Scheme != "http" && u.Scheme != "https" {
		return fmt.Errorf("bedrock vpce: runtime endpoint scheme must be http or https, got %q", u.Scheme)
	}
	host := strings.ToLower(u.Hostname())
	if host == "" {
		return fmt.Errorf("bedrock vpce: runtime endpoint %q has no host", endpoint)
	}
	if !strings.HasSuffix(host, ".amazonaws.com") {
		return fmt.Errorf("bedrock vpce: runtime endpoint host %q is not an amazonaws.com endpoint", host)
	}
	// Plaintext http is only acceptable for PrivateLink VPC endpoints
	// (vpce-*.vpce.amazonaws.com), which front the customer's NLB without TLS.
	// Public Bedrock (bedrock-runtime.<region>.amazonaws.com) must stay https
	// so prompts/responses are never downgraded onto plaintext transport.
	if u.Scheme == "http" && !strings.HasSuffix(host, ".vpce.amazonaws.com") {
		return fmt.Errorf("bedrock vpce: plaintext http is only allowed for PrivateLink (.vpce.amazonaws.com) hosts, got %q", host)
	}
	return nil
}

// bedrockVPCEEndpoint is the admission gate for the managed-Bedrock VPCE path.
// It returns the runtime endpoint to dispatch through when the credential is a
// Bedrock credential carrying a valid endpoint, "" to stay on the bifrost path,
// or an error when an endpoint is present but fails validation (fail closed, so
// an untrusted endpoint is rejected rather than silently routed elsewhere).
func bedrockVPCEEndpoint(cred domain.Credential) (string, error) {
	if cred.ProviderID != domain.ProviderBedrock {
		return "", nil
	}
	endpoint := bedrockRuntimeEndpoint(cred)
	if endpoint == "" {
		return "", nil
	}
	if err := validateBedrockEndpoint(endpoint); err != nil {
		return "", err
	}
	return endpoint, nil
}

// bedrockModelID resolves the public model id to the provider-specific
// deployment / inference-profile id when the credential carries a mapping.
func bedrockModelID(model string, cred domain.Credential) string {
	if v := cred.DeploymentMap[model]; v != "" {
		return v
	}
	return model
}

// dispatchBedrockVPCE handles a non-streaming chat request through the official
// Bedrock Converse API over the customer's VPC endpoint.
func (r *BifrostRouter) dispatchBedrockVPCE(
	ctx context.Context,
	req *domain.Request,
	provider bfschemas.ModelProvider,
	model string,
	cred domain.Credential,
	endpoint string,
) (*domain.Response, error) {
	input, err := r.buildConverseInput(ctx, req, provider, model, cred)
	if err != nil {
		return nil, err
	}

	client := newBedrockRuntimeClient(cred, endpoint)
	out, err := client.Converse(ctx, input)
	if err != nil {
		return nil, wrapBedrockError(ctx, err)
	}

	bfResp := converseOutputToBifrost(out, model)
	body, _ := sonic.Marshal(bfResp)
	return &domain.Response{
		Body:       body,
		StatusCode: 200,
		Usage:      bedrockUsage(out.Usage),
	}, nil
}

// dispatchBedrockVPCEStream handles a streaming chat request through the
// official Bedrock ConverseStream API over the customer's VPC endpoint. Each
// SDK event is mapped to an OpenAI-shaped chat.completion.chunk so the SSE the
// gateway emits downstream is identical in shape to the bifrost streaming path.
func (r *BifrostRouter) dispatchBedrockVPCEStream(
	ctx context.Context,
	req *domain.Request,
	provider bfschemas.ModelProvider,
	model string,
	cred domain.Credential,
	endpoint string,
) (domain.StreamIterator, error) {
	input, err := r.buildConverseInput(ctx, req, provider, model, cred)
	if err != nil {
		return nil, err
	}

	streamInput := &bedrockruntime.ConverseStreamInput{
		ModelId:         input.ModelId,
		Messages:        input.Messages,
		System:          input.System,
		InferenceConfig: input.InferenceConfig,
		ToolConfig:      input.ToolConfig,
	}

	client := newBedrockRuntimeClient(cred, endpoint)
	out, err := client.ConverseStream(ctx, streamInput)
	if err != nil {
		return nil, wrapBedrockError(ctx, err)
	}

	return &bedrockStreamIterator{
		ctx:    ctx,
		stream: out.GetStream(),
		model:  model,
	}, nil
}

// buildConverseInput reuses the gateway's existing OpenAI->Bifrost parser and
// then maps the normalized BifrostChatRequest to a Bedrock ConverseInput.
func (r *BifrostRouter) buildConverseInput(
	ctx context.Context,
	req *domain.Request,
	provider bfschemas.ModelProvider,
	model string,
	cred domain.Credential,
) (*bedrockruntime.ConverseInput, error) {
	bfReq, _, err := buildChatRequest(ctx, req, provider, model)
	if err != nil {
		return nil, err
	}

	system, messages, err := mapBedrockMessages(bfReq.Input)
	if err != nil {
		return nil, err
	}

	input := &bedrockruntime.ConverseInput{
		ModelId:         aws.String(bedrockModelID(model, cred)),
		Messages:        messages,
		System:          system,
		InferenceConfig: mapBedrockInferenceConfig(bfReq.Params),
		ToolConfig:      mapBedrockToolConfig(bfReq.Params),
	}
	return input, nil
}

// mapBedrockMessages splits the neutral Bifrost message list into Bedrock's
// system prompt blocks and conversation messages. Bedrock Converse only allows
// user/assistant roles, so a tool-role message is mapped to a user message
// carrying a ToolResultBlock.
func mapBedrockMessages(in []bfschemas.ChatMessage) ([]brtypes.SystemContentBlock, []brtypes.Message, error) {
	var system []brtypes.SystemContentBlock
	var messages []brtypes.Message

	for _, m := range in {
		switch m.Role {
		case bfschemas.ChatMessageRoleSystem, bfschemas.ChatMessageRoleDeveloper:
			for _, text := range messageTexts(m) {
				system = append(system, &brtypes.SystemContentBlockMemberText{Value: text})
			}

		case bfschemas.ChatMessageRoleTool:
			blocks := toolResultBlocks(m)
			if len(blocks) == 0 {
				continue
			}
			messages = append(messages, brtypes.Message{
				Role:    brtypes.ConversationRoleUser,
				Content: blocks,
			})

		case bfschemas.ChatMessageRoleUser:
			content := userContentBlocks(m)
			if len(content) == 0 {
				continue
			}
			messages = append(messages, brtypes.Message{
				Role:    brtypes.ConversationRoleUser,
				Content: content,
			})

		case bfschemas.ChatMessageRoleAssistant:
			content := assistantContentBlocks(m)
			if len(content) == 0 {
				continue
			}
			messages = append(messages, brtypes.Message{
				Role:    brtypes.ConversationRoleAssistant,
				Content: content,
			})

		default:
			return nil, nil, fmt.Errorf("unsupported chat message role %q", m.Role)
		}
	}

	return system, messages, nil
}

// messageTexts returns the plain-text fragments of a message content
// (the ContentStr scalar or the text of each text content block).
func messageTexts(m bfschemas.ChatMessage) []string {
	if m.Content == nil {
		return nil
	}
	if m.Content.ContentStr != nil {
		s := *m.Content.ContentStr
		if s == "" {
			return nil
		}
		return []string{s}
	}
	var out []string
	for _, b := range m.Content.ContentBlocks {
		if b.Type == bfschemas.ChatContentBlockTypeText && b.Text != nil && *b.Text != "" {
			out = append(out, *b.Text)
		}
	}
	return out
}

// userContentBlocks maps a user message's text into Bedrock content blocks.
func userContentBlocks(m bfschemas.ChatMessage) []brtypes.ContentBlock {
	var blocks []brtypes.ContentBlock
	for _, text := range messageTexts(m) {
		blocks = append(blocks, &brtypes.ContentBlockMemberText{Value: text})
	}
	return blocks
}

// assistantContentBlocks maps an assistant message's text + tool calls into
// Bedrock content blocks. Tool call arguments (a JSON string) are parsed into a
// document so Bedrock receives structured tool input.
func assistantContentBlocks(m bfschemas.ChatMessage) []brtypes.ContentBlock {
	var blocks []brtypes.ContentBlock
	for _, text := range messageTexts(m) {
		blocks = append(blocks, &brtypes.ContentBlockMemberText{Value: text})
	}
	if m.ChatAssistantMessage == nil {
		return blocks
	}
	for _, tc := range m.ToolCalls {
		use := brtypes.ToolUseBlock{
			Input: brdocument.NewLazyDocument(parseToolArguments(tc.Function.Arguments)),
		}
		if tc.ID != nil {
			use.ToolUseId = tc.ID
		}
		if tc.Function.Name != nil {
			use.Name = tc.Function.Name
		}
		blocks = append(blocks, &brtypes.ContentBlockMemberToolUse{Value: use})
	}
	return blocks
}

// toolResultBlocks maps a tool-role message into a Bedrock ToolResult content
// block. The tool call id is read from the embedded ChatToolMessage and the
// result text from the message content.
func toolResultBlocks(m bfschemas.ChatMessage) []brtypes.ContentBlock {
	var toolUseID string
	if m.ChatToolMessage != nil && m.ToolCallID != nil {
		toolUseID = *m.ToolCallID
	}
	var resultContent []brtypes.ToolResultContentBlock
	for _, text := range messageTexts(m) {
		resultContent = append(resultContent, &brtypes.ToolResultContentBlockMemberText{Value: text})
	}
	if len(resultContent) == 0 && toolUseID == "" {
		return nil
	}
	return []brtypes.ContentBlock{
		&brtypes.ContentBlockMemberToolResult{
			Value: brtypes.ToolResultBlock{
				ToolUseId: aws.String(toolUseID),
				Content:   resultContent,
			},
		},
	}
}

// mapBedrockInferenceConfig maps the neutral chat params to Bedrock's
// InferenceConfiguration. Returns nil when no inference knobs are set.
func mapBedrockInferenceConfig(params *bfschemas.ChatParameters) *brtypes.InferenceConfiguration {
	if params == nil {
		return nil
	}
	cfg := &brtypes.InferenceConfiguration{}
	set := false
	if params.MaxCompletionTokens != nil {
		cfg.MaxTokens = int32Ptr(*params.MaxCompletionTokens)
		set = true
	}
	if params.Temperature != nil {
		cfg.Temperature = float32Ptr(*params.Temperature)
		set = true
	}
	if params.TopP != nil {
		cfg.TopP = float32Ptr(*params.TopP)
		set = true
	}
	if len(params.Stop) > 0 {
		cfg.StopSequences = params.Stop
		set = true
	}
	if !set {
		return nil
	}
	return cfg
}

// mapBedrockToolConfig maps the neutral tool list to Bedrock's
// ToolConfiguration. Returns nil when no tools are present.
func mapBedrockToolConfig(params *bfschemas.ChatParameters) *brtypes.ToolConfiguration {
	if params == nil || len(params.Tools) == 0 {
		return nil
	}
	var tools []brtypes.Tool
	for i := range params.Tools {
		t := &params.Tools[i]
		if t.Function == nil {
			continue
		}
		spec := brtypes.ToolSpecification{
			Name: aws.String(t.Function.Name),
			InputSchema: &brtypes.ToolInputSchemaMemberJson{
				Value: brdocument.NewLazyDocument(toolSchemaDocument(t.Function.Parameters)),
			},
		}
		if t.Function.Description != nil {
			spec.Description = t.Function.Description
		}
		tools = append(tools, &brtypes.ToolMemberToolSpec{Value: spec})
	}
	if len(tools) == 0 {
		return nil
	}
	return &brtypes.ToolConfiguration{Tools: tools}
}

// converseOutputToBifrost maps a Bedrock Converse response back to the
// OpenAI-shaped BifrostChatResponse the gateway emits downstream.
func converseOutputToBifrost(out *bedrockruntime.ConverseOutput, model string) *bfschemas.BifrostChatResponse {
	var text string
	var toolCalls []bfschemas.ChatAssistantMessageToolCall

	if msg, ok := out.Output.(*brtypes.ConverseOutputMemberMessage); ok {
		var idx uint16
		for _, block := range msg.Value.Content {
			switch b := block.(type) {
			case *brtypes.ContentBlockMemberText:
				text += b.Value
			case *brtypes.ContentBlockMemberToolUse:
				toolCalls = append(toolCalls, bedrockToolUseToToolCall(b.Value, idx))
				idx++
			}
		}
	}

	assistant := &bfschemas.ChatAssistantMessage{}
	if len(toolCalls) > 0 {
		assistant.ToolCalls = toolCalls
	}

	finishReason := mapStopReason(out.StopReason)
	return &bfschemas.BifrostChatResponse{
		ID:      "",
		Object:  "chat.completion",
		Model:   model,
		Created: int(time.Now().Unix()),
		Choices: []bfschemas.BifrostResponseChoice{
			{
				Index:        0,
				FinishReason: &finishReason,
				ChatNonStreamResponseChoice: &bfschemas.ChatNonStreamResponseChoice{
					Message: &bfschemas.ChatMessage{
						Role: bfschemas.ChatMessageRoleAssistant,
						Content: &bfschemas.ChatMessageContent{
							ContentStr: &text,
						},
						ChatAssistantMessage: assistant,
					},
				},
			},
		},
		Usage: bedrockLLMUsage(out.Usage),
	}
}

// bedrockToolUseToToolCall maps a Bedrock ToolUseBlock to an OpenAI-shaped tool
// call. The structured input document is re-serialized to a JSON arguments
// string, matching OpenAI's tool-call wire format.
func bedrockToolUseToToolCall(use brtypes.ToolUseBlock, index uint16) bfschemas.ChatAssistantMessageToolCall {
	toolType := "function"
	call := bfschemas.ChatAssistantMessageToolCall{
		Index: index,
		Type:  &toolType,
		ID:    use.ToolUseId,
		Function: bfschemas.ChatAssistantMessageToolCallFunction{
			Name:      use.Name,
			Arguments: documentToJSONString(use.Input),
		},
	}
	return call
}

// mapStopReason maps Bedrock stop reasons onto OpenAI finish reasons.
func mapStopReason(reason brtypes.StopReason) string {
	switch reason {
	case brtypes.StopReasonToolUse:
		return "tool_calls"
	case brtypes.StopReasonMaxTokens:
		return "length"
	case brtypes.StopReasonEndTurn, brtypes.StopReasonStopSequence:
		return "stop"
	default:
		return "stop"
	}
}

// bedrockUsage maps Bedrock TokenUsage to the gateway's neutral usage struct.
func bedrockUsage(usage *brtypes.TokenUsage) domain.Usage {
	if usage == nil {
		return domain.Usage{}
	}
	return domain.Usage{
		PromptTokens:     int32Value(usage.InputTokens),
		CompletionTokens: int32Value(usage.OutputTokens),
		TotalTokens:      int32Value(usage.TotalTokens),
	}
}

// bedrockLLMUsage maps Bedrock TokenUsage onto the Bifrost response usage block.
func bedrockLLMUsage(usage *brtypes.TokenUsage) *bfschemas.BifrostLLMUsage {
	if usage == nil {
		return nil
	}
	return &bfschemas.BifrostLLMUsage{
		PromptTokens:     int32Value(usage.InputTokens),
		CompletionTokens: int32Value(usage.OutputTokens),
		TotalTokens:      int32Value(usage.TotalTokens),
	}
}

// wrapBedrockError surfaces a Bedrock SDK error with the upstream HTTP status
// when available so the gateway's error envelope mirrors the provider response.
func wrapBedrockError(ctx context.Context, err error) error {
	var respErr *smithyhttp.ResponseError
	if errors.As(err, &respErr) && respErr.Response != nil {
		return herr.New(ctx, domain.ErrProviderError, herr.M{
			"status":  respErr.Response.StatusCode,
			"message": err.Error(),
		})
	}
	return herr.New(ctx, domain.ErrProviderError, herr.M{
		"message": err.Error(),
	})
}

// --- stream iterator ---

// bedrockStreamIterator pumps Bedrock ConverseStream events and exposes them as
// the gateway's OpenAI-shaped chat.completion.chunk stream. It tracks per-tool
// call index so streamed tool-use input deltas reassemble correctly downstream.
type bedrockStreamIterator struct {
	ctx     context.Context
	stream  *bedrockruntime.ConverseStreamEventStream
	model   string
	current []byte
	usage   domain.Usage
	err     error
	done    bool

	// toolIndex maps a Bedrock content-block index to the OpenAI tool-call
	// index so multi-tool streams keep stable per-call indices in the deltas.
	toolIndex map[int32]uint16
	nextTool  uint16
}

func (it *bedrockStreamIterator) Next(ctx context.Context) bool {
	if it.done {
		return false
	}
	for {
		select {
		case <-ctx.Done():
			it.err = ctx.Err()
			it.done = true
			return false
		case event, ok := <-it.stream.Events():
			if !ok {
				if err := it.stream.Err(); err != nil {
					it.err = fmt.Errorf("bedrock stream error: %w", err)
				}
				it.done = true
				return false
			}
			chunk, emit := it.mapEvent(event)
			if !emit {
				continue
			}
			it.current = chunk
			return true
		}
	}
}

// mapEvent maps a single Bedrock stream event to an OpenAI-shaped chunk. The
// second return reports whether the event produced a chunk worth emitting
// (metadata/start events that carry no delta are absorbed silently).
func (it *bedrockStreamIterator) mapEvent(event brtypes.ConverseStreamOutput) ([]byte, bool) {
	switch e := event.(type) {
	case *brtypes.ConverseStreamOutputMemberContentBlockStart:
		// Tool-use blocks announce id+name here; text content has no start
		// payload. Emit the tool-call header chunk (empty arguments).
		start := e.Value.Start
		if tu, ok := start.(*brtypes.ContentBlockStartMemberToolUse); ok {
			idx := it.assignToolIndex(e.Value.ContentBlockIndex)
			return it.chunkWithToolCall(bfschemas.ChatAssistantMessageToolCall{
				Index: idx,
				Type:  strPtr("function"),
				ID:    tu.Value.ToolUseId,
				Function: bfschemas.ChatAssistantMessageToolCallFunction{
					Name:      derefStr(tu.Value.Name),
					Arguments: "",
				},
			}), true
		}
		return nil, false

	case *brtypes.ConverseStreamOutputMemberContentBlockDelta:
		switch d := e.Value.Delta.(type) {
		case *brtypes.ContentBlockDeltaMemberText:
			return it.chunkWithText(d.Value), true
		case *brtypes.ContentBlockDeltaMemberToolUse:
			if d.Value.Input == nil {
				return nil, false
			}
			idx := it.assignToolIndex(e.Value.ContentBlockIndex)
			return it.chunkWithToolCall(bfschemas.ChatAssistantMessageToolCall{
				Index: idx,
				Type:  strPtr("function"),
				Function: bfschemas.ChatAssistantMessageToolCallFunction{
					Arguments: *d.Value.Input,
				},
			}), true
		default:
			return nil, false
		}

	case *brtypes.ConverseStreamOutputMemberMessageStop:
		finish := mapStopReason(e.Value.StopReason)
		return it.chunkWithFinish(finish), true

	case *brtypes.ConverseStreamOutputMemberMetadata:
		// Final usage rides on the metadata event; record it and emit a
		// usage-only chunk so cost enrichment downstream sees token totals.
		if e.Value.Usage != nil {
			it.usage = bedrockUsage(e.Value.Usage)
			return it.usageChunk(), true
		}
		return nil, false

	default:
		return nil, false
	}
}

// assignToolIndex returns a stable OpenAI tool-call index for a Bedrock content
// block index, allocating a new one on first sight.
func (it *bedrockStreamIterator) assignToolIndex(blockIdx *int32) uint16 {
	if it.toolIndex == nil {
		it.toolIndex = map[int32]uint16{}
	}
	key := int32Value(blockIdx)
	if v, ok := it.toolIndex[int32(key)]; ok {
		return v
	}
	v := it.nextTool
	it.toolIndex[int32(key)] = v
	it.nextTool++
	return v
}

func (it *bedrockStreamIterator) chunkWithText(text string) []byte {
	return it.marshalChunk(&bfschemas.ChatStreamResponseChoiceDelta{Content: &text}, nil, nil)
}

func (it *bedrockStreamIterator) chunkWithToolCall(call bfschemas.ChatAssistantMessageToolCall) []byte {
	return it.marshalChunk(&bfschemas.ChatStreamResponseChoiceDelta{
		ToolCalls: []bfschemas.ChatAssistantMessageToolCall{call},
	}, nil, nil)
}

func (it *bedrockStreamIterator) chunkWithFinish(finish string) []byte {
	return it.marshalChunk(&bfschemas.ChatStreamResponseChoiceDelta{}, &finish, nil)
}

func (it *bedrockStreamIterator) usageChunk() []byte {
	return it.marshalChunk(&bfschemas.ChatStreamResponseChoiceDelta{}, nil, bedrockLLMUsage(usagePtr(it.usage)))
}

// marshalChunk builds and serializes a chat.completion.chunk carrying the given
// delta + optional finish reason + optional usage, matching the bifrost
// streaming wire shape.
func (it *bedrockStreamIterator) marshalChunk(
	delta *bfschemas.ChatStreamResponseChoiceDelta,
	finish *string,
	usage *bfschemas.BifrostLLMUsage,
) []byte {
	resp := &bfschemas.BifrostChatResponse{
		Object:  "chat.completion.chunk",
		Model:   it.model,
		Created: int(time.Now().Unix()),
		Choices: []bfschemas.BifrostResponseChoice{
			{
				Index:        0,
				FinishReason: finish,
				ChatStreamResponseChoice: &bfschemas.ChatStreamResponseChoice{
					Delta: delta,
				},
			},
		},
		Usage: usage,
	}
	data, _ := sonic.Marshal(resp)
	return data
}

func (it *bedrockStreamIterator) Chunk() []byte       { return it.current }
func (it *bedrockStreamIterator) Usage() domain.Usage { return it.usage }
func (it *bedrockStreamIterator) Err() error          { return it.err }

func (it *bedrockStreamIterator) Close() error {
	if it.stream != nil {
		return it.stream.Close()
	}
	return nil
}

// --- helpers ---

// parseToolArguments parses an OpenAI-style JSON arguments string into a map for
// Bedrock's structured tool input. A non-JSON or empty string yields an empty
// object so the SDK always sends a valid document.
func parseToolArguments(arguments string) map[string]any {
	if arguments == "" {
		return map[string]any{}
	}
	var out map[string]any
	if err := sonic.Unmarshal([]byte(arguments), &out); err != nil || out == nil {
		return map[string]any{}
	}
	return out
}

// toolSchemaDocument marshals the neutral tool parameter schema into a generic
// map so it can be wrapped in a Bedrock JSON input-schema document. A nil schema
// yields a minimal object schema (Bedrock requires a top-level object).
func toolSchemaDocument(params *bfschemas.ToolFunctionParameters) map[string]any {
	if params == nil {
		return map[string]any{"type": "object"}
	}
	raw, err := sonic.Marshal(params)
	if err != nil {
		return map[string]any{"type": "object"}
	}
	var out map[string]any
	if err := sonic.Unmarshal(raw, &out); err != nil || out == nil {
		return map[string]any{"type": "object"}
	}
	return out
}

// documentToJSONString serializes a Bedrock input document into a JSON string,
// matching OpenAI's stringified tool-call arguments format.
func documentToJSONString(doc brdocument.Interface) string {
	if doc == nil {
		return "{}"
	}
	var decoded any
	if err := doc.UnmarshalSmithyDocument(&decoded); err != nil {
		return "{}"
	}
	b, err := sonic.Marshal(decoded)
	if err != nil {
		return "{}"
	}
	return string(b)
}

func int32Ptr(v int) *int32 {
	n := int32(v)
	return &n
}

func float32Ptr(v float64) *float32 {
	n := float32(v)
	return &n
}

func int32Value(p *int32) int {
	if p == nil {
		return 0
	}
	return int(*p)
}

func strPtr(s string) *string { return &s }

func derefStr(p *string) *string {
	if p == nil {
		return nil
	}
	v := *p
	return &v
}

// usagePtr packs a neutral usage struct back into the int32-pointer shape the
// Bedrock TokenUsage mapper expects, so the streaming usage chunk reuses the
// same conversion as the non-streaming path.
func usagePtr(u domain.Usage) *brtypes.TokenUsage {
	return &brtypes.TokenUsage{
		InputTokens:  int32Ptr(u.PromptTokens),
		OutputTokens: int32Ptr(u.CompletionTokens),
		TotalTokens:  int32Ptr(u.TotalTokens),
	}
}
