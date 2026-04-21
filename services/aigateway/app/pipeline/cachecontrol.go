package pipeline

import (
	"encoding/json"
	"strings"

	"github.com/langwatch/langwatch/services/aigateway/domain"
)

// applyCacheControl modifies the request body according to the cache action.
func applyCacheControl(body []byte, action domain.CacheAction, reqType domain.RequestType) []byte {
	switch action {
	case domain.CacheActionRespect:
		return body
	case domain.CacheActionDisable:
		return stripCacheControl(body)
	case domain.CacheActionForce:
		if reqType == domain.RequestTypeMessages {
			return injectEphemeral(body)
		}
	}
	return body
}

// stripCacheControl removes all "cache_control" keys from a JSON body recursively.
func stripCacheControl(body []byte) []byte {
	if !strings.Contains(string(body), "cache_control") {
		return body
	}
	var obj any
	if err := json.Unmarshal(body, &obj); err != nil {
		return body
	}
	stripKeys(obj, "cache_control")
	out, err := json.Marshal(obj)
	if err != nil {
		return body
	}
	return out
}

// injectEphemeral adds cache_control: {type: "ephemeral"} to the last
// system block and last content block of the last message (Anthropic format).
func injectEphemeral(body []byte) []byte {
	var obj map[string]any
	if err := json.Unmarshal(body, &obj); err != nil {
		return body
	}

	ephemeral := map[string]string{"type": "ephemeral"}

	// system[-1]
	if sys, ok := obj["system"].([]any); ok && len(sys) > 0 {
		if last, ok := sys[len(sys)-1].(map[string]any); ok {
			last["cache_control"] = ephemeral
		}
	}

	// messages[-1].content[-1]
	if msgs, ok := obj["messages"].([]any); ok && len(msgs) > 0 {
		if lastMsg, ok := msgs[len(msgs)-1].(map[string]any); ok {
			if content, ok := lastMsg["content"].([]any); ok && len(content) > 0 {
				if lastBlock, ok := content[len(content)-1].(map[string]any); ok {
					lastBlock["cache_control"] = ephemeral
				}
			}
		}
	}

	out, err := json.Marshal(obj)
	if err != nil {
		return body
	}
	return out
}

func stripKeys(v any, key string) {
	switch val := v.(type) {
	case map[string]any:
		delete(val, key)
		for _, child := range val {
			stripKeys(child, key)
		}
	case []any:
		for _, item := range val {
			stripKeys(item, key)
		}
	}
}
