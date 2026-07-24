package contexts

import "context"

// ServiceInfo holds metadata about the running service.
type ServiceInfo struct {
	Environment string
	Service     string
	Version     string
}

type serviceInfoKey struct{}

// SetServiceInfo stores service metadata in the context.
func SetServiceInfo(ctx context.Context, info ServiceInfo) context.Context {
	return context.WithValue(ctx, serviceInfoKey{}, info)
}

// GetServiceInfo retrieves service metadata from the context, or nil if unset.
func GetServiceInfo(ctx context.Context) *ServiceInfo {
	if val, ok := ctx.Value(serviceInfoKey{}).(ServiceInfo); ok {
		return &val
	}
	return nil
}

// MustGetServiceInfo retrieves service metadata or panics.
func MustGetServiceInfo(ctx context.Context) *ServiceInfo {
	if val, ok := ctx.Value(serviceInfoKey{}).(ServiceInfo); ok {
		return &val
	}
	panic("service info not found in context")
}
