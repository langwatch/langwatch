package ksuid

import (
	"context"
	"strings"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/langwatch/langwatch/pkg/contexts"
)

func TestGenerate_ProdEnvironment(t *testing.T) {
	ctx := context.Background()
	id := Generate(ctx, ResourceGatewayRequest)

	assert.Equal(t, "prod", id.Environment)
	assert.Equal(t, ResourceGatewayRequest, id.Resource)
	assert.False(t, id.IsZero())
}

func TestGenerate_CustomEnvironment(t *testing.T) {
	ctx := contexts.SetServiceInfo(context.Background(), contexts.ServiceInfo{
		Environment: "staging",
		Service:     "test",
		Version:     "1.0",
	})
	id := Generate(ctx, ResourceGatewayRequest)

	assert.Equal(t, "staging", id.Environment)
}

func TestID_String_ProdPrefix(t *testing.T) {
	ctx := context.Background()
	id := Generate(ctx, ResourceGatewayRequest)

	s := id.String()
	// prod environment omits env prefix: "gtwyreq_<base62>"
	assert.True(t, strings.HasPrefix(s, "gtwyreq_"), "got: %s", s)
}

func TestID_String_NonProdPrefix(t *testing.T) {
	ctx := contexts.SetServiceInfo(context.Background(), contexts.ServiceInfo{
		Environment: "staging",
	})
	id := Generate(ctx, ResourceGatewayRequest)

	s := id.String()
	assert.True(t, strings.HasPrefix(s, "staging_gtwyreq_"), "got: %s", s)
}

func TestID_String_NoResource(t *testing.T) {
	ctx := context.Background()
	id := Generate(ctx, "")

	s := id.String()
	// No resource = no prefix, just base62
	assert.NotEmpty(t, s)
	assert.False(t, strings.Contains(s, "_"))
}

func TestGenerate_SequentialIDsAreSortable(t *testing.T) {
	ctx := context.Background()
	id1 := Generate(ctx, ResourceGatewayRequest)
	id2 := Generate(ctx, ResourceGatewayRequest)

	// Same timestamp → sequence increments
	assert.Equal(t, id1.Timestamp, id2.Timestamp)
	assert.True(t, id2.SequenceID > id1.SequenceID || id2.Timestamp > id1.Timestamp,
		"second ID should have higher sequence or timestamp")
}

func TestID_IsZero(t *testing.T) {
	var id ID
	assert.True(t, id.IsZero())
}

func TestSetInstanceID(t *testing.T) {
	custom := InstanceID{Scheme: 'C', Data: [8]byte{1, 2, 3, 4, 5, 6, 7, 8}}
	SetInstanceID(custom)

	ctx := context.Background()
	id := Generate(ctx, "test")

	assert.Equal(t, custom, id.InstanceID)

	// Reset to random to not affect other tests
	SetInstanceID(newRandomInstanceID())
}

func TestEncodeBase62_PadsTo29Chars(t *testing.T) {
	buf := make([]byte, 21)
	result := encodeBase62(buf)
	require.Len(t, result, 29)
}

func TestGenerate_UniqueIDs(t *testing.T) {
	ctx := context.Background()
	seen := make(map[string]bool)
	for i := 0; i < 1000; i++ {
		id := Generate(ctx, ResourceGatewayRequest)
		s := id.String()
		assert.False(t, seen[s], "duplicate ID: %s", s)
		seen[s] = true
	}
}
