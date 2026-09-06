package pipeline

// Tests for the spend interceptor: every request admits exactly once and
// closes with exactly one outcome (confirm or fail), including requests the
// gateway itself rejects before dispatch, streaming requests, and client
// disconnects mid-stream.

import (
	"context"
	"errors"
	"sync"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/langwatch/langwatch/pkg/customertracebridge"
	"github.com/langwatch/langwatch/pkg/herr"
	"github.com/langwatch/langwatch/services/aigateway/domain"
)

type recordingEmitter struct {
	mu       sync.Mutex
	admitted []SpendAdmission
	confirms []SpendOutcome
	fails    []SpendOutcome
}

func (r *recordingEmitter) AdmitSpend(a SpendAdmission) {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.admitted = append(r.admitted, a)
}
func (r *recordingEmitter) ConfirmSpend(o SpendOutcome) {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.confirms = append(r.confirms, o)
}
func (r *recordingEmitter) FailSpend(o SpendOutcome) {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.fails = append(r.fails, o)
}

func spendTestCall() *Call {
	return &Call{
		Bundle: &domain.Bundle{
			OrganizationID: "org_1",
			ProjectID:      "proj_1",
			VirtualKeyID:   "vk_1",
			Config:         domain.BundleConfig{VKTags: []string{"customer:acme-1"}},
		},
		Request: &domain.Request{
			Type:  domain.RequestTypeChat,
			Model: "gpt-x",
			Body:  []byte(`{"model":"gpt-x","user":"end-user-9"}`),
		},
		Meta: &MetaAccumulator{meta: Meta{GatewayRequestID: "req_1"}},
	}
}

/** @scenario Every request admits a spend record before any gating runs */
func TestSpendAdmitsWithAttribution(t *testing.T) {
	rec := &recordingEmitter{}
	interceptor := Spend(rec)
	next := func(ctx context.Context, call *Call) (*domain.Response, error) {
		return &domain.Response{Usage: domain.Usage{PromptTokens: 10, CompletionTokens: 3}}, nil
	}
	_, err := interceptor.Sync(next)(context.Background(), spendTestCall())
	require.NoError(t, err)

	require.Len(t, rec.admitted, 1)
	a := rec.admitted[0]
	assert.Equal(t, "req_1", a.GatewayRequestID)
	assert.Equal(t, "org_1", a.OrganizationID)
	assert.Equal(t, "proj_1", a.ProjectID)
	assert.Equal(t, "vk_1", a.VirtualKeyID)
	assert.Equal(t, "end-user-9", a.EndUserID, "body user param feeds admission attribution")
	assert.Equal(t, "gpt-x", a.Model)
	assert.Equal(t, []string{"customer:acme-1"}, a.Labels)
	require.Len(t, rec.confirms, 1)
	assert.Equal(t, 10, rec.confirms[0].Usage.PromptTokens)
	assert.Empty(t, rec.fails)
}

/** @scenario A gateway rejection admits and fails with its own taxonomy token */
func TestSpendGatewayRejectionKeepsTaxonomy(t *testing.T) {
	rec := &recordingEmitter{}
	interceptor := Spend(rec)
	next := func(ctx context.Context, call *Call) (*domain.Response, error) {
		return nil, herr.New(context.Background(), domain.ErrBudgetExceeded, nil)
	}
	_, err := interceptor.Sync(next)(context.Background(), spendTestCall())
	require.Error(t, err)

	require.Len(t, rec.admitted, 1)
	require.Len(t, rec.fails, 1)
	require.NotNil(t, rec.fails[0].Err)
	assert.Equal(t, "budget_exceeded", rec.fails[0].Err.Type)
	assert.Empty(t, rec.confirms)
}

/** @scenario A provider failure classifies through the upstream taxonomy */
func TestSpendUpstreamErrorClassifies(t *testing.T) {
	rec := &recordingEmitter{}
	interceptor := Spend(rec)
	next := func(ctx context.Context, call *Call) (*domain.Response, error) {
		return nil, &domain.UpstreamError{StatusCode: 429}
	}
	_, err := interceptor.Sync(next)(context.Background(), spendTestCall())
	require.Error(t, err)
	require.Len(t, rec.fails, 1)
	assert.Equal(t, "rate_limited", rec.fails[0].Err.Type)
	assert.Equal(t, 429, rec.fails[0].Err.HTTPStatus)
}

