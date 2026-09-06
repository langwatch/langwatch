package customertracebridge

import (
	"go.opentelemetry.io/otel/attribute"
	"go.opentelemetry.io/otel/sdk/resource"
)

// Policy is a service-defined allowlist for the RESOURCE attributes that may
// ride on customer-bound trace data, plus the attributes the service always
// stamps. Everything not allowed is dropped — fail closed, so an attribute
// added to a pod environment or SDK resource tomorrow never reaches a
// customer by accident. Platform identity (service name/version, k8s
// topology, cloud region) is infrastructure detail: not sensitive, but not
// the customer's data either.
//
// The zero value allows nothing and stamps nothing.
type Policy struct {
	// Allow lists resource-attribute keys permitted to pass through from the
	// originating telemetry.
	Allow []attribute.Key
	// Stamp is always present on the outgoing resource and wins over any
	// incoming attribute with the same key.
	Stamp []attribute.KeyValue
}

// Allows reports whether the policy lets a resource-attribute key pass
// through from the originating telemetry. Exposed so relays that carry
// serialized OTLP (pdata) can apply the same policy without this package
// depending on the collector pdata module.
func (p Policy) Allows(key attribute.Key) bool {
	for _, k := range p.Allow {
		if k == key {
			return true
		}
	}
	return false
}

// ApplyResource rebuilds a span-level resource under the policy.
func (p Policy) ApplyResource(in *resource.Resource) *resource.Resource {
	kept := make([]attribute.KeyValue, 0, len(p.Stamp)+len(p.Allow))
	if in != nil {
		for _, kv := range in.Attributes() {
			if p.Allows(kv.Key) && !p.Stamps(kv.Key) {
				kept = append(kept, kv)
			}
		}
	}
	kept = append(kept, p.Stamp...)
	return resource.NewSchemaless(kept...)
}

// Stamps reports whether the policy itself sets this key, in which case the
// stamped value wins over any incoming one.
func (p Policy) Stamps(key attribute.Key) bool {
	for _, kv := range p.Stamp {
		if kv.Key == key {
			return true
		}
	}
	return false
}
