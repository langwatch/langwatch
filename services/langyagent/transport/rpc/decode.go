package rpc

import (
	"encoding/json"
	"errors"
	"io"
	"net/http"

	"github.com/langwatch/langwatch/pkg/herr"
	"github.com/langwatch/langwatch/services/langyagent/domain"
)

// decode reads, size-caps, and JSON-decodes an RPC request body into T — the one
// place body-read + MaxBytes + Unmarshal live, so every handler reads decode →
// validate → delegate instead of repeating the plumbing. The returned error is
// already a herr (ErrPayloadTooLarge for an over-cap body, ErrBadRequest for a
// read or JSON failure), ready for herr.WriteHTTP; the raw cause rides in the
// herr reasons (logged by the telemetry middleware, never surfaced to the
// caller). MaxBytesReader needs w to reset the connection on overflow, so it is
// threaded through.
func decode[T any](w http.ResponseWriter, r *http.Request, maxBodyBytes int64) (T, error) {
	var v T
	body, err := io.ReadAll(http.MaxBytesReader(w, r.Body, maxBodyBytes))
	if err != nil {
		var mbe *http.MaxBytesError
		if errors.As(err, &mbe) {
			return v, herr.New(r.Context(), domain.ErrPayloadTooLarge, herr.M{"message": "request body too large"})
		}
		return v, herr.New(r.Context(), domain.ErrBadRequest, herr.M{"message": "could not read the request body"}, err)
	}
	if err := json.Unmarshal(body, &v); err != nil {
		return v, herr.New(r.Context(), domain.ErrBadRequest, herr.M{"message": "invalid JSON body"})
	}
	return v, nil
}
