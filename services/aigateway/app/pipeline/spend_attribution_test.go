package pipeline

import (
	"context"
	"errors"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/langwatch/langwatch/services/aigateway/domain"
)

// The outcome repeats the admission's attribution so the control plane's
// consumers can act on the one event they are handling. Before this, each of
// them remembered every open admission in a durable row, one per gateway
// request, in a table with no retention sweep.

// @scenario A confirmation carries the attribution its admission carried
func TestOutcomeCarriesAdmissionAttribution(t *testing.T) {
	rec := &recordingEmitter{}
	next := func(ctx context.Context, call *Call) (*domain.Response, error) {
		return &domain.Response{Usage: domain.Usage{PromptTokens: 10, CompletionTokens: 3}}, nil
	}
	_, err := Spend(rec).Sync(next)(context.Background(), spendTestCall())
	require.NoError(t, err)

	require.Len(t, rec.admitted, 1)
	require.Len(t, rec.confirms, 1)
	admitted := rec.admitted[0]
	got := rec.confirms[0].Attribution

	assert.Equal(t, admitted.OrganizationID, got.OrganizationID)
	assert.Equal(t, admitted.VirtualKeyID, got.VirtualKeyID)
	assert.Equal(t, admitted.EndUserID, got.EndUserID)
	assert.Equal(t, admitted.TraceID, got.TraceID)
	assert.Equal(t, admitted.RequestType, got.RequestType)
	assert.Equal(t, admitted.Labels, got.Labels)
	assert.Equal(t, admitted.MetadataJSON, got.MetadataJSON)
	// The admission instant, so a consumer can state how long a request was
	// open without holding the admission itself.
	assert.Equal(t, admitted.OccurredAt, got.AdmittedAt)
}

// @scenario A failure carries the attribution its admission carried
func TestFailedOutcomeCarriesAdmissionAttribution(t *testing.T) {
	rec := &recordingEmitter{}
	next := func(ctx context.Context, call *Call) (*domain.Response, error) {
		return nil, errors.New("provider exploded")
	}
	_, err := Spend(rec).Sync(next)(context.Background(), spendTestCall())
	require.Error(t, err)

	require.Len(t, rec.admitted, 1)
	require.Len(t, rec.fails, 1)
	assert.Equal(t,
		rec.admitted[0].OrganizationID,
		rec.fails[0].Attribution.OrganizationID)
	assert.Equal(t,
		rec.admitted[0].EndUserID,
		rec.fails[0].Attribution.EndUserID)
}

// @scenario The outcome's attribution is the admission's, not a re-derivation
func TestStreamOutcomeUsesAttributionCapturedAtOpen(t *testing.T) {
	rec := &recordingEmitter{}
	call := spendTestCall()
	// No chunks: the wrapper reaches its single outcome emission on the first
	// exhausted Next, which is all this case needs.
	iter := &stubIterator{usage: domain.Usage{PromptTokens: 4, CompletionTokens: 2}}
	next := func(ctx context.Context, c *Call) (domain.StreamIterator, error) {
		return iter, nil
	}

	stream, err := Spend(rec).Stream(next)(context.Background(), call)
	require.NoError(t, err)
	require.Len(t, rec.admitted, 1)
	admitted := rec.admitted[0]

	// A stream closes long after it opened, and end-user resolution reads a
	// body that may have been materialized in between. Mutating the call here
	// stands in for that: the outcome must still state what the admission
	// stated, or the two records disagree about who spent the money.
	call.Request.Body = []byte(`{"model":"gpt-x","user":"someone-else"}`)
	call.Bundle.OrganizationID = "org_rotated"

	for stream.Next(context.Background()) {
	}

	require.Len(t, rec.confirms, 1)
	got := rec.confirms[0].Attribution
	assert.Equal(t, admitted.EndUserID, got.EndUserID)
	assert.Equal(t, admitted.OrganizationID, got.OrganizationID)
	assert.NotEqual(t, "org_rotated", got.OrganizationID)
}
