package otelsetup

import (
	"sync"

	otelapi "go.opentelemetry.io/otel"
)

// serviceErrorHandlers is the global OTel error handler once two services
// share a process. An SDK error carries no context to route by, so every
// service's handler hears it, each with its own grace window and logger,
// instead of only the latest service's. One service installs its own directly.
type serviceErrorHandlers struct {
	mu       sync.RWMutex
	handlers map[string]otelapi.ErrorHandler
}

var globalErrorHandlers = &serviceErrorHandlers{handlers: map[string]otelapi.ErrorHandler{}}

// installErrorHandler registers a service's handler and sets the global. The
// handler must not be otelapi.GetErrorHandler(), or Handle would recurse.
func installErrorHandler(service string, h otelapi.ErrorHandler) {
	globalErrorHandlers.mu.Lock()
	globalErrorHandlers.handlers[service] = h
	isShared := len(globalErrorHandlers.handlers) > 1
	globalErrorHandlers.mu.Unlock()
	if isShared {
		otelapi.SetErrorHandler(globalErrorHandlers)
		return
	}
	otelapi.SetErrorHandler(h)
}

func (s *serviceErrorHandlers) Handle(err error) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	for _, h := range s.handlers {
		h.Handle(err)
	}
}
