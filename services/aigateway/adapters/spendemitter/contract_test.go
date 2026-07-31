package spendemitter

// Golden tests for the wire contract: the exact batch shape the control
// plane's spend-command ingest receives, and the payload field names the
// spine spec fixes. A failure here means the TS ingest route and this
// emitter disagree.

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"sync"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/langwatch/langwatch/services/aigateway/adapters/controlplane"
	"github.com/langwatch/langwatch/services/aigateway/app/pipeline"
	"github.com/langwatch/langwatch/services/aigateway/domain"
)

func drainRecords(t *testing.T, s *Spool, want int) []Record {
	t.Helper()
	deadline := time.Now().Add(3 * time.Second)
	var all []Record
	for time.Now().Before(deadline) {
		all = all[:0]
		for _, seg := range s.SealedSegments() {
			records, err := ReadSegment(seg)
			require.NoError(t, err)
			all = append(all, records...)
		}
		if len(all) >= want {
			return all
		}
		time.Sleep(10 * time.Millisecond)
	}
	t.Fatalf("expected %d records, got %d", want, len(all))
	return nil
}

/** @scenario The admitted payload carries the spine contract field names */
func TestContractAdmittedPayload(t *testing.T) {
	s := openTestSpool(t, t.TempDir())
	defer s.Close()
	e := NewEmitter(s)

	at := time.Date(2026, 7, 27, 14, 3, 7, 604000000, time.UTC)
	e.AdmitSpend(pipeline.SpendAdmission{
		GatewayRequestID: "01K1D3H8ZQ4M9X2C7V5B1N6P8T",
		OccurredAt:       at,
		OrganizationID:   "org_x",
		ProjectID:        "proj_x",
		VirtualKeyID:     "vk_lw_01",
		EndUserID:        "d7dcef1e-0755",
		Model:            "bedrock/global.anthropic.claude-sonnet-5",
		RequestType:      "chat",
		Labels:           []string{"customer:acme-172"},
		MetadataJSON:     `{"call_site":"executive_summary"}`,
	})

	records := drainRecords(t, s, 1)
	require.Equal(t, "admitSpend", records[0].Command)
	var payload map[string]any
	require.NoError(t, json.Unmarshal(records[0].Payload, &payload))
	assert.Equal(t, "01K1D3H8ZQ4M9X2C7V5B1N6P8T", payload["gateway_request_id"])
	assert.Equal(t, "org_x", payload["organization_id"])
	assert.Equal(t, "proj_x", payload["project_id"])
	assert.Equal(t, "vk_lw_01", payload["virtual_key_id"])
	assert.Equal(t, "d7dcef1e-0755", payload["end_user_id"])
	// The ingest schema types occurred_at as unix epoch MILLISECONDS and
	// metadata as the raw JSON TEXT (a string). These two assertions ARE
	// the cross-service wire contract; an RFC3339 string or an inlined
	// object here means every admission gets rejected at the control plane.
	assert.Equal(t, float64(at.UnixMilli()), payload["occurred_at"])
	assert.Equal(t, `{"call_site":"executive_summary"}`, payload["metadata"])
	assert.Equal(t, []any{"customer:acme-172"}, payload["labels"])
}

/** @scenario The confirmed payload carries usage by token class and never a cost */
func TestContractConfirmedPayload(t *testing.T) {
	s := openTestSpool(t, t.TempDir())
	defer s.Close()
	e := NewEmitter(s)

	e.ConfirmSpend(pipeline.SpendOutcome{
		GatewayRequestID: "req_2",
		OccurredAt:       time.Date(2026, 7, 27, 14, 3, 11, 0, time.UTC),
		ProjectID:        "proj_x",
		Usage: domain.Usage{
			PromptTokens:        869,
			CompletionTokens:    207,
			CacheReadTokens:     11,
			CacheCreationTokens: 5,
		},
		Model:           "claude-sonnet-5",
		ModelProviderID: "mp_1",
		Duration:        3878 * time.Millisecond,
	})

	records := drainRecords(t, s, 1)
	require.Equal(t, "confirmSpend", records[0].Command)
	var payload map[string]any
	require.NoError(t, json.Unmarshal(records[0].Payload, &payload))
	usage, ok := payload["usage"].(map[string]any)
	require.True(t, ok)
	assert.EqualValues(t, 869, usage["input_tokens"])
	assert.EqualValues(t, 207, usage["output_tokens"])
	assert.EqualValues(t, 11, usage["cache_read_input_tokens"])
	assert.EqualValues(t, 5, usage["cache_creation_input_tokens"])
	assert.EqualValues(t, 0, usage["reasoning_tokens"])
	assert.EqualValues(t, 3878, payload["duration_ms"])
	assert.Equal(t, "mp_1", payload["model_provider_id"])
	// Tenancy rides every record: the ingest route rejects (silently, from
	// the drainer's point of view) any outcome without its project.
	assert.Equal(t, "proj_x", payload["project_id"])
	_, hasCost := payload["cost"]
	assert.False(t, hasCost, "rating happens in the pipeline; cost never travels")
}

