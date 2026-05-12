package config

import (
	"fmt"
	"os"
	"reflect"
	"strconv"
)

// Hydrate populates cfg (a pointer to a struct) from environment variables.
// Fields are tagged with `env:"VAR_NAME"`. Nested structs chain prefixes with "_".
func Hydrate(cfg any) error {
	v := reflect.ValueOf(cfg)
	if v.Kind() != reflect.Pointer || v.Elem().Kind() != reflect.Struct {
		return fmt.Errorf("config.Hydrate: cfg must be a pointer to a struct")
	}
	return hydrateStruct(v.Elem(), v.Elem().Type(), "")
}

func hydrateStruct(v reflect.Value, t reflect.Type, prefix string) error {
	for i := range v.NumField() {
		field := v.Field(i)
		fieldType := t.Field(i)
		envTag := fieldType.Tag.Get("env")

		if envTag == "" {
			continue
		}

		if prefix != "" {
			envTag = prefix + "_" + envTag
		}

		switch field.Kind() {
		case reflect.Struct:
			if err := hydrateStruct(field, fieldType.Type, envTag); err != nil {
				return err
			}
		case reflect.Ptr, reflect.Slice:
			return fmt.Errorf("config.Hydrate: unsupported kind %s for field %s", field.Kind(), fieldType.Name)
		default:
			envValue := os.Getenv(envTag)
			if envValue == "" || !field.CanSet() {
				continue
			}
			if err := setField(field, envTag, envValue); err != nil {
				return err
			}
		}
	}
	return nil
}

func setField(field reflect.Value, tag, value string) error {
	switch field.Kind() {
	case reflect.String:
		field.SetString(value)
	case reflect.Int, reflect.Int8, reflect.Int16, reflect.Int32, reflect.Int64:
		v, err := strconv.ParseInt(value, 10, field.Type().Bits())
		if err != nil {
			return fmt.Errorf("config: failed to parse %s as int: %w", tag, err)
		}
		field.SetInt(v)
	case reflect.Uint, reflect.Uint8, reflect.Uint16, reflect.Uint32, reflect.Uint64:
		v, err := strconv.ParseUint(value, 10, field.Type().Bits())
		if err != nil {
			return fmt.Errorf("config: failed to parse %s as uint: %w", tag, err)
		}
		field.SetUint(v)
	case reflect.Float32, reflect.Float64:
		v, err := strconv.ParseFloat(value, field.Type().Bits())
		if err != nil {
			return fmt.Errorf("config: failed to parse %s as float: %w", tag, err)
		}
		field.SetFloat(v)
	case reflect.Bool:
		v, err := strconv.ParseBool(value)
		if err != nil {
			return fmt.Errorf("config: failed to parse %s as bool: %w", tag, err)
		}
		field.SetBool(v)
	default:
		return fmt.Errorf("config: unsupported field type %s", field.Kind())
	}
	return nil
}
