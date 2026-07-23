package pipeline

import (
	"bytes"
	"strconv"

	"github.com/tidwall/gjson"
	"github.com/tidwall/sjson"

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
		switch reqType {
		case domain.RequestTypeMessages:
			return injectEphemeral(body)
		case domain.RequestTypeChat:
			return injectTopLevelEphemeral(body)
		}
	}
	return body
}

// defaultCacheMinBodyBytes gates the provider-default injection to bodies
// that plausibly clear the provider's minimum cacheable prefix (~1024 tokens
// at ~4 bytes/token). Below the model's real minimum a breakpoint is silently
// ignored by the provider (no error, no write premium), so this is only a
// noise filter for trivially small payloads, not a correctness gate.
const defaultCacheMinBodyBytes = 4096

// defaultCacheAction is the per-provider seam for caching that should happen
// without any operator configuration. Providers whose prompt cache needs an
// explicit per-request marker (Anthropic's cache_control breakpoints) default
// to Force injection; providers that cache automatically server-side (OpenAI
// caches 1024+ token prefixes on its own, Gemini has implicit caching) need
// nothing. Adding a provider is one more case returning its action.
func defaultCacheAction(resolved *domain.ResolvedModel) (domain.CacheAction, bool) {
	if resolved == nil {
		return "", false
	}
	switch resolved.ProviderID {
	case domain.ProviderAnthropic:
		return domain.CacheActionForce, true
	default:
		return "", false
	}
}

// applyDefaultCacheControl applies the provider-default cache action without
// overriding client intent, skipping bodies too small to plausibly clear the
// provider's minimum cacheable prefix. The second return reports whether the
// body was modified.
//
// What counts as client intent is dialect-specific. On the native Messages
// dialect every cache_control spelling reaches the provider verbatim, so any
// marker anywhere means the client manages its own breakpoints. On the
// OpenAI chat dialect only a TOP-LEVEL cache_control survives the Anthropic
// translation (it maps onto the Messages API's request-level auto-cache
// field); message-level markers that OpenAI-dialect SDKs attach (opencode
// stamps them on the system and last user message) are silently dropped in
// translation — backing off on those would leave the request permanently
// uncached, so they do not disable the default.
func applyDefaultCacheControl(body []byte, action domain.CacheAction, reqType domain.RequestType) ([]byte, bool) {
	if action != domain.CacheActionForce {
		return body, false
	}
	if len(body) < defaultCacheMinBodyBytes {
		return body, false
	}
	switch reqType {
	case domain.RequestTypeChat:
		if gjson.GetBytes(body, "cache_control").Exists() {
			return body, false
		}
		return applyCacheControl(body, action, reqType), true
	case domain.RequestTypeMessages:
		if bytes.Contains(body, []byte(`"cache_control"`)) {
			return body, false
		}
		return applyCacheControl(body, action, reqType), true
	default:
		return body, false
	}
}

// injectTopLevelEphemeral sets the request-level cache_control field on an
// OpenAI-dialect chat body. Bifrost parses it into ChatParameters.CacheControl
// and Anthropic-family providers receive it as the Messages API's top-level
// cache_control, which auto-places a breakpoint on the last cacheable block —
// so tools, system, and the conversation so far are all reused turn over
// turn. Non-Anthropic providers ignore the field.
func injectTopLevelEphemeral(body []byte) []byte {
	body, _ = sjson.SetRawBytes(body, "cache_control", []byte(`{"type":"ephemeral"}`))
	return body
}

// stripCacheControl removes all "cache_control" keys from a JSON body using
// sjson surgical deletion — no full unmarshal/marshal cycle.
func stripCacheControl(body []byte) []byte {
	if !bytes.Contains(body, []byte(`"cache_control"`)) {
		return body
	}

	// Collect paths to delete. We delete object keys (not array elements),
	// so array indexes remain stable across deletions.
	var paths []string

	gjson.GetBytes(body, "system").ForEach(func(k, v gjson.Result) bool {
		if v.Get("cache_control").Exists() {
			paths = append(paths, "system."+k.String()+".cache_control")
		}
		return true
	})

	gjson.GetBytes(body, "messages").ForEach(func(k, v gjson.Result) bool {
		if v.Get("cache_control").Exists() {
			paths = append(paths, "messages."+k.String()+".cache_control")
		}
		v.Get("content").ForEach(func(j, c gjson.Result) bool {
			if c.Get("cache_control").Exists() {
				paths = append(paths, "messages."+k.String()+".content."+j.String()+".cache_control")
			}
			return true
		})
		return true
	})

	for _, p := range paths {
		body, _ = sjson.DeleteBytes(body, p)
	}
	return body
}

// injectEphemeral adds cache_control: {type: "ephemeral"} to the last system
// block and last content block of the last message (Anthropic Messages format).
// Uses sjson surgical set — no full unmarshal/marshal cycle.
func injectEphemeral(body []byte) []byte {
	const ephemeral = `{"type":"ephemeral"}`

	if sysLen := gjson.GetBytes(body, "system.#").Int(); sysLen > 0 {
		path := "system." + strconv.FormatInt(sysLen-1, 10) + ".cache_control"
		body, _ = sjson.SetRawBytes(body, path, []byte(ephemeral))
	}

	msgsLen := gjson.GetBytes(body, "messages.#").Int()
	if msgsLen > 0 {
		lastMsg := strconv.FormatInt(msgsLen-1, 10)
		if contentLen := gjson.GetBytes(body, "messages."+lastMsg+".content.#").Int(); contentLen > 0 {
			path := "messages." + lastMsg + ".content." + strconv.FormatInt(contentLen-1, 10) + ".cache_control"
			body, _ = sjson.SetRawBytes(body, path, []byte(ephemeral))
		}
	}

	return body
}
