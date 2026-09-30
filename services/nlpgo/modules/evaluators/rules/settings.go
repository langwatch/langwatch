package rules

import (
	"encoding/json"
	"fmt"
	"reflect"
	"slices"
	"strings"
)

// SettingsField is one settings field as its struct tags declare it.
type SettingsField struct {
	Name        string
	Description string
	Described   bool
	Enum        []string
	Required    bool
	Index       []int
	Type        reflect.Type
}

// SettingsFields lists a settings model's tagged fields in declaration order;
// an embedded model's fields stand where it is embedded.
func SettingsFields(t reflect.Type) []SettingsField {
	var fields []SettingsField
	for _, f := range reflect.VisibleFields(t) {
		name, tagged := f.Tag.Lookup("json")
		if f.Anonymous || !f.IsExported() || !tagged {
			continue
		}
		field := SettingsField{Name: strings.Split(name, ",")[0], Index: f.Index, Type: f.Type}
		field.Description, field.Described = f.Tag.Lookup("desc")
		if enum, ok := f.Tag.Lookup("enum"); ok {
			field.Enum = strings.Split(enum, ",")
		}
		field.Required = f.Tag.Get("required") == "true"
		fields = append(fields, field)
	}
	return fields
}

// Defaulter is a nested model whose fields have defaults of their own, so a
// list element starts from them as pydantic's does.
type Defaulter interface{ Defaults() any }

// ModelDefaults is t's own defaults: its Defaults() when it declares them,
// else its zero value.
func ModelDefaults(t reflect.Type) reflect.Value {
	value := reflect.New(t).Elem()
	if defaulter, ok := value.Interface().(Defaulter); ok {
		value.Set(reflect.ValueOf(defaulter.Defaults()))
	}
	return value
}

// ParseSettings overlays raw settings on defaults as pydantic validates them:
// absent fields keep their defaults and unknown keys are ignored; a wrong
// JSON type, a value outside an enum's literal set or a missing required
// field is refused. The error names the field, never the value.
func ParseSettings[T any](raw json.RawMessage, defaults T) (T, error) {
	settings := defaults
	if !isPresentJSON(raw) {
		return settings, nil
	}
	err := decodeSettings(reflect.ValueOf(&settings).Elem(), raw, decodeAt{path: "settings"})
	return settings, err
}

// decodeAt is where a value sits: its path for errors and its literal set.
type decodeAt struct {
	path string
	enum []string
}

func decodeSettings(v reflect.Value, raw json.RawMessage, at decodeAt) error {
	if !isPresentJSON(raw) {
		if v.Kind() == reflect.Pointer {
			v.SetZero()
		}
		return nil
	}
	switch v.Kind() {
	case reflect.Struct:
		return decodeStruct(v, raw, at.path)
	case reflect.Slice:
		return decodeSlice(v, raw, at)
	case reflect.Pointer:
		target := reflect.New(v.Type().Elem())
		if err := decodeSettings(target.Elem(), raw, at); err != nil {
			return err
		}
		v.Set(target)
		return nil
	default:
		return decodeScalar(v, raw, at)
	}
}

func decodeStruct(v reflect.Value, raw json.RawMessage, path string) error {
	var object map[string]json.RawMessage
	if err := json.Unmarshal(raw, &object); err != nil {
		return fmt.Errorf("%s must be an object", path)
	}
	for _, field := range SettingsFields(v.Type()) {
		value, present := object[field.Name]
		if !present && field.Required {
			return fmt.Errorf("%s.%s is required", path, field.Name)
		}
		if !present {
			continue
		}
		if err := decodeSettings(v.FieldByIndex(field.Index), value, decodeAt{path: path + "." + field.Name, enum: field.Enum}); err != nil {
			return err
		}
	}
	return nil
}

func decodeSlice(v reflect.Value, raw json.RawMessage, at decodeAt) error {
	var items []json.RawMessage
	if err := json.Unmarshal(raw, &items); err != nil {
		return fmt.Errorf("%s must be a list", at.path)
	}
	list := reflect.MakeSlice(v.Type(), len(items), len(items))
	for i, item := range items {
		list.Index(i).Set(ModelDefaults(v.Type().Elem()))
		if err := decodeSettings(list.Index(i), item, decodeAt{path: fmt.Sprintf("%s[%d]", at.path, i), enum: at.enum}); err != nil {
			return err
		}
	}
	v.Set(list)
	return nil
}

func decodeScalar(v reflect.Value, raw json.RawMessage, at decodeAt) error {
	if err := json.Unmarshal(raw, v.Addr().Interface()); err != nil {
		return fmt.Errorf("%s has the wrong type", at.path)
	}
	if at.enum != nil && !slices.Contains(at.enum, fmt.Sprint(v.Interface())) {
		return fmt.Errorf("%s is not one of its allowed values", at.path)
	}
	return nil
}

// NoSettings is langevals' bare EvaluatorSettings: an evaluator without any.
type NoSettings struct{}

// ParseNoSettings accepts any object and ignores its keys, as pydantic does.
func ParseNoSettings(raw json.RawMessage) (NoSettings, error) {
	return ParseSettings(raw, NoSettings{})
}
