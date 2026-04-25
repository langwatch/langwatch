package httpmiddleware

import (
	"errors"
	"net/http"
)

// MaxBodyBytes caps request body size. Rejects immediately if Content-Length
// exceeds limit, otherwise wraps with http.MaxBytesReader.
func MaxBodyBytes(limit int64) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		if limit <= 0 {
			return next
		}
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			if r.ContentLength > limit {
				http.Error(w, `{"error":"payload too large"}`, http.StatusRequestEntityTooLarge)
				return
			}
			r.Body = http.MaxBytesReader(w, r.Body, limit)
			next.ServeHTTP(w, r)
		})
	}
}

// IsMaxBytesError reports whether err is from http.MaxBytesReader.
func IsMaxBytesError(err error) bool {
	var mbe *http.MaxBytesError
	return errors.As(err, &mbe)
}
