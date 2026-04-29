package herr

import (
	"context"
	"fmt"

	"github.com/go-playground/validator/v10"
)

// Violation describes a single field that failed validation.
type Violation struct {
	Field   string `json:"field"`
	Tag     string `json:"tag,omitempty"`
	Rule    string `json:"rule"`
	Message string `json:"message"`
}

// PathResolver maps a validator field namespace (e.g. "Config.Server.Addr") to
// a human-friendly identifier (e.g. "GATEWAY_SERVER_ADDR"). Return "" to omit.
type PathResolver func(namespace string) string

// FromValidationErrors converts go-playground/validator errors into a herr.E.
// The code determines the error type. pathResolver is optional — when provided,
// its output populates Violation.Tag for each field.
func FromValidationErrors(ctx context.Context, code Code, ve validator.ValidationErrors, pathResolver PathResolver) E {
	violations := make([]Violation, 0, len(ve))
	for _, fe := range ve {
		field := stripRootNamespace(fe.StructNamespace())

		v := Violation{
			Field:   field,
			Rule:    fe.Tag(),
			Message: defaultMessage(fe),
		}
		if pathResolver != nil {
			v.Tag = pathResolver(field)
		}
		violations = append(violations, v)
	}

	msg := fmt.Sprintf("%d validation violation(s)", len(violations))
	return New(ctx, code, M{
		"message":    msg,
		"violations": violations,
	})
}

func stripRootNamespace(ns string) string {
	for i := range len(ns) {
		if ns[i] == '.' {
			return ns[i+1:]
		}
	}
	return ns
}

func defaultMessage(fe validator.FieldError) string {
	switch fe.Tag() {
	case "required":
		return "field is required"
	case "url":
		return "must be a valid URL"
	case "min":
		return fmt.Sprintf("minimum value is %s", fe.Param())
	case "max":
		return fmt.Sprintf("maximum value is %s", fe.Param())
	case "oneof":
		return fmt.Sprintf("must be one of: %s", fe.Param())
	default:
		return fmt.Sprintf("failed %s validation", fe.Tag())
	}
}
