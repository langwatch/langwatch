package rpc

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"strings"

	"github.com/go-playground/validator/v10"
	"go.uber.org/zap"

	"github.com/langwatch/langwatch/pkg/clog"
	"github.com/langwatch/langwatch/pkg/herr"
	"github.com/langwatch/langwatch/services/langyagent/domain"
)

// validate is the shared struct validator for RPC bodies. Safe for concurrent
// use and caches struct reflection, so it is built once.
var validate = validator.New()

// decode reads, size-caps, JSON-decodes, AND struct-validates an RPC request body
// into T — the one place body-read + MaxBytes + Unmarshal + shape validation live,
// so a handler reads decode → delegate. Every returned error is already a herr
// ready for herr.WriteHTTP: ErrPayloadTooLarge (over cap), ErrBadRequest (read or
// JSON failure), or the field-naming ErrBadRequest from validateStruct (a
// `validate:"required"` tag failed). The raw cause rides in the herr reasons
// (logged by the telemetry middleware, never surfaced). MaxBytesReader needs w to
// reset the connection on overflow, so it is threaded through.
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
	if err := validateStruct(r.Context(), v); err != nil {
		return v, err
	}
	return v, nil
}

// validateStruct checks v against its `validate` tags and, on failure, returns a
// herr(ErrBadRequest) that NAMES the offending fields for internal diagnostics
// (logged + carried in Meta) while the user-facing message stays generic — the
// raw validator error is never surfaced. This is the validation-error shape the
// control plane's domain-error handling already expects.
func validateStruct(ctx context.Context, v any) error {
	err := validate.Struct(v)
	if err == nil {
		return nil
	}
	ve, ok := err.(validator.ValidationErrors)
	if !ok {
		// Non-field validator failure (a misconfigured tag). Keep the detail in a
		// logged reason; the client still gets a generic message.
		return herr.New(ctx, domain.ErrBadRequest, herr.M{"message": "the request body was invalid"}, err)
	}
	fields := make([]string, 0, len(ve))
	for _, fe := range ve {
		fields = append(fields, validationFieldPath(fe))
	}
	clog.Get(ctx).Warn("request validation failed", zap.Strings("fields", fields))
	return herr.New(ctx, domain.ErrBadRequest, herr.M{
		"message": "the request was missing or contained invalid required fields",
		"fields":  fields,
	})
}

// validationFieldPath renders a validator field error as its struct path with the
// root type stripped (e.g. "Credentials.LangwatchAPIKey"), naming exactly which
// part of the schema failed.
func validationFieldPath(fe validator.FieldError) string {
	ns := fe.StructNamespace()
	if i := strings.IndexByte(ns, '.'); i >= 0 {
		return ns[i+1:]
	}
	return ns
}
