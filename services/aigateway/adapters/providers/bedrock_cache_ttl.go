package providers

import (
	"fmt"
	"regexp"
	"strconv"

	bfbedrock "github.com/maximhq/bifrost/core/providers/bedrock"
	bfutils "github.com/maximhq/bifrost/core/providers/utils"
	bfschemas "github.com/maximhq/bifrost/core/schemas"
	"github.com/tidwall/gjson"
	"github.com/tidwall/sjson"
)

const hourCacheTTL = "1h"

// claudeVersionPattern captures major and one-digit minor; a date suffix such as
// claude-sonnet-4-20250514 has no minor.
var claudeVersionPattern = regexp.MustCompile(`claude-(?:opus|sonnet|haiku)-(\d+)(?:-(\d)(?:\D|$))?`)

// carryBedrockCacheTTL puts an hour-long cache_control TTL on the Converse body.
// Bifrost v1.5.17 has no ttl on BedrockCachePoint (v1.14 does), so such a request
// is converted here and sent raw; delete this on upgrade. Other requests stay on
// Bifrost's conversion.
func carryBedrockCacheTTL(bfCtx *bfschemas.BifrostContext, bfReq *bfschemas.BifrostResponsesRequest, anthropicBody []byte) error {
	if bfReq.Provider != bfschemas.Bedrock || !bedrockModelTakesHourCache(bfReq.Model) {
		return nil
	}
	hourMarkers := countHourCacheMarkers(anthropicBody)
	if hourMarkers == 0 {
		return nil
	}
	converse, err := bfbedrock.ToBedrockResponsesRequest(bfCtx, bfReq)
	if err != nil {
		return fmt.Errorf("convert request for bedrock: %w", err)
	}
	body, err := bfutils.MarshalSorted(converse)
	if err != nil {
		return fmt.Errorf("encode bedrock request: %w", err)
	}
	if body, err = setHourCachePoints(body, hourMarkers); err != nil {
		return fmt.Errorf("set bedrock cache ttl: %w", err)
	}
	bfReq.RawRequestBody = body
	bfCtx.SetValue(bfschemas.BifrostContextKeyUseRawRequestBody, true)
	return nil
}

// bedrockModelTakesHourCache reports whether Bedrock accepts an hour-long TTL on
// a model: Claude Opus, Sonnet and Haiku 4.5 and later. A model it refuses would
// fail the request with a 400, so any other id keeps the default lifetime.
func bedrockModelTakesHourCache(model string) bool {
	match := claudeVersionPattern.FindStringSubmatch(model)
	if match == nil {
		return false
	}
	major, err := strconv.Atoi(match[1])
	if err != nil {
		return false
	}
	minor, _ := strconv.Atoi(match[2])
	return major > 4 || (major == 4 && minor >= 5)
}

// countHourCacheMarkers counts cache_control blocks that ask for an hour.
func countHourCacheMarkers(body []byte) int {
	count := 0
	countIn := func(items gjson.Result) {
		items.ForEach(func(_, item gjson.Result) bool {
			if item.Get("cache_control.ttl").String() == hourCacheTTL {
				count++
			}
			return true
		})
	}
	root := gjson.ParseBytes(body)
	countIn(root.Get("tools"))
	countIn(root.Get("system"))
	root.Get("messages").ForEach(func(_, msg gjson.Result) bool {
		countIn(msg.Get("content"))
		return true
	})
	return count
}

// setHourCachePoints marks the first count cache points, in prefix order, as
// lasting an hour. The API requires longer TTLs ahead of shorter ones, so the
// count alone says which points they are.
func setHourCachePoints(body []byte, count int) ([]byte, error) {
	var paths []string
	collect := func(items gjson.Result, prefix string) {
		items.ForEach(func(key, item gjson.Result) bool {
			if item.Get("cachePoint").Exists() {
				paths = append(paths, prefix+key.String()+".cachePoint.ttl")
			}
			return true
		})
	}
	root := gjson.ParseBytes(body)
	collect(root.Get("toolConfig.tools"), "toolConfig.tools.")
	collect(root.Get("system"), "system.")
	root.Get("messages").ForEach(func(index, msg gjson.Result) bool {
		collect(msg.Get("content"), "messages."+strconv.FormatInt(index.Int(), 10)+".content.")
		return true
	})

	var err error
	for i := 0; i < count && i < len(paths); i++ {
		if body, err = sjson.SetBytes(body, paths[i], hourCacheTTL); err != nil {
			return nil, err
		}
	}
	return body, nil
}
