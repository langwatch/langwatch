// Package catalogue renders the evaluator definitions as the TypeScript
// catalogue the product and SDKs read (plan §7).
package catalogue

//go:generate go run ./cmd -out ../../../../../../modules/evaluator/contract/src/evaluators.generated.ts
// oxfmt skips *.generated.* files by config, so it formats this one through
// stdin under a plain name.
//go:generate sh -c "cd ../../../../../../modules/evaluator/contract/src && ../../../../node_modules/.bin/oxfmt --stdin-filepath=evaluators.ts < evaluators.generated.ts > evaluators.generated.ts.tmp && mv evaluators.generated.ts.tmp evaluators.generated.ts"

import (
	"fmt"
	"reflect"
	"regexp"
	"strconv"
	"strings"
	"unicode/utf16"

	"github.com/langwatch/langwatch/services/nlpgo/modules/evaluators/rules"
)

// The JavaScript values the catalogue is made of.
type (
	jsString   string // a string literal
	jsRaw      string // a number, a boolean or undefined
	jsTemplate string // a template literal
	jsArray    []any
	jsObject   []jsProp
	jsProp     struct {
		key   string
		value any
	}
	zodChain []zodCall // z.<method>(args).<method>(args)...
	zodCall  struct {
		method string
		args   []any
	}
)

func z(method string, args ...any) zodCall { return zodCall{method: method, args: args} }

// Render writes evaluators.generated.ts from the definitions as plain
// TypeScript, which go generate then formats with oxfmt.
func Render(definitions []rules.Definition) []byte {
	var schemas, entries jsObject
	for i := range definitions {
		definition := &definitions[i]
		defaults := reflect.ValueOf(definition.DefaultSettings)
		settings := jsObject{{"settings", settingsSchema(defaults)}}
		schemas = append(schemas, jsProp{definition.Slug, zodChain{z("object", settings)}})
		entries = append(entries, jsProp{definition.Slug, entry(definition, defaults)})
	}
	schemaSource := "const evaluatorsSchemaDefinition = " + source(zodChain{z("object", schemas)}, false) + ";"
	return []byte(fileHead + schemaSource + fileMiddle + "} = " + source(entries, true) + ";\n")
}

// settingsSchema is langevals' settings_to_zod.
func settingsSchema(defaults reflect.Value) zodChain {
	if len(rules.SettingsFields(defaults.Type())) == 0 {
		return zodChain{z("record", zodChain{z("string")}, zodChain{z("never")})}
	}
	return zodChain{z("object", fieldsSchema(defaults))}
}

func fieldsSchema(value reflect.Value) jsObject {
	var object jsObject
	for _, field := range rules.SettingsFields(value.Type()) {
		object = append(object, jsProp{field.Name, fieldSchema(field, value.FieldByIndex(field.Index))})
	}
	return object
}

// fieldSchema is langevals' field_to_zod: a nil default is `.optional()`.
func fieldSchema(field rules.SettingsField, value reflect.Value) zodChain {
	chain := typeSchema(field.Type, field.Enum, value)
	optional := field.Type.Kind() == reflect.Pointer
	withDefault := !field.Required && (!optional || !value.IsNil())
	if optional && !withDefault {
		chain = append(chain, z("optional"))
	}
	if field.Described {
		chain = append(chain, z("describe", jsString(strings.ReplaceAll(field.Description, "\n", ". "))))
	}
	if withDefault {
		chain = append(chain, z("default", jsValue(value)))
	}
	return chain
}

// typeSchema is langevals' field_annotation_to_zod. A nested model's field
// defaults come from value; a list element's from its own Defaults().
func typeSchema(t reflect.Type, enum []string, value reflect.Value) zodChain {
	if t.Kind() == reflect.Pointer {
		t, value = t.Elem(), pointee(t.Elem(), value)
	}
	if enum != nil && t.Kind() != reflect.Slice {
		return literalsSchema(t.Kind(), enum)
	}
	switch t.Kind() {
	case reflect.String:
		return zodChain{z("string")}
	case reflect.Bool:
		return zodChain{z("boolean")}
	case reflect.Int, reflect.Float64:
		return zodChain{z("number")}
	case reflect.Slice:
		return zodChain{z("array", typeSchema(t.Elem(), enum, rules.ModelDefaults(t.Elem())))}
	case reflect.Struct:
		return zodChain{z("object", fieldsSchema(value))}
	default:
		panic(fmt.Sprintf("catalogue: no zod type for %s", t))
	}
}

// pointee is what a pointer default points at, or t's zero when it is nil.
func pointee(t reflect.Type, pointer reflect.Value) reflect.Value {
	if pointer.IsNil() {
		return reflect.Zero(t)
	}
	return pointer.Elem()
}

// literalsSchema is a Literal[...] annotation: numbers unquoted.
func literalsSchema(kind reflect.Kind, enum []string) zodChain {
	literals := make(jsArray, len(enum))
	for i, literal := range enum {
		var arg any = jsString(literal)
		if kind != reflect.String {
			arg = jsRaw(literal)
		}
		literals[i] = zodChain{z("literal", arg)}
	}
	if len(literals) == 1 {
		return literals[0].(zodChain)
	}
	return zodChain{z("union", literals)}
}

