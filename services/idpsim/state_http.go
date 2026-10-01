package idpsim

import (
	"bytes"
	"fmt"
	"net/http"
	"os"
)

// Persist before acknowledging a mutation; SIGKILL never runs shutdown hooks.
// Login codes and access grants remain short-lived, in-memory protocol state.
func (s *Server) persistChanges(next http.Handler) http.Handler {
	if s.persistence == nil {
		return next
	}
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method == http.MethodGet || r.Method == http.MethodHead || r.Method == http.MethodOptions {
			next.ServeHTTP(w, r)
			return
		}
		response := &stateResponse{header: make(http.Header)}
		next.ServeHTTP(response, r)
		if err := s.saveState(); err != nil {
			fmt.Fprintln(os.Stderr, err)
			http.Error(w, "could not persist IdP changes; check the simulator log", http.StatusInternalServerError)
			return
		}
		for key, values := range response.header {
			w.Header()[key] = values
		}
		status := response.status
		if status == 0 {
			status = http.StatusOK
		}
		w.WriteHeader(status)
		_, _ = w.Write(response.body.Bytes())
	})
}

type stateResponse struct {
	header http.Header
	status int
	body   bytes.Buffer
}

func (r *stateResponse) Header() http.Header { return r.header }

func (r *stateResponse) WriteHeader(status int) {
	if r.status == 0 {
		r.status = status
	}
}

func (r *stateResponse) Write(body []byte) (int, error) {
	r.WriteHeader(http.StatusOK)
	return r.body.Write(body)
}
