package providers

import (
	"fmt"
	"regexp"
	"strconv"

	bfschemas "github.com/maximhq/bifrost/core/schemas"
	"github.com/tidwall/gjson"
	"github.com/tidwall/sjson"

	"github.com/langwatch/langwatch/services/aigateway/domain"
)

const hourCacheTTL = "1h"

// claudeVersionPattern captures major and one-digit minor; a date suffix such as
// claude-sonnet-4-20250514 has no minor.
var claudeVersionPattern = regexp.MustCompile(`claude-(?:opus|sonnet|haiku)-(\d+)(?:-(\d)(?:\D|$))?`)

// bedrockBodySource is what a translated Bedrock request came from: the
// client's Anthropic body and the credential whose deployment map names the
// model Bifrost dispatches.
type bedrockBodySource struct {
	anthropicBody []byte
	cred          domain.Credential
}

// prepareBedrockConverseBody converts a public-Bedrock Responses request here
// and sends it raw when Bifrost v1.5.17's own conversion would lose part of
// it: an hour-long cache_control TTL (BedrockCachePoint has no ttl until v1.14)
// or the adaptive thinking of a Claude model it does not know takes adaptive
// thinking. Other requests stay on Bifrost's conversion.
func prepareBedrockConverseBody(bfCtx *bfschemas.BifrostContext, bfReq *bfschemas.BifrostResponsesRequest, src bedrockBodySource) error {
	if bfReq.Provider != bfschemas.Bedrock {
		return nil
	}
	model := bedrockModelID(bfReq.Model, src.cred)
	hourMarkers := hourCacheMarkersFor(model, src.anthropicBody)
	if hourMarkers == 0 && !responsesThinkingIntent(bfReq, model).needsPinning() {
		return nil
	}
	converse, err := convertResponsesForBedrock(bfCtx, bfReq, model)
	if err != nil {
		return fmt.Errorf("convert request for bedrock: %w", err)
	}
	body, err := marshalConverseBody(bfCtx, converse)
	if err != nil {
		return err
	}
	if body, err = setHourCachePoints(body, hourMarkers); err != nil {
		return fmt.Errorf("set bedrock cache ttl: %w", err)
	}
	bfReq.RawRequestBody = body
	bfCtx.SetValue(bfschemas.BifrostContextKeyUseRawRequestBody, true)
	return nil
}

// hourCacheMarkersFor counts the hour-long breakpoints a Bedrock model would
// keep, 0 for a model that refuses that lifetime.
func hourCacheMarkersFor(model string, anthropicBody []byte) int {
	if !bedrockModelTakesHourCache(model) {
		return 0
	}
	return countHourCacheMarkers(anthropicBody)
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
