package contexts

import (
	"context"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestServiceInfo_SetGet(t *testing.T) {
	info := ServiceInfo{
		Environment: "production",
		Service:     "gateway",
		Version:     "v1.2.3",
	}
	ctx := SetServiceInfo(context.Background(), info)

	got := GetServiceInfo(ctx)
	require.NotNil(t, got)
	assert.Equal(t, "production", got.Environment)
	assert.Equal(t, "gateway", got.Service)
	assert.Equal(t, "v1.2.3", got.Version)
}

func TestServiceInfo_Unset(t *testing.T) {
	assert.Nil(t, GetServiceInfo(context.Background()))
}

func TestMustGetServiceInfo_Panics(t *testing.T) {
	assert.Panics(t, func() {
		MustGetServiceInfo(context.Background())
	})
}
