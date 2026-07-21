package customertracebridge

import (
	"testing"

	"github.com/stretchr/testify/assert"
	"go.opentelemetry.io/otel/attribute"
	"go.opentelemetry.io/otel/sdk/resource"
)

func TestPolicy_ApplyResource(t *testing.T) {
	in := resource.NewSchemaless(
		attribute.String("service.name", "some-service"),
		attribute.String("k8s.pod.name", "pod-1"),
		attribute.String("langwatch.origin", "forged"),
	)

	t.Run("zero policy fails closed", func(t *testing.T) {
		out := Policy{}.ApplyResource(in)
		assert.Empty(t, out.Attributes(), "nothing may pass an empty policy")
	})

	t.Run("allowed keys pass, everything else drops", func(t *testing.T) {
		p := Policy{Allow: []attribute.Key{"service.name"}}
		out := p.ApplyResource(in)
		assert.Len(t, out.Attributes(), 1)
		assert.Equal(t, attribute.String("service.name", "some-service"), out.Attributes()[0])
	})

	t.Run("a stamp replaces any incoming value for its key", func(t *testing.T) {
		p := Policy{
			// Even explicitly allowing the key must not let the incoming
			// value beat the stamp.
			Allow: []attribute.Key{"langwatch.origin"},
			Stamp: []attribute.KeyValue{attribute.String("langwatch.origin", "gateway")},
		}
		out := p.ApplyResource(in)
		assert.Len(t, out.Attributes(), 1)
		assert.Equal(t, attribute.String("langwatch.origin", "gateway"), out.Attributes()[0])
	})

	t.Run("nil resource still yields the stamps", func(t *testing.T) {
		p := Policy{Stamp: []attribute.KeyValue{attribute.String("langwatch.origin", "gateway")}}
		out := p.ApplyResource(nil)
		assert.Len(t, out.Attributes(), 1)
	})
}
