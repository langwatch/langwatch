package config

import (
	"errors"
	"fmt"
	"os"
	"reflect"
	"strconv"
	"strings"

	"github.com/go-playground/validator/v10"
	"go.uber.org/zap"
)

// loadEnv populates struct fields from environment variables using struct tags.
// Tags: `env:"VAR_NAME"`, `default:"value"`.
// Supported types: string, bool, int, int64, float64, *bool.
func loadEnv(target any) error {
	v := reflect.ValueOf(target).Elem()
	t := v.Type()

	for i := range t.NumField() {
		field := t.Field(i)
		envKey := field.Tag.Get("env")
		if envKey == "" {
			continue
		}

		raw := os.Getenv(envKey)
		if raw == "" {
			raw = field.Tag.Get("default")
		}
		if raw == "" {
			continue
		}

		if err := setField(v.Field(i), raw); err != nil {
			return fmt.Errorf("%s: %w", envKey, err)
		}
	}
	return nil
}

// validate is a singleton validator that uses env tags for field names.
var validate = newValidator()

func newValidator() *validator.Validate {
	v := validator.New()
	v.RegisterTagNameFunc(func(fld reflect.StructField) string {
		if name := fld.Tag.Get("env"); name != "" {
			return name
		}
		return fld.Name
	})
	return v
}

// validateStruct validates struct fields using `validate` tags via go-playground/validator.
func validateStruct(target any) []string {
	err := validate.Struct(target)
	if err == nil {
		return nil
	}
	var ve validator.ValidationErrors
	if errors.As(err, &ve) {
		var errs []string
		for _, e := range ve {
			errs = append(errs, fmt.Sprintf("%s: failed %s validation (value: %v)", e.Field(), e.Tag(), e.Value()))
		}
		return errs
	}
	return []string{err.Error()}
}

// sensitiveEnvKeys contains env var names whose values must not be logged.
var sensitiveEnvKeys = map[string]bool{
	"CLICKHOUSE_PASSWORD": true,
	"S3_ACCESS_KEY":       true,
	"S3_SECRET_KEY":       true,
	"AZURE_STORAGE_KEY":   true,
}

// ApplyEnvOverrides reads env vars matching `env` tags on a struct and overwrites values.
// Invalid values are logged as warnings and skipped. Sensitive values are redacted.
func ApplyEnvOverrides(log *zap.Logger, target any) {
	v := reflect.ValueOf(target).Elem()
	t := v.Type()

	for i := range t.NumField() {
		field := t.Field(i)
		envKey := field.Tag.Get("env")
		if envKey == "" {
			continue
		}
		raw := os.Getenv(envKey)
		if raw == "" {
			continue
		}
		if err := setField(v.Field(i), raw); err != nil {
			logValue := raw
			if sensitiveEnvKeys[envKey] {
				logValue = "***"
			}
			log.Warn("ignoring invalid env override", zap.String("var", envKey), zap.String("value", logValue), zap.Error(err))
		}
	}
}

func setField(fv reflect.Value, raw string) error {
	switch fv.Kind() {
	case reflect.String:
		fv.SetString(raw)
	case reflect.Bool:
		b, err := parseBool(raw)
		if err != nil {
			return err
		}
		fv.SetBool(b)
	case reflect.Int, reflect.Int64:
		n, err := strconv.ParseInt(raw, 10, 64)
		if err != nil {
			return err
		}
		fv.SetInt(n)
	case reflect.Float64:
		n, err := strconv.ParseFloat(raw, 64)
		if err != nil {
			return err
		}
		fv.SetFloat(n)
	case reflect.Ptr:
		if fv.Type().Elem().Kind() == reflect.Bool {
			b, err := parseBool(raw)
			if err != nil {
				return err
			}
			fv.Set(reflect.ValueOf(&b))
		} else {
			return fmt.Errorf("unsupported type *%s", fv.Type().Elem().Kind())
		}
	default:
		return fmt.Errorf("unsupported type %s", fv.Kind())
	}
	return nil
}

func parseBool(raw string) (bool, error) {
	switch strings.ToLower(raw) {
	case "true", "1", "yes":
		return true, nil
	case "false", "0", "no":
		return false, nil
	default:
		return false, fmt.Errorf("invalid boolean %q (use true/false/1/0/yes/no)", raw)
	}
}
