package providers

import (
	"testing"

	"github.com/aws/aws-sdk-go-v2/aws"
	brtypes "github.com/aws/aws-sdk-go-v2/service/bedrockruntime/types"
	"github.com/bytedance/sonic"
	bfschemas "github.com/maximhq/bifrost/core/schemas"
)

// conversationShape renders a mapped Converse conversation as one string per
// message, "role:block,block", so a test can assert the turn layout at a
// glance: text blocks read "text", tool uses "use(<id>)", tool results
// "result(<id>)".
func conversationShape(t *testing.T, messages []brtypes.Message) []string {
	t.Helper()
	out := make([]string, 0, len(messages))
	for _, m := range messages {
		line := string(m.Role) + ":"
		for i, block := range m.Content {
			if i > 0 {
				line += ","
			}
			switch b := block.(type) {
			case *brtypes.ContentBlockMemberText:
				line += "text"
			case *brtypes.ContentBlockMemberToolUse:
				line += "use(" + aws.ToString(b.Value.ToolUseId) + ")"
			case *brtypes.ContentBlockMemberToolResult:
				line += "result(" + aws.ToString(b.Value.ToolUseId) + ")"
			default:
				line += "?"
			}
		}
		out = append(out, line)
	}
	return out
}

func mapMessagesJSON(t *testing.T, raw string) ([]brtypes.SystemContentBlock, []string) {
	t.Helper()
	var in []bfschemas.ChatMessage
	if err := sonic.Unmarshal([]byte(raw), &in); err != nil {
		t.Fatalf("unmarshal messages: %v", err)
	}
	system, messages, err := mapBedrockMessages(in)
	if err != nil {
		t.Fatalf("mapBedrockMessages: %v", err)
	}
	return system, conversationShape(t, messages)
}

func assertShape(t *testing.T, got, want []string) {
	t.Helper()
	if len(got) != len(want) {
		t.Fatalf("got %d messages %q, want %d %q", len(got), got, len(want), want)
	}
	for i := range want {
		if got[i] != want[i] {
			t.Fatalf("message %d: got %q, want %q (all: %q)", i, got[i], want[i], got)
		}
	}
}

func TestMapBedrockMessages(t *testing.T) {
	t.Run("when an assistant turn makes two parallel tool calls", func(t *testing.T) {
		/** @scenario "Results of parallel tool calls answer the assistant turn in one user message" */
		t.Run("both tool results sit in one user message", func(t *testing.T) {
			_, got := mapMessagesJSON(t, `[
				{"role":"system","content":"You help."},
				{"role":"user","content":"What is in the folder?"},
				{"role":"assistant","content":"","tool_calls":[
					{"id":"call_a1","type":"function","function":{"name":"list_dir","arguments":"{\"path\":\".\"}"}},
					{"id":"call_b2","type":"function","function":{"name":"list_dir","arguments":"{\"path\":\"src\"}"}}]},
				{"role":"tool","tool_call_id":"call_a1","content":"agent.py\nREADME.md"},
				{"role":"tool","tool_call_id":"call_b2","content":"not found"}
			]`)
			assertShape(t, got, []string{
				"user:text",
				"assistant:use(call_a1),use(call_b2)",
				"user:result(call_a1),result(call_b2)",
			})
		})
	})

	t.Run("when user text follows the tool results", func(t *testing.T) {
		/** @scenario "User text right after tool results joins their user message" */
		t.Run("the text joins the tool results' user message", func(t *testing.T) {
			_, got := mapMessagesJSON(t, `[
				{"role":"user","content":"Look around."},
				{"role":"assistant","content":null,"tool_calls":[
					{"id":"call_1","type":"function","function":{"name":"ls","arguments":"{}"}}]},
				{"role":"tool","tool_call_id":"call_1","content":"a.py"},
				{"role":"user","content":"Also check the tests."}
			]`)
			assertShape(t, got, []string{
				"user:text",
				"assistant:use(call_1)",
				"user:result(call_1),text",
			})
		})
	})

	t.Run("when two user messages arrive in a row", func(t *testing.T) {
		/** @scenario "Consecutive same-role messages merge into one Converse message" */
		t.Run("they merge into one user message", func(t *testing.T) {
			_, got := mapMessagesJSON(t, `[
				{"role":"user","content":"First."},
				{"role":"user","content":"Second."},
				{"role":"assistant","content":"Ok."},
				{"role":"assistant","content":"Anything else?"}
			]`)
			assertShape(t, got, []string{"user:text,text", "assistant:text,text"})
		})
	})

	t.Run("when an assistant message has text and tool calls", func(t *testing.T) {
		/** @scenario "Assistant text comes before its tool uses" */
		t.Run("the text block comes before the tool uses", func(t *testing.T) {
			_, got := mapMessagesJSON(t, `[
				{"role":"user","content":"Go."},
				{"role":"assistant","content":"Checking both.","tool_calls":[
					{"id":"c1","type":"function","function":{"name":"ls","arguments":"{}"}},
					{"id":"c2","type":"function","function":{"name":"ls","arguments":"{}"}}]},
				{"role":"tool","tool_call_id":"c1","content":"x"},
				{"role":"tool","tool_call_id":"c2","content":"y"}
			]`)
			assertShape(t, got, []string{
				"user:text",
				"assistant:text,use(c1),use(c2)",
				"user:result(c1),result(c2)",
			})
		})
	})

	t.Run("when an assistant message has no content and no tool calls", func(t *testing.T) {
		/** @scenario "An empty assistant message does not leave two user messages adjacent" */
		t.Run("it is dropped and the user messages around it merge", func(t *testing.T) {
			_, got := mapMessagesJSON(t, `[
				{"role":"user","content":"Hi."},
				{"role":"assistant","content":""},
				{"role":"user","content":"Hello?"}
			]`)
			assertShape(t, got, []string{"user:text,text"})
		})
	})

	t.Run("when a system message sits in the middle of the conversation", func(t *testing.T) {
		/** @scenario "A system message mid-conversation joins the system prompt" */
		t.Run("it moves to the system prompt and the user messages around it merge", func(t *testing.T) {
			system, got := mapMessagesJSON(t, `[
				{"role":"system","content":"Be brief."},
				{"role":"user","content":"Hi."},
				{"role":"system","content":"The folder is now connected."},
				{"role":"user","content":"Go on."}
			]`)
			if len(system) != 2 {
				t.Fatalf("want both system texts in the system prompt, got %d", len(system))
			}
			assertShape(t, got, []string{"user:text,text"})
		})
	})
	t.Run("when a tool returns no output", func(t *testing.T) {
		/** @scenario "A tool result with no output still carries a content block" */
		t.Run("the tool result carries one empty text block", func(t *testing.T) {
			var in []bfschemas.ChatMessage
			if err := sonic.Unmarshal([]byte(`[
				{"role":"user","content":"Run it."},
				{"role":"assistant","content":null,"tool_calls":[
					{"id":"call_1","type":"function","function":{"name":"run","arguments":"{}"}}]},
				{"role":"tool","tool_call_id":"call_1","content":""}
			]`), &in); err != nil {
				t.Fatal(err)
			}
			_, messages, err := mapBedrockMessages(in)
			if err != nil {
				t.Fatal(err)
			}
			result, ok := messages[2].Content[0].(*brtypes.ContentBlockMemberToolResult)
			if !ok {
				t.Fatalf("want a tool result, got %T", messages[2].Content[0])
			}
			if len(result.Value.Content) != 1 {
				t.Fatalf("Converse requires the toolResult content field; got %d blocks", len(result.Value.Content))
			}
		})
	})
}
