package httpmiddleware

import (
	"errors"
	"net/http"
	"time"

	"go.uber.org/zap"

	"github.com/langwatch/langwatch/pkg/clog"
	"github.com/langwatch/langwatch/pkg/herr"
)

// Telemetry is a request lifecycle middleware. It:
//   - Enriches the context logger with request fields (method, path, remote, request_id)
//   - Logs request start at debug level
//   - Logs request completion at info level with status, bytes, and duration
func Telemetry() func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			start := time.Now()
			requestID := GetRequestID(r.Context())

			ctx := clog.With(r.Context(),
				zap.String("method", r.Method),
				zap.String("path", r.URL.Path),
				zap.String("remote", r.RemoteAddr),
				zap.String("request_id", requestID),
			)

			clog.Get(ctx).Debug("request_started")

			rec := &responseRecorder{ResponseWriter: w, status: 200}
			next.ServeHTTP(rec, r.WithContext(ctx))

			fields := []zap.Field{
				zap.Int("status", rec.status),
				zap.Int("bytes", rec.bytes),
				zap.Duration("duration", time.Since(start)),
			}

			if rec.err != nil {
				var e herr.E
				if errors.As(rec.err, &e) {
					fields = append(fields, zap.String("error_code", string(e.Code)))
					if len(e.Meta) > 0 {
						fields = append(fields, zap.Any("error_meta", e.Meta))
					}
					if len(e.Reasons) > 0 {
						reasons := make([]string, len(e.Reasons))
						for i, r := range e.Reasons {
							reasons[i] = r.Error()
						}
						fields = append(fields, zap.Strings("error_reasons", reasons))
					}
				} else {
					fields = append(fields, zap.NamedError("error", rec.err))
				}
			}

			clog.Get(ctx).Info("request_completed", fields...)
		})
	}
}

type responseRecorder struct {
	http.ResponseWriter
	status int
	bytes  int
	err    error
}

func (r *responseRecorder) RecordError(err error) {
	r.err = err
}

func (r *responseRecorder) WriteHeader(code int) {
	r.status = code
	r.ResponseWriter.WriteHeader(code)
}

func (r *responseRecorder) Write(b []byte) (int, error) {
	n, err := r.ResponseWriter.Write(b)
	r.bytes += n
	return n, err
}

func (r *responseRecorder) Flush() {
	if f, ok := r.ResponseWriter.(http.Flusher); ok {
		f.Flush()
	}
}

func (r *responseRecorder) Unwrap() http.ResponseWriter {
	return r.ResponseWriter
}
