package controlplane

// The internal wire between the gateway and the control plane's session
// record: what a booking, a mint answer and a usage report carry.
//
// Binds specs/ai-gateway/realtime-sessions.feature.

import (
	"context"
	"io"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/langwatch/langwatch/pkg/herr"
	"github.com/langwatch/langwatch/services/aigateway/domain"
)

// registryCall is one request the fake control plane received.
type registryCall struct {
	method, path, body string
}

func registryClient(t *testing.T, status int, answer string) (*Client, *registryCall) {
	t.Helper()
	got := &registryCall{}
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		raw, _ := io.ReadAll(r.Body)
		got.method, got.path, got.body = r.Method, r.URL.Path, string(raw)
		w.WriteHeader(status)
		_, _ = w.Write([]byte(answer))
	}))
	t.Cleanup(srv.Close)
	return NewClient(ClientOptions{
		BaseURL:    srv.URL,
		Sign:       func(*http.Request, []byte) {},
		HTTPClient: srv.Client(),
	}), got
}

// @scenario "A single-use token session is booked before the vendor is called"
func TestReserveCarriesHowTheSessionIsMetered(t *testing.T) {
	t.Parallel()

	cp, got := registryClient(t, http.StatusOK, `{}`)
	err := cp.Reserve(context.Background(), domain.RealtimeReservation{
		SessionID: "req_1", ProjectID: "proj_1", OrganizationID: "org_1", VirtualKeyID: "vk_1",
		ModelProviderID: "mp_1", Vendor: domain.RealtimeVendorElevenLabs,
		Model: "eleven_multilingual_v2", RequestedModel: "eleven_multilingual_v2",
		Kind: domain.RealtimeKindTTSSocket, Metering: domain.RealtimeMeteringClient,
		EndUserID:           "alice",
		CredentialExpiresAt: time.UnixMilli(1790000900000),
	})
	require.NoError(t, err)

	assert.Equal(t, "/api/internal/gateway/realtime-sessions", got.path)
	assert.JSONEq(t, `{
	  "session_id":"req_1","project_id":"proj_1","organization_id":"org_1","virtual_key_id":"vk_1",
	  "model_provider_id":"mp_1","trace_id":"","requested_model":"eleven_multilingual_v2",
	  "vendor":"elevenlabs","model":"eleven_multilingual_v2",
	  "kind":"tts_socket","metering":"client","end_user_id":"alice",
	  "credential_expires_at":1790000900000}`, got.body)
}

func TestReserveLeavesUnknownMeteringOffTheWire(t *testing.T) {
	t.Parallel()

	cp, got := registryClient(t, http.StatusOK, `{}`)
	require.NoError(t, cp.Reserve(context.Background(), domain.RealtimeReservation{
		SessionID: "req_1", Vendor: domain.RealtimeVendorOpenAI, Model: "gpt-realtime-2.1",
		Kind: domain.RealtimeKindRealtime, Metering: domain.RealtimeMeteringClient,
	}))
	assert.NotContains(t, got.body, "credential_expires_at",
		"a zero would fail the control plane's positive-integer check")
	assert.NotContains(t, got.body, "transcription_model")
	assert.NotContains(t, got.body, "end_user_id")
}

// @scenario "An OpenAI mint books what metering needs"
func TestCorrelateSendsTheExpiryWithOrWithoutAConversationID(t *testing.T) {
	t.Parallel()

	cp, got := registryClient(t, http.StatusOK, `{}`)
	require.NoError(t, cp.Correlate(context.Background(), domain.RealtimeCorrelation{
		SessionID: "req_1", ProjectID: "proj_1", CredentialExpiresAt: time.Unix(1786873895, 0),
	}))
	assert.Equal(t, http.MethodPatch, got.method)
	assert.Equal(t, "/api/internal/gateway/realtime-sessions/req_1", got.path)
	assert.JSONEq(t, `{"project_id":"proj_1","credential_expires_at":1786873895000}`, got.body)

	require.NoError(t, cp.Correlate(context.Background(), domain.RealtimeCorrelation{
		SessionID: "req_1", ProjectID: "proj_1", VendorConversationID: "conv_1",
	}))
	assert.JSONEq(t, `{"project_id":"proj_1","vendor_conversation_id":"conv_1"}`, got.body)
}

