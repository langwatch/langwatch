package authresolver

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/langwatch/langwatch/services/aigateway/domain"
)

// heldKeyFetcher answers the config route for a key held outside the cache.
type heldKeyFetcher struct {
	fakeResolver
	result domain.ConfigFetchResult
	err    error
	asked  []string
}

func (f *heldKeyFetcher) FetchConfig(_ context.Context, vkID, etag string) (domain.ConfigFetchResult, error) {
	f.asked = append(f.asked, vkID+"@"+etag)
	return f.result, f.err
}

func heldBundle() *domain.Bundle {
	return &domain.Bundle{
		VirtualKeyID: "vk_held",
		ProjectID:    "proj_1",
		Credentials:  []domain.Credential{{ID: "cred-old"}},
	}
}

func TestReadHeldKeyAnswersTheFreshConfigOnACopy(t *testing.T) {
	expiry := time.Now().Add(time.Hour)
	fetcher := &heldKeyFetcher{result: domain.ConfigFetchResult{
		Config:                domain.BundleConfig{Credentials: []domain.Credential{{ID: "cred-new"}}, AllowedModels: []string{"gpt-live"}},
		ETag:                  "43",
		VirtualKeyExpiresAt:   expiry,
		VirtualKeyExpiryKnown: true,
	}}
	svc, _ := newService(t, Options{Resolver: &fetcher.fakeResolver, ConfigFetcher: fetcher})
	held := heldBundle()

	got, err := svc.ReadHeldKey(context.Background(), held, "42")

	require.NoError(t, err)
	assert.Equal(t, []string{"vk_held@42"}, fetcher.asked, "the key is read by id, with the held version")
	assert.Equal(t, "43", got.ETag)
	assert.False(t, got.Revoked)
	assert.Equal(t, "cred-new", got.Bundle.Credentials[0].ID)
	assert.Equal(t, []string{"gpt-live"}, got.Bundle.Config.AllowedModels)
	assert.Equal(t, expiry, got.Bundle.VirtualKeyExpiresAt)
	assert.Equal(t, "proj_1", got.Bundle.ProjectID)
	assert.Equal(t, "cred-old", held.Credentials[0].ID, "the held bundle is shared and is not written to")
}

func TestReadHeldKeyKeepsTheBundleWhenNothingChanged(t *testing.T) {
	fetcher := &heldKeyFetcher{result: domain.ConfigFetchResult{ETag: "42", NotModified: true}}
	svc, _ := newService(t, Options{Resolver: &fetcher.fakeResolver, ConfigFetcher: fetcher})
	held := heldBundle()

	got, err := svc.ReadHeldKey(context.Background(), held, "42")

	require.NoError(t, err)
	assert.Same(t, held, got.Bundle)
	assert.False(t, got.Revoked)
}

func TestReadHeldKeyReportsAKeyThatIsNoLongerActive(t *testing.T) {
	fetcher := &heldKeyFetcher{result: domain.ConfigFetchResult{ETag: "44", KeyInactive: true}}
	svc, _ := newService(t, Options{Resolver: &fetcher.fakeResolver, ConfigFetcher: fetcher})

	got, err := svc.ReadHeldKey(context.Background(), heldBundle(), "42")

	require.NoError(t, err)
	assert.True(t, got.Revoked)
}

func TestReadHeldKeyPassesAFetchFailureOn(t *testing.T) {
	down := errors.New("control plane unreachable")
	fetcher := &heldKeyFetcher{err: down}
	svc, _ := newService(t, Options{Resolver: &fetcher.fakeResolver, ConfigFetcher: fetcher})

	_, err := svc.ReadHeldKey(context.Background(), heldBundle(), "")

	assert.ErrorIs(t, err, down)
}
