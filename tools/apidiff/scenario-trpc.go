package apidiff

import "strings"

const (
	trpcSuperjson = "superjson"
	trpcNone      = "none"
	trpcPrefix    = "/api/trpc/"
)

func isTRPCPath(path string) bool { return strings.HasPrefix(path, trpcPrefix) }

// wrapTRPCBody puts a scenario's neutral tRPC input in the envelope the side
// reads: main's superjson wants {json: input}, the branch's plain body none.
func wrapTRPCBody(transformer string, body any) any {
	if transformer == trpcSuperjson {
		return map[string]any{"json": body}
	}
	return body
}

// unwrapTRPCData lifts result.data.json to result.data on a superjson side, so
// one capture path (result.data.workflow.id) reads both sides' answers.
func unwrapTRPCData(transformer string, decoded any) any {
	if transformer != trpcSuperjson {
		return decoded
	}
	result, _ := decoded.(map[string]any)
	data, _ := result["result"].(map[string]any)
	inner, _ := data["data"].(map[string]any)
	if json, ok := inner["json"]; ok {
		data["data"] = json
	}
	return decoded
}