// jsValue is a default as json.dumps writes it.
func jsValue(v reflect.Value) any {
	switch v.Kind() {
	case reflect.Pointer:
		if v.IsNil() {
			return jsRaw("undefined")
		}
		return jsValue(v.Elem())
	case reflect.Slice:
		items := make(jsArray, v.Len())
		for i := range items {
			items[i] = jsValue(v.Index(i))
		}
		return items
	case reflect.Struct:
		var object jsObject
		for _, field := range rules.SettingsFields(v.Type()) {
			object = append(object, jsProp{field.Name, jsValue(v.FieldByIndex(field.Index))})
		}
		return object
	default:
		return jsScalar(v)
	}
}

func jsScalar(v reflect.Value) any {
	switch v.Kind() {
	case reflect.String:
		return jsString(v.String())
	case reflect.Bool:
		return jsRaw(strconv.FormatBool(v.Bool()))
	case reflect.Int:
		return jsRaw(strconv.FormatInt(v.Int(), 10))
	case reflect.Float64:
		// ponytail: Python's repr, short of its exponent form above 1e16.
		number := strconv.FormatFloat(v.Float(), 'f', -1, 64)
		if !strings.Contains(number, ".") {
			number += ".0"
		}
		return jsRaw(number)
	default:
		panic(fmt.Sprintf("catalogue: no JavaScript value for %s", v.Type()))
	}
}

// entry is one AVAILABLE_EVALUATORS value, as generate_definitions writes it.
func entry(definition *rules.Definition, defaults reflect.Value) jsObject {
	var settings jsObject
	for _, field := range rules.SettingsFields(defaults.Type()) {
		var description any = jsRaw("undefined")
		if field.Described {
			description = jsString(field.Description)
		}
		settings = append(settings, jsProp{field.Name, jsObject{
			{"description", description},
			{"default", jsValue(defaults.FieldByIndex(field.Index))},
		}})
	}
	var result jsObject
	for _, described := range []jsProp{{"score", definition.Result.Score}, {"passed", definition.Result.Passed}, {"label", definition.Result.Label}} {
		if description := described.value.(string); description != "" {
			result = append(result, jsProp{described.key, jsObject{{"description", jsString(description)}}})
		}
	}
	return jsObject{
		{"name", jsTemplate(definition.Name)},
		{"description", jsTemplate(definition.Description)},
		{"category", jsString(definition.Category)},
		{"docsUrl", jsString(definition.DocsURL)},
		{"isGuardrail", jsRaw(strconv.FormatBool(definition.IsGuardrail))},
		{"requiredFields", stringArray(definition.RequiredFields)},
		{"optionalFields", stringArray(definition.OptionalFields)},
		{"settings", settings},
		{"envVars", stringArray(definition.EnvVars)},
		{"result", result},
	}
}

func stringArray(values []string) jsArray {
	items := make(jsArray, len(values))
	for i, value := range values {
		items[i] = jsString(value)
	}
	return items
}

var identifier = regexp.MustCompile(`^[A-Za-z_$][A-Za-z0-9_$]*$`)

// source writes a value as TypeScript for oxfmt to lay out.
func source(value any, expanded bool) string {
	switch v := value.(type) {
	case jsString:
		return `"` + escapeJSON(string(v)) + `"`
	case jsRaw:
		return string(v)
	case jsTemplate:
		return "`" + string(v) + "`"
	case jsArray:
		return "[" + sources(v, expanded) + "]"
	case jsObject:
		return objectSource(v, expanded)
	case zodChain:
		chain := "z"
		for _, call := range v {
			chain += "." + call.method + "(" + sources(call.args, expanded) + ")"
		}
		return chain
	default:
		panic(fmt.Sprintf("catalogue: no TypeScript for %T", value))
	}
}

// objectSource opens an expanded object's first key on a new line, which
// oxfmt keeps expanded, as json.dumps(indent=6) wrote the
// AVAILABLE_EVALUATORS table. Other objects stay on one line.
func objectSource(object jsObject, expanded bool) string {
	props := make([]string, len(object))
	for i, prop := range object {
		key := prop.key
		if !identifier.MatchString(key) {
			key = source(jsString(key), expanded)
		}
		props[i] = key + ": " + source(prop.value, expanded)
	}
	if expanded {
		return "{\n" + strings.Join(props, ",\n") + "\n}"
	}
	return "{ " + strings.Join(props, ", ") + " }"
}

func sources(values []any, expanded bool) string {
	written := make([]string, len(values))
	for i, value := range values {
		written[i] = source(value, expanded)
	}
	return strings.Join(written, ", ")
}

// escapeJSON is json.dumps' string body with ensure_ascii.
func escapeJSON(s string) string {
	escapes := map[rune]string{'"': `\"`, '\\': `\\`, '\n': `\n`, '\r': `\r`, '\t': `\t`, '\b': `\b`, '\f': `\f`}
	var escaped strings.Builder
	for _, r := range s {
		switch escape, ok := escapes[r]; {
		case ok:
			escaped.WriteString(escape)
		case r >= 0x20 && r <= 0x7e:
			escaped.WriteRune(r)
		case r > 0xffff:
			high, low := utf16.EncodeRune(r)
			fmt.Fprintf(&escaped, `\u%04x\u%04x`, high, low)
		default:
			fmt.Fprintf(&escaped, `\u%04x`, r)
		}
	}
	return escaped.String()
}
