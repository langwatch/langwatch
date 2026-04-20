// Package cachecontrol handles cache_control injection and stripping
// for Anthropic-style request bodies.
package cachecontrol

import (
	"encoding/json"
	"strings"

	"github.com/langwatch/langwatch/services/aigateway/domain"
)

// Apply modifies the request body according to the cache action.
func Apply(body []byte, action domain.CacheAction, reqType domain.RequestType) []byte {
	switch action {
	case domain.CacheActionDisable:
		return Strip(body)
	case domain.CacheActionForce:
		if reqType == domain.RequestTypeMessages {
			return InjectEphemeral(body)
		}
	}
	return body
}

// Strip removes all "cache_control" keys from a JSON body recursively.
func Strip(body []byte) []byte {
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

// InjectEphemeral adds cache_control: {type: "ephemeral"} to the last
// system block and last content block of the last message (Anthropic format).
func InjectEphemeral(body []byte) []byte {
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
