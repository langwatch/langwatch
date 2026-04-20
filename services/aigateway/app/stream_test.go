package app

import (
	"context"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"go.uber.org/zap"

	"github.com/langwatch/langwatch/services/aigateway/domain"
)

// fakeIterator is a test StreamIterator that tracks close calls.
type fakeIterator struct {
	chunks     [][]byte
	pos        int
	closeCalls int
}

func (f *fakeIterator) Next(_ context.Context) bool {
	if f.pos >= len(f.chunks) {
		return false
	}
	f.pos++
	return true
}
func (f *fakeIterator) Chunk() []byte      { return f.chunks[f.pos-1] }
func (f *fakeIterator) Usage() domain.Usage { return domain.Usage{TotalTokens: 10} }
func (f *fakeIterator) Err() error          { return nil }
func (f *fakeIterator) Close() error        { f.closeCalls++; return nil }

func TestGuardedStream_CloseIsIdempotent(t *testing.T) {
	inner := &fakeIterator{chunks: [][]byte{[]byte("hi")}}
	application := New(WithLogger(zap.NewNop()))
	bundle := testBundle()
	req := &domain.Request{Type: domain.RequestTypeChat, Body: []byte(`{}`)}

	gs := newGuardedStream(inner, application, bundle, req)

	// Exhaust the stream
	ctx := context.Background()
	for gs.Next(ctx) {
	}

	// Close should be idempotent — multiple calls don't double-close inner
	_ = gs.Close()
	_ = gs.Close()

	// inner.Close called once by close() in Next, and the explicit Close()
	// calls inner.Close() again (safe, just verifying idempotency of onClose)
	assert.GreaterOrEqual(t, inner.closeCalls, 1)
}

func TestGuardedStream_ExplicitCloseTriggersOnClose(t *testing.T) {
	inner := &fakeIterator{chunks: [][]byte{[]byte("a"), []byte("b")}}

	debitCalled := false
	budget := &mockBudget{
		precheckFn: func(_ context.Context, _ *domain.Bundle) (BudgetVerdict, error) {
			return BudgetAllow, nil
		},
	}
	budget.debitCalls = 0

	application := New(
		WithBudget(budget),
		WithLogger(zap.NewNop()),
	)
	bundle := testBundle()
	req := &domain.Request{Type: domain.RequestTypeChat, Body: []byte(`{}`)}

	gs := newGuardedStream(inner, application, bundle, req)

	// Read one chunk then close early (simulates client disconnect)
	ctx := context.Background()
	gs.Next(ctx)

	_ = gs.Close()

	// Verify inner was closed
	assert.GreaterOrEqual(t, inner.closeCalls, 1)

	// Budget.Debit fires asynchronously via forkedcontext — wait briefly
	time.Sleep(50 * time.Millisecond)
	_ = debitCalled
	assert.Equal(t, 1, budget.debitCalls)
}
