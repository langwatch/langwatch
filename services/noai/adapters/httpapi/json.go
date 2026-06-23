package httpapi

import (
	"encoding/json"
	"errors"
	"io"
	"net/http"
)

// decodeJSON reads and unmarshals the request body into dst, capping the
// body at maxBody via http.MaxBytesReader (which short-circuits oversized
// reads at the transport). Empty, oversized, and malformed bodies all
// surface as errors the caller turns into a clean OpenAI-style 400.
func decodeJSON(w http.ResponseWriter, r *http.Request, maxBody int64, dst any) error {
	r.Body = http.MaxBytesReader(w, r.Body, maxBody)
	body, err := io.ReadAll(r.Body)
	if err != nil {
		return err
	}
	if len(body) == 0 {
		return errors.New("empty request body")
	}
	return json.Unmarshal(body, dst)
}

func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(v)
}

func writeError(w http.ResponseWriter, status int, code, message string) {
	writeJSON(w, status, map[string]any{
		"error": map[string]any{
			"message": message,
			"type":    code,
			"code":    code,
		},
	})
}
