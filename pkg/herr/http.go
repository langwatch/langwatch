package herr

import (
	"encoding/json"
	"errors"
	"net/http"
)

// StatusCode maps a herr Code to an HTTP status. Override with RegisterStatus.
var codeStatus = map[Code]int{}

// RegisterStatus maps a herr code to an HTTP status code.
// Call at init time to configure your app's error → status mapping.
func RegisterStatus(code Code, status int) {
	codeStatus[code] = status
}

// HTTPStatus returns the HTTP status for an error. If the error is a herr.E
// with a registered code, returns that status. Otherwise returns 500.
func HTTPStatus(err error) int {
	var e E
	if errors.As(err, &e) {
		if status, ok := codeStatus[e.Code]; ok {
			return status
		}
	}
	return http.StatusInternalServerError
}

// ErrorResponse is the standard JSON error envelope.
type ErrorResponse struct {
	Error ErrorBody `json:"error"`
}

// ErrorBody is the error detail within the envelope.
type ErrorBody struct {
	Type    string `json:"type"`
	Message string `json:"message"`
}

// WriteHTTP writes an error as a JSON response. If the error is a herr.E,
// uses its code as the type and looks up the HTTP status. Otherwise writes
// a generic 500 with code "unknown".
func WriteHTTP(w http.ResponseWriter, err error) {
	var e E
	if !errors.As(err, &e) {
		e = E{Code: "unknown", Meta: M{"error": err.Error()}}
	}

	status := http.StatusInternalServerError
	if s, ok := codeStatus[e.Code]; ok {
		status = s
	}

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(ErrorResponse{
		Error: ErrorBody{
			Type:    string(e.Code),
			Message: e.Error(),
		},
	})
}
