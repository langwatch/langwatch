package llmsim

import (
	"errors"
	"strings"
	"testing"

	"github.com/aws/aws-sdk-go-v2/aws"
	"github.com/aws/aws-sdk-go-v2/credentials"
	"github.com/aws/aws-sdk-go-v2/service/bedrockruntime"
	"github.com/aws/aws-sdk-go-v2/service/bedrockruntime/document"
	"github.com/aws/aws-sdk-go-v2/service/bedrockruntime/types"
)

// bedrockClient is the real AWS SDK pointed at llmsim, signing with throwaway keys.
func bedrockClient(t *testing.T) *bedrockruntime.Client {
	t.Helper()
	srv := newTestServer(t)
	return bedrockruntime.New(bedrockruntime.Options{
		Region:       "us-east-1",
		BaseEndpoint: aws.String(srv.URL),
		Credentials:  credentials.NewStaticCredentialsProvider("AKIDLLMSIM", "not-a-secret", ""),
	})
}

func converseInput(model string) *bedrockruntime.ConverseInput {
	return &bedrockruntime.ConverseInput{
		ModelId: aws.String(model),
		System:  []types.SystemContentBlock{&types.SystemContentBlockMemberText{Value: "be brief"}},
		Messages: []types.Message{{
			Role:    types.ConversationRoleUser,
			Content: []types.ContentBlock{&types.ContentBlockMemberText{Value: "hello there"}},
		}},
	}
}

func replyText(blocks []types.ContentBlock) string {
	var out strings.Builder
	for _, b := range blocks {
		if text, ok := b.(*types.ContentBlockMemberText); ok {
			out.WriteString(text.Value)
		}
	}
	return out.String()
}

// @scenario "Bedrock Converse and ConverseStream are answered for the AWS SDK"
func TestBedrockConverseThroughTheAWSSDK(t *testing.T) {
	client := bedrockClient(t)
	model := "anthropic.claude-3-5-sonnet-20240620-v1:0"
	out, err := client.Converse(t.Context(), converseInput(model))
	if err != nil {
		t.Fatal(err)
	}
	msg, ok := out.Output.(*types.ConverseOutputMemberMessage)
	if !ok || msg.Value.Role != types.ConversationRoleAssistant || replyText(msg.Value.Content) == "" {
		t.Fatalf("unexpected output %#v", out.Output)
	}
	if out.StopReason != types.StopReasonEndTurn || aws.ToInt32(out.Usage.InputTokens) == 0 {
		t.Fatalf("stop %q usage %#v", out.StopReason, out.Usage)
	}

	stream, err := client.ConverseStream(t.Context(), &bedrockruntime.ConverseStreamInput{
		ModelId: aws.String(model), System: converseInput(model).System, Messages: converseInput(model).Messages,
	})
	if err != nil {
		t.Fatal(err)
	}
	events := stream.GetStream()
	defer func() { _ = events.Close() }()
	var joined strings.Builder
	var stop types.StopReason
	var usage *types.TokenUsage
	for ev := range events.Events() {
		switch e := ev.(type) {
		case *types.ConverseStreamOutputMemberContentBlockDelta:
			if d, ok := e.Value.Delta.(*types.ContentBlockDeltaMemberText); ok {
				joined.WriteString(d.Value)
			}
		case *types.ConverseStreamOutputMemberMessageStop:
			stop = e.Value.StopReason
		case *types.ConverseStreamOutputMemberMetadata:
			usage = e.Value.Usage
		}
	}
	if err := events.Err(); err != nil {
		t.Fatal(err)
	}
	if joined.String() != replyText(msg.Value.Content) || stop != types.StopReasonEndTurn || usage == nil {
		t.Fatalf("the stream should join to the answer: %q vs %q, stop %q", joined.String(), replyText(msg.Value.Content), stop)
	}
}

// @scenario "Bedrock Converse and ConverseStream are answered for the AWS SDK"
func TestBedrockForcedToolUseStreamsItsInput(t *testing.T) {
	client := bedrockClient(t)
	schema := document.NewLazyDocument(map[string]any{
		"type": "object", "properties": map[string]any{"city": map[string]any{"type": "string"}}, "required": []any{"city"},
	})
	in := converseInput("meta.llama3-70b-instruct-v1:0")
	in.ToolConfig = &types.ToolConfiguration{
		Tools:      []types.Tool{&types.ToolMemberToolSpec{Value: types.ToolSpecification{Name: aws.String("get_weather"), InputSchema: &types.ToolInputSchemaMemberJson{Value: schema}}}},
		ToolChoice: &types.ToolChoiceMemberTool{Value: types.SpecificToolChoice{Name: aws.String("get_weather")}},
	}
	out, err := client.Converse(t.Context(), in)
	if err != nil {
		t.Fatal(err)
	}
	msg := out.Output.(*types.ConverseOutputMemberMessage)
	var use *types.ToolUseBlock
	for _, b := range msg.Value.Content {
		if u, ok := b.(*types.ContentBlockMemberToolUse); ok {
			use = &u.Value
		}
	}
	if use == nil || aws.ToString(use.Name) != "get_weather" || out.StopReason != types.StopReasonToolUse {
		t.Fatalf("a forced tool should be called: %#v stop %q", msg.Value.Content, out.StopReason)
	}
	var args map[string]any
	if err := use.Input.UnmarshalSmithyDocument(&args); err != nil {
		t.Fatal(err)
	}
	if _, ok := args["city"].(string); !ok {
		t.Fatalf("the input follows the schema: %v", args)
	}
}

// @scenario "A forced error on a path-named model answers in that provider's shape"
func TestBedrockErrorsNameTheException(t *testing.T) {
	client := bedrockClient(t)
	_, err := client.Converse(t.Context(), converseInput("anthropic.claude-error-429"))
	var throttled *types.ThrottlingException
	if !errors.As(err, &throttled) {
		t.Fatalf("an error-429 model should be a ThrottlingException, got %v", err)
	}
	_, err = client.Converse(t.Context(), converseInput("anthropic.claude-error-400"))
	var invalid *types.ValidationException
	if !errors.As(err, &invalid) {
		t.Fatalf("an error-400 model should be a ValidationException, got %v", err)
	}
}
