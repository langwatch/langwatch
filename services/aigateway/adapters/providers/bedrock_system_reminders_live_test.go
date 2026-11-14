//go:build live_bedrock_cache

// Live check that a role:"system" message at the end of a Claude Code style
// request leaves the conversation in the Bedrock prompt cache. Never runs in CI.
//
//	AWS_ACCESS_KEY_ID=... AWS_SECRET_ACCESS_KEY=... \
//	go test -tags live_bedrock_cache ./services/aigateway/adapters/providers/ \
//	  -run Live -count=1 -v
package providers

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/stretchr/testify/require"
	"go.uber.org/zap"

	"github.com/langwatch/langwatch/services/aigateway/domain"
)

func liveBedrockCacheCred(t *testing.T) (domain.Credential, string) {
	t.Helper()
	ak, sk := os.Getenv("AWS_ACCESS_KEY_ID"), os.Getenv("AWS_SECRET_ACCESS_KEY")
	if ak == "" || sk == "" {
		t.Skip("AWS creds not set")
	}
	model := os.Getenv("BEDROCK_CACHE_MODEL")
	if model == "" {
		model = "eu.anthropic.claude-haiku-4-5-20251001-v1:0"
	}
	region := os.Getenv("AWS_REGION_NAME")
	if region == "" {
		region = "eu-central-1"
	}
	return domain.Credential{
		ID: "live-bedrock-cache", ProviderID: domain.ProviderBedrock, APIKey: ak,
		Extra: map[string]string{"access_key": ak, "secret_key": sk, "region": region},
	}, model
}

func TestBedrockSystemReminderLive_HistoryStaysCached(t *testing.T) {
	cred, model := liveBedrockCacheCred(t)
	router, err := NewBifrostRouter(context.Background(), BifrostOptions{Logger: zap.NewNop(), InitialPoolSize: 10})
	require.NoError(t, err)
	defer router.Close()

	run := time.Now().UnixNano()
	history := []map[string]any{{
		"role": "user",
		"content": fmt.Sprintf("Run %d. Reply with one word. Background: %s", run,
			strings.Repeat("The quick brown fox jumps over the lazy dog near the river bank. ", 400)),
	}}
	for turn := 1; turn <= 4; turn++ {
		messages := append([]map[string]any{}, history...)
		text := fmt.Sprintf("<total_tokens>%d tokens left</total_tokens>", 100000-turn)
		messages = append(messages, map[string]any{"role": "system", "content": []map[string]any{{
			"type": "text", "text": text, "cache_control": map[string]string{"type": "ephemeral"},
		}}})
		body, err := json.Marshal(map[string]any{
			"model": model, "max_tokens": 16, "system": "You answer in one word.", "messages": messages,
			"tools": []map[string]any{{
				"name": "ping", "description": "Ping.", "input_schema": map[string]any{"type": "object"},
			}},
		})
		require.NoError(t, err)

		resp, err := router.Dispatch(context.Background(), &domain.Request{
			Type: domain.RequestTypeMessages, Model: model, Body: body,
			Resolved: &domain.ResolvedModel{ModelID: model, ProviderID: domain.ProviderBedrock},
		}, cred)
		require.NoError(t, err)
		t.Logf("turn %d status=%d input=%d cacheRead=%d cacheWrite=%d",
			turn, resp.StatusCode, resp.Usage.PromptTokens, resp.Usage.CacheReadTokens, resp.Usage.CacheCreationTokens)
		if turn > 1 {
			require.Greater(t, resp.Usage.CacheReadTokens, 3000, "the conversation should be read from the cache")
		}

		history = append(messages[:len(messages)-1],
			map[string]any{"role": "system", "content": text},
			map[string]any{"role": "assistant", "content": []map[string]any{{
				"type": "tool_use", "id": fmt.Sprintf("toolu_%d", turn), "name": "ping", "input": map[string]any{},
			}}},
			map[string]any{"role": "user", "content": []map[string]any{{
				"type": "tool_result", "tool_use_id": fmt.Sprintf("toolu_%d", turn), "content": "pong",
			}}},
		)
	}
}

// TestBedrockCacheTTLLive writes one entry per lifetime, waits past 5 minutes
// and reads both back. BEDROCK_CACHE_WAIT overrides the wait.
func TestBedrockCacheTTLLive_HourEntryOutlivesFiveMinutes(t *testing.T) {
	cred, model := liveBedrockCacheCred(t)
	router, err := NewBifrostRouter(context.Background(), BifrostOptions{Logger: zap.NewNop(), InitialPoolSize: 10})
	require.NoError(t, err)
	defer router.Close()

	wait := 6*time.Minute + 30*time.Second
	if override := os.Getenv("BEDROCK_CACHE_WAIT"); override != "" {
		wait, err = time.ParseDuration(override)
		require.NoError(t, err)
	}
	marker := func(ttl string) map[string]any {
		if ttl == "" {
			return map[string]any{"type": "ephemeral"}
		}
		return map[string]any{"type": "ephemeral", "ttl": ttl}
	}
	send := func(ttl string, run int64, stream bool) domain.Usage {
		body, err := json.Marshal(map[string]any{
			"model": model, "max_tokens": 16, "system": "You answer in one word.",
			"messages": []map[string]any{{"role": "user", "content": []map[string]any{{
				"type": "text", "cache_control": marker(ttl),
				"text": fmt.Sprintf("Run %d. Reply ok. %s", run,
					strings.Repeat("The quick brown fox jumps over the lazy dog near the river bank. ", 400)),
			}}}},
		})
		require.NoError(t, err)
		req := &domain.Request{
			Type: domain.RequestTypeMessages, Model: model, Body: body,
			Resolved: &domain.ResolvedModel{ModelID: model, ProviderID: domain.ProviderBedrock},
		}
		if !stream {
			resp, err := router.Dispatch(context.Background(), req, cred)
			require.NoError(t, err)
			return resp.Usage
		}
		iter, err := router.DispatchStream(context.Background(), req, cred)
		require.NoError(t, err)
		defer func() { _ = iter.Close() }()
		for iter.Next(context.Background()) {
			_ = iter.Chunk()
		}
		require.NoError(t, iter.Err())
		return iter.Usage()
	}

	now := time.Now().UnixNano()
	hour := send("1h", now, false)
	hourStream := send("1h", now+1, true)
	short := send("", now+2, false)
	t.Logf("write 1h: %+v", hour)
	t.Logf("write 1h stream: %+v", hourStream)
	t.Logf("write default: %+v", short)
	require.Positive(t, hour.CacheCreation1hTokens)
	require.Equal(t, hour.CacheCreationTokens, hour.CacheCreation1hTokens)
	require.Positive(t, hourStream.CacheCreation1hTokens)
	require.Zero(t, short.CacheCreation1hTokens)

	time.Sleep(wait)

	hourRead := send("1h", now, false)
	streamRead := send("1h", now+1, true)
	shortRead := send("", now+2, false)
	t.Logf("read 1h after %s: %+v", wait, hourRead)
	t.Logf("read 1h stream after %s: %+v", wait, streamRead)
	t.Logf("read default after %s: %+v", wait, shortRead)
	require.Positive(t, hourRead.CacheReadTokens)
	require.Positive(t, streamRead.CacheReadTokens)
	require.Zero(t, shortRead.CacheReadTokens)
}
