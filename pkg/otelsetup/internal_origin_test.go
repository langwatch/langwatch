package otelsetup

import (
	"testing"

	"github.com/stretchr/testify/assert"
)

// The internal-origin marker travels IN the telemetry, so it survives what no
// destination check can: a valid-but-wrong endpoint. Single-tenant providers
// carry only LangWatch's own telemetry and are marked; the multi-tenant
// provider's resource reaches customer projects through the tenant router and
// must never be.
func TestBuildResourceAttrs_MarksSingleTenantResourcesAsInternal(t *testing.T) {
	attrs := buildResourceAttrs("langwatch-aigateway", "dev", "production", "node-1", true)

	found := ""
	for _, kv := range attrs {
		if string(kv.Key) == AttrLangWatchOrigin {
			found = kv.Value.AsString()
		}
	}
	assert.Equal(t, OriginPlatformInternal, found)
}

func TestBuildResourceAttrs_NeverMarksMultiTenantResources(t *testing.T) {
	attrs := buildResourceAttrs("langwatch-nlp", "dev", "production", "node-1", false)

	for _, kv := range attrs {
		assert.NotEqual(t, AttrLangWatchOrigin, string(kv.Key),
			"a multi-tenant resource reaches customer projects — marking it internal would brand their traces")
	}
}

// The debug collector dual-export is skipped when it IS the primary
// collector: with the official env vars a dev shell points both names at the
// local stack, and a second processor would duplicate every span.
func TestSameCollectorBase(t *testing.T) {
	for _, tt := range []struct {
		name    string
		primary string
		debug   string
		same    bool
	}{
		{name: "identical base", primary: "http://localhost:4318", debug: "http://localhost:4318", same: true},
		{name: "primary carries the traces path", primary: "http://localhost:4318/v1/traces", debug: "http://localhost:4318", same: true},
		{name: "trailing slash", primary: "http://localhost:4318/v1/traces", debug: "http://localhost:4318/", same: true},
		{name: "case-insensitive host", primary: "http://LocalHost:4318/v1/traces", debug: "http://localhost:4318", same: true},
		{name: "different port", primary: "http://localhost:4318/v1/traces", debug: "http://localhost:4319", same: false},
		{name: "different host", primary: "http://collector:4318/v1/traces", debug: "http://localhost:4318", same: false},
		{name: "empty primary never matches", primary: "", debug: "http://localhost:4318", same: false},
	} {
		t.Run(tt.name, func(t *testing.T) {
			assert.Equal(t, tt.same, sameCollectorBase(tt.primary, tt.debug))
		})
	}
}
