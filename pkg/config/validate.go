package config

import (
	"context"
	"reflect"
	"strings"

	"github.com/go-playground/validator/v10"

	"github.com/langwatch/langwatch/pkg/herr"
)

// ConfigInvalid is the herr code for configuration validation failures.
const ConfigInvalid herr.Code = "config_invalid"

// Validate checks struct fields tagged with `validate:"..."` and returns a
// herr.E with structured violations on failure. The env var path is resolved
// from `env` struct tags chained with "_" for nested structs.
func Validate(ctx context.Context, cfg any) error {
	v := validator.New()

	err := v.Struct(cfg)
	if err == nil {
		return nil
	}

	ve, ok := err.(validator.ValidationErrors)
	if !ok {
		return err
	}

	resolver := envPathResolver(reflect.TypeOf(cfg), "")
	return herr.FromValidationErrors(ctx, ConfigInvalid, ve, func(field string) string {
		return resolver[field]
	})
}

// envPathResolver builds a map from "FieldA.FieldB" → "PREFIX_A_PREFIX_B"
// by walking env struct tags.
func envPathResolver(t reflect.Type, prefix string) map[string]string {
	if t.Kind() == reflect.Ptr {
		t = t.Elem()
	}

	index := make(map[string]string)
	for i := range t.NumField() {
		field := t.Field(i)
		envTag := field.Tag.Get("env")
		if envTag == "" {
			continue
		}

		fullEnv := envTag
		if prefix != "" {
			fullEnv = prefix + "_" + envTag
		}

		if field.Type.Kind() == reflect.Struct {
			for k, v := range envPathResolver(field.Type, fullEnv) {
				index[field.Name+"."+k] = v
			}
		} else {
			index[field.Name] = fullEnv
		}
	}
	return index
}

// EnvVarName resolves the full environment variable name for a dotted field path
// (e.g. "ControlPlane.BaseURL" → "GATEWAY_CONTROL_PLANE_BASE_URL").
func EnvVarName(cfg any, fieldPath string) string {
	resolver := envPathResolver(reflect.TypeOf(cfg), "")
	return resolver[fieldPath]
}

// SnakeToEnv converts a dotted Go field path to approximate env-style for display.
// This is a fallback when env tags aren't available.
func SnakeToEnv(fieldPath string) string {
	return strings.ReplaceAll(fieldPath, ".", "_")
}
