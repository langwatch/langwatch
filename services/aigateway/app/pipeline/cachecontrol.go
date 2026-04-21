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
		if reqType == domain.RequestTypeMessages {
			return injectEphemeral(body)
		}
	}
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