type stubIterator struct {
	chunks [][]byte
	pos    int
	usage  domain.Usage
	err    error
	closed bool
}

func (s *stubIterator) Next(ctx context.Context) bool {
	if s.pos >= len(s.chunks) {
		return false
	}
	s.pos++
	return true
}
func (s *stubIterator) Chunk() []byte       { return s.chunks[s.pos-1] }
func (s *stubIterator) Usage() domain.Usage { return s.usage }
func (s *stubIterator) Err() error          { return s.err }
func (s *stubIterator) Close() error        { s.closed = true; return nil }

/** @scenario A streaming request confirms once with the accumulated usage */
func TestSpendStreamConfirmsOnceOnExhaustion(t *testing.T) {
	rec := &recordingEmitter{}
	interceptor := Spend(rec)
	inner := &stubIterator{chunks: [][]byte{[]byte("a"), []byte("b")}, usage: domain.Usage{PromptTokens: 7}}
	next := func(ctx context.Context, call *Call) (domain.StreamIterator, error) { return inner, nil }

	iter, err := interceptor.Stream(next)(context.Background(), spendTestCall())
	require.NoError(t, err)
	for iter.Next(context.Background()) {
	}
	require.NoError(t, iter.Close())

	require.Len(t, rec.confirms, 1, "exhaustion then Close must emit exactly once")
	assert.Equal(t, 7, rec.confirms[0].Usage.PromptTokens)
	assert.Empty(t, rec.fails)
}

/** @scenario A client disconnect mid-stream confirms the tokens consumed so far */
func TestSpendStreamClientDisconnectConfirmsPartial(t *testing.T) {
	rec := &recordingEmitter{}
	interceptor := Spend(rec)
	inner := &stubIterator{chunks: [][]byte{[]byte("a"), []byte("b"), []byte("c")}, usage: domain.Usage{PromptTokens: 4}}
	next := func(ctx context.Context, call *Call) (domain.StreamIterator, error) { return inner, nil }

	iter, err := interceptor.Stream(next)(context.Background(), spendTestCall())
	require.NoError(t, err)
	iter.Next(context.Background())
	require.NoError(t, iter.Close())

	require.Len(t, rec.confirms, 1)
	assert.Equal(t, 4, rec.confirms[0].Usage.PromptTokens)
}

/** @scenario A stream that dies mid-flight fails with the accumulated usage */
func TestSpendStreamErrorFails(t *testing.T) {
	rec := &recordingEmitter{}
	interceptor := Spend(rec)
	inner := &stubIterator{chunks: [][]byte{[]byte("a")}, usage: domain.Usage{PromptTokens: 2}, err: errors.New("upstream died")}
	next := func(ctx context.Context, call *Call) (domain.StreamIterator, error) { return inner, nil }

	iter, err := interceptor.Stream(next)(context.Background(), spendTestCall())
	require.NoError(t, err)
	for iter.Next(context.Background()) {
	}
	require.NoError(t, iter.Close())

	require.Len(t, rec.fails, 1)
	assert.Equal(t, 2, rec.fails[0].Usage.PromptTokens)
	assert.Empty(t, rec.confirms)
}

/** @scenario The header-resolved end user beats the body param */
func TestSpendHeaderEndUserWins(t *testing.T) {
	rec := &recordingEmitter{}
	interceptor := Spend(rec)
	call := spendTestCall()
	ctx := customertracebridge.WithEndUserID(context.Background(), "header-user")
	next := func(ctx context.Context, call *Call) (*domain.Response, error) {
		return &domain.Response{}, nil
	}
	_, err := interceptor.Sync(next)(ctx, call)
	require.NoError(t, err)
	require.Len(t, rec.admitted, 1)
	assert.Equal(t, "header-user", rec.admitted[0].EndUserID)
}

/** @scenario Outcome duration measures the request, not the emission */
func TestSpendOutcomeDuration(t *testing.T) {
	rec := &recordingEmitter{}
	interceptor := Spend(rec)
	next := func(ctx context.Context, call *Call) (*domain.Response, error) {
		time.Sleep(15 * time.Millisecond)
		return &domain.Response{}, nil
	}
	_, err := interceptor.Sync(next)(context.Background(), spendTestCall())
	require.NoError(t, err)
	require.Len(t, rec.confirms, 1)
	assert.GreaterOrEqual(t, rec.confirms[0].Duration, 15*time.Millisecond)
}