/** @scenario The failed payload keeps the full error taxonomy */
func TestContractFailedPayload(t *testing.T) {
	s := openTestSpool(t, t.TempDir())
	defer s.Close()
	e := NewEmitter(s)

	e.FailSpend(pipeline.SpendOutcome{
		GatewayRequestID: "req_3",
		OccurredAt:       time.Now(),
		Err:              &pipeline.SpendError{Type: "budget_exceeded", HTTPStatus: 402},
		Usage:            domain.Usage{PromptTokens: 869},
		Duration:         1509 * time.Millisecond,
	})

	records := drainRecords(t, s, 1)
	require.Equal(t, "failSpend", records[0].Command)
	var payload map[string]any
	require.NoError(t, json.Unmarshal(records[0].Payload, &payload))
	errObj, ok := payload["error"].(map[string]any)
	require.True(t, ok)
	assert.Equal(t, "budget_exceeded", errObj["type"])
	assert.EqualValues(t, 402, errObj["http_status"])
}

/** @scenario A shipped batch is signed with the shared gateway HMAC scheme */
func TestContractShipSignsBatch(t *testing.T) {
	var mu sync.Mutex
	var got struct {
		body      []byte
		timestamp string
		signature string
		node      string
	}
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		// A single Read can legally return short; ReadAll never does.
		body, _ := io.ReadAll(r.Body)
		mu.Lock()
		got.body = body
		got.timestamp = r.Header.Get("X-LangWatch-Gateway-Timestamp")
		got.signature = r.Header.Get("X-LangWatch-Gateway-Signature")
		got.node = r.Header.Get("X-LangWatch-Gateway-Node")
		mu.Unlock()
		w.WriteHeader(http.StatusAccepted)
	}))
	defer server.Close()

	signer, err := controlplane.NewSigner("secret", "pod-test")
	require.NoError(t, err)
	client, err := NewIngestClient(server.URL, signer)
	require.NoError(t, err)

	err = client.Ship(t.Context(), []Record{{
		Command: CommandAdmit,
		Payload: json.RawMessage(`{"gateway_request_id":"req_9"}`),
		PodID:   "pod-test",
		PodSeq:  7,
	}})
	require.NoError(t, err)

	mu.Lock()
	defer mu.Unlock()
	assert.NotEmpty(t, got.timestamp)
	assert.Len(t, got.signature, 64, "hex sha256 hmac")
	assert.Equal(t, "pod-test", got.node)
	var envelope batchEnvelope
	require.NoError(t, json.Unmarshal(got.body, &envelope))
	require.Len(t, envelope.Records, 1)
	assert.Equal(t, uint64(7), envelope.Records[0].PodSeq)
}

/** @scenario A hung ingest endpoint never slows the request path */
func TestContractHungIngestNeverBlocksAppend(t *testing.T) {
	hung := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		time.Sleep(5 * time.Second)
	}))
	defer hung.Close()

	s := openTestSpool(t, t.TempDir())
	defer s.Close()
	signer, err := controlplane.NewSigner("secret", "pod-test")
	require.NoError(t, err)
	client, err := NewIngestClient(hung.URL, signer)
	require.NoError(t, err)
	d := NewDrainer(DrainerOptions{Spool: s, Shipper: client, Tick: 10 * time.Millisecond})
	ctx, cancel := context.WithCancel(t.Context())
	go d.Start(ctx)
	defer cancel()

	e := NewEmitter(s)
	start := time.Now()
	for i := 0; i < 5000; i++ {
		e.AdmitSpend(pipeline.SpendAdmission{GatewayRequestID: "req", OccurredAt: time.Now()})
	}
	assert.Less(t, time.Since(start), time.Second, "emission is independent of ingest health")
}