// @scenario "A response.done event is recorded under its response id"
func TestReportUsageSendsAKeyedReportAndReadsTheReceipt(t *testing.T) {
	t.Parallel()

	cp, got := registryClient(t, http.StatusOK, `{"session_id":"req_1","status":"recorded",
	  "cost_nano_usd":1234,"session_cost_nano_usd":5678,
	  "budget":{"exceeded":true,"scope":"virtual_key","budget_id":"bud_1"}}`)

	receipt, err := cp.ReportUsage(context.Background(), domain.RealtimeUsageReport{
		SessionID: "req_1", ProjectID: "proj_1", VirtualKeyID: "vk_1",
		ReportKey: "resp_1", Source: domain.RealtimeMeteringClient,
		Usage: &domain.Usage{
			PromptTokens: 119, CacheReadTokens: 64, CompletionTokens: 30,
			InputAudioTokens: 13, OutputAudioTokens: 91,
		},
	})
	require.NoError(t, err)

	assert.Equal(t, "/api/internal/gateway/realtime-sessions/req_1/usage", got.path)
	assert.JSONEq(t, `{"project_id":"proj_1","virtual_key_id":"vk_1","report_key":"resp_1","source":"client",
	  "usage":{"input_tokens":55,"output_tokens":30,"cache_read_input_tokens":64,
	    "input_audio_tokens":13,"output_audio_tokens":91,"audio_ms":0,"input_chars":0}}`, got.body)

	assert.Equal(t, domain.RealtimeReportRecorded, receipt.Status)
	assert.Equal(t, int64(1234), receipt.CostNanoUSD)
	assert.Equal(t, int64(5678), receipt.SessionCostNanoUSD)
	assert.Equal(t, domain.RealtimeBudgetState{Exceeded: true, Scope: "virtual_key", BudgetID: "bud_1"}, receipt.Budget)
}

// @scenario "A transcription event is priced as transcription"
func TestReportUsageCarriesDurationCharactersAndThePricingHint(t *testing.T) {
	t.Parallel()

	cp, got := registryClient(t, http.StatusOK, `{"status":"closed","cost_nano_usd":0,"session_cost_nano_usd":0,"budget":{"exceeded":false}}`)
	_, err := cp.ReportUsage(context.Background(), domain.RealtimeUsageReport{
		SessionID: "req_1", ProjectID: "proj_1", VirtualKeyID: "vk_1",
		ReportKey: "item_1", PricedAs: domain.RealtimePricedAsTranscription,
		Model: "openai/gpt-transcribe", Final: true, DurationMS: 42000,
		Source: domain.RealtimeMeteringGateway,
		Usage:  &domain.Usage{AudioSeconds: 3.2, InputChars: 123},
	})
	require.NoError(t, err)
	assert.JSONEq(t, `{"project_id":"proj_1","virtual_key_id":"vk_1","report_key":"item_1",
	  "priced_as":"transcription","model":"openai/gpt-transcribe","final":true,"duration_ms":42000,"source":"gateway",
	  "usage":{"input_tokens":0,"output_tokens":0,"cache_read_input_tokens":0,
	    "input_audio_tokens":0,"output_audio_tokens":0,"audio_ms":3200,"input_chars":123}}`, got.body)
}

// @scenario "A close ends the session with no usage"
func TestReportUsageSendsABareCloseWithNoUsage(t *testing.T) {
	t.Parallel()

	cp, got := registryClient(t, http.StatusOK, `{"status":"already_closed","cost_nano_usd":0,"session_cost_nano_usd":77,"budget":{"exceeded":false}}`)
	receipt, err := cp.ReportUsage(context.Background(), domain.RealtimeUsageReport{
		SessionID: "req_1", ProjectID: "proj_1", VirtualKeyID: "vk_1",
		Final: true, Source: domain.RealtimeMeteringClient,
	})
	require.NoError(t, err)
	assert.JSONEq(t, `{"project_id":"proj_1","virtual_key_id":"vk_1","final":true,"source":"client"}`, got.body)
	assert.Equal(t, domain.RealtimeReportAlreadyClosed, receipt.Status)
	assert.Equal(t, int64(77), receipt.SessionCostNanoUSD)
}

// @scenario "A report against a session the key does not own answers 404"
func TestReportUsageMapsAnUnknownSessionToNotFound(t *testing.T) {
	t.Parallel()

	cp, _ := registryClient(t, http.StatusNotFound, `{"error":{"code":"realtime_session_not_found"}}`)
	_, err := cp.ReportUsage(context.Background(), domain.RealtimeUsageReport{
		SessionID: "req_other", Usage: &domain.Usage{PromptTokens: 1},
	})
	require.Error(t, err)
	assert.True(t, herr.IsCode(err, domain.ErrNotFound))
}

func TestReportUsageTreatsAControlPlaneFailureAsRegistryUnavailable(t *testing.T) {
	t.Parallel()

	cp, _ := registryClient(t, http.StatusInternalServerError, `boom`)
	_, err := cp.ReportUsage(context.Background(), domain.RealtimeUsageReport{
		SessionID: "req_1", Usage: &domain.Usage{PromptTokens: 1},
	})
	require.Error(t, err)
	assert.True(t, herr.IsCode(err, domain.ErrRealtimeRegistryUnavailable))
}

func TestReportUsageReadsAnAnswerWithNoFiguresAsRecorded(t *testing.T) {
	t.Parallel()

	for name, answer := range map[string]string{
		"session state only": `{"session_id":"req_1","status":"CLOSED"}`,
		"not json":           `ok`,
	} {
		t.Run(name, func(t *testing.T) {
			t.Parallel()
			cp, _ := registryClient(t, http.StatusOK, answer)
			receipt, err := cp.ReportUsage(context.Background(), domain.RealtimeUsageReport{
				SessionID: "req_1", Usage: &domain.Usage{PromptTokens: 1},
			})
			require.NoError(t, err, "the report landed, so the client must not retry it")
			assert.Zero(t, receipt.CostNanoUSD)
			assert.NotEmpty(t, receipt.Status)
		})
	}
}
