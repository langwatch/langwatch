package pipeline

// The two pipeline rules a realtime session mint changes: its spend record
// is not closed by the dispatch that opened it, and the key's guardrails do
// not run against a body that carries no prompt.

import (
	"context"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"go.uber.org/zap"

	"github.com/langwatch/langwatch/pkg/herr"
	"github.com/langwatch/langwatch/services/aigateway/domain"
)

func realtimeMintCall() *Call {
	call := spendTestCall()
	call.Request = &domain.Request{
		Type:            domain.RequestTypeRealtimeSession,
		Model:           domain.ElevenLabsConvAIModel,
		Body:            []byte(`{"model":"elevenlabs/convai","agent_id":"agent_1"}`),
		Surface:         domain.ElevenLabsConvAISurface(),
		RealtimeSession: &domain.RealtimeSessionRequest{Vendor: domain.RealtimeVendorElevenLabs},
	}
	return call
}

// @scenario "A mint admits a spend record and does not confirm it"
func TestSpendDefersTheOutcomeOfASessionMint(t *testing.T) {
	rec := &recordingEmitter{}
	next := func(ctx context.Context, call *Call) (*domain.Response, error) {
		return &domain.Response{StatusCode: 200, Body: []byte(`{"signed_url":"wss://x"}`)}, nil
	}

	_, err := Spend(rec).Sync(next)(context.Background(), realtimeMintCall())
	require.NoError(t, err)

	assert.Len(t, rec.admitted, 1, "the mint is admitted like every other request")
	assert.Empty(t, rec.confirms,
		"confirming here would close the record at zero dollars before the call has started")
	assert.Empty(t, rec.fails)
}

// @scenario "A refused mint is still visible as a spend record"
func TestSpendStillFailsARefusedSessionMint(t *testing.T) {
	rec := &recordingEmitter{}
	next := func(ctx context.Context, call *Call) (*domain.Response, error) {
		return nil, herr.New(ctx, domain.ErrRealtimeSessionLimit, herr.M{"message": "at the cap"})
	}

	_, err := Spend(rec).Sync(next)(context.Background(), realtimeMintCall())
	require.Error(t, err)

	assert.Len(t, rec.admitted, 1)
	require.Len(t, rec.fails, 1,
		"a mint that never opened a session has no later report coming, so it must close here")
	assert.Equal(t, string(domain.ErrRealtimeSessionLimit), rec.fails[0].Err.Type)
	assert.Empty(t, rec.confirms)
}

func TestSpendStillConfirmsEveryOtherRequestType(t *testing.T) {
	rec := &recordingEmitter{}
	next := func(ctx context.Context, call *Call) (*domain.Response, error) {
		return &domain.Response{Usage: domain.Usage{PromptTokens: 10}}, nil
	}

	_, err := Spend(rec).Sync(next)(context.Background(), spendTestCall())
	require.NoError(t, err)
	assert.Len(t, rec.confirms, 1, "the deferral is scoped to the mint type alone")
}

// @scenario "Guardrails are skipped for a mint, and the caller is told"
func TestGuardrailsAreSkippedForASessionMint(t *testing.T) {
	call := realtimeMintCall()
	call.Bundle.Config.Guardrails = domain.GuardrailsConfig{
		Pre: []domain.GuardrailEntry{{ID: "gr_1", Evaluator: "pii"}},
	}
	require.True(t, call.Bundle.Config.Guardrails.HasAny(),
		"the key must really have a guardrail, or this proves nothing")

	preRan := false
	pre := func(context.Context, *domain.Bundle, *domain.Request) (domain.GuardrailVerdict, error) {
		preRan = true
		return domain.GuardrailVerdict{Action: domain.GuardrailBlock}, nil
	}
	post := func(context.Context, *domain.Bundle, *domain.Request, *domain.Response) (domain.GuardrailVerdict, error) {
		return domain.GuardrailVerdict{}, nil
	}
	chunk := func(context.Context, *domain.Bundle, *domain.Request, []byte) (domain.GuardrailVerdict, error) {
		return domain.GuardrailVerdict{}, nil
	}
	next := func(ctx context.Context, call *Call) (*domain.Response, error) {
		return &domain.Response{StatusCode: 200}, nil
	}

	resp, err := Guardrail(pre, post, chunk, zap.NewNop()).Sync(next)(context.Background(), call)
	require.NoError(t, err, "a blocking guardrail must not stop a mint it cannot judge")
	require.NotNil(t, resp)
	assert.False(t, preRan, "the guardrail is not evaluated against a session declaration")
	assert.Equal(t, "realtime_session", call.Meta.Snapshot().GuardrailsNotApplied,
		"a silently skipped guardrail is the failure that looks exactly like a working one")
}

func TestGuardrailsStillRunForEveryOtherRequestType(t *testing.T) {
	call := spendTestCall()
	call.Bundle.Config.Guardrails = domain.GuardrailsConfig{
		Pre: []domain.GuardrailEntry{{ID: "gr_1", Evaluator: "pii"}},
	}

	pre := func(context.Context, *domain.Bundle, *domain.Request) (domain.GuardrailVerdict, error) {
		return domain.GuardrailVerdict{Action: domain.GuardrailBlock, Message: "no"}, nil
	}
	post := func(context.Context, *domain.Bundle, *domain.Request, *domain.Response) (domain.GuardrailVerdict, error) {
		return domain.GuardrailVerdict{}, nil
	}
	chunk := func(context.Context, *domain.Bundle, *domain.Request, []byte) (domain.GuardrailVerdict, error) {
		return domain.GuardrailVerdict{}, nil
	}
	next := func(ctx context.Context, call *Call) (*domain.Response, error) {
		return &domain.Response{}, nil
	}

	_, err := Guardrail(pre, post, chunk, zap.NewNop()).Sync(next)(context.Background(), call)
	require.Error(t, err)
	assert.True(t, herr.IsCode(err, domain.ErrGuardrailBlocked))
	assert.Empty(t, call.Meta.Snapshot().GuardrailsNotApplied)
}

// @scenario "The resolved model is written back into the session body"
func TestResolvedModelIsWrittenIntoTheSessionObject(t *testing.T) {
	body := []byte(`{"session":{"type":"realtime","model":"voice","instructions":"be brief"},` +
		`"expires_after":{"anchor":"created_at","seconds":600}}`)

	out := rewriteModel(body, "session.model", "gpt-realtime")

	assert.Contains(t, string(out), `"model":"gpt-realtime"`)
	assert.Contains(t, string(out), `"instructions":"be brief"`,
		"the caller's own session declaration reaches the vendor untouched")
	assert.Contains(t, string(out), `"seconds":600`)
	assert.NotContains(t, string(out), `"voice"`)
}

func TestRewriteModelLeavesABodyThatIsNotAnObjectAlone(t *testing.T) {
	for _, body := range [][]byte{[]byte(`[1,2,3]`), []byte(`not json`), nil} {
		assert.Equal(t, body, rewriteModel(body, "model", "gpt-4o"))
	}
}
