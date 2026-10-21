// Package catalogue renders the evaluator definitions as the TypeScript
// catalogue the product and SDKs read (plan §7).
package catalogue

//go:generate go run ./cmd -out ../../../../../../modules/evaluator/contract/src/evaluators.generated.ts

import (
	"fmt"
	"reflect"
	"regexp"
	"strconv"
	"strings"
	"unicode/utf16"
	"unicode/utf8"

	"github.com/langwatch/langwatch/services/nlpgo/modules/evaluators/rules"
)

// The JavaScript values the catalogue is made of.
type (
	jsString   string // a string literal
	jsRaw      string // a number, a boolean or undefined
	jsTemplate string // a template literal
	jsArray    []any
	jsObject   struct {
		props []jsProp
		hard  bool // broken whatever its width, as a multi-line source object
	}
	jsProp struct {
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

// Render lays out evaluators.generated.ts from the definitions, as oxfmt does
// at 100 columns.
func Render(definitions []rules.Definition) []byte {
	schemas := &jsObject{hard: true}
	entries := &jsObject{hard: true}
	for i := range definitions {
		definition := &definitions[i]
		defaults := reflect.ValueOf(definition.DefaultSettings)
		settings := &jsObject{props: []jsProp{{"settings", settingsSchema(defaults)}}}
		schemas.props = append(schemas.props, jsProp{definition.Slug, zodChain{z("object", settings)}})
		entries.props = append(entries.props, jsProp{definition.Slug, entry(definition, defaults)})
	}
	var p printer
	schemaDoc := concat(text("const evaluatorsSchemaDefinition = "), p.node(zodChain{z("object", schemas)}), text(";"))
	entriesDoc := concat(text("} = "), p.node(entries), text(";"))
	return []byte(fileHead + layout(schemaDoc, 100) + fileMiddle + layout(entriesDoc, 100) + "\n")
}

// settingsSchema is langevals' settings_to_zod.
func settingsSchema(defaults reflect.Value) zodChain {
	if len(rules.SettingsFields(defaults.Type())) == 0 {
		return zodChain{z("record", zodChain{z("string")}, zodChain{z("never")})}
	}
	return zodChain{z("object", fieldsSchema(defaults))}
}

func fieldsSchema(value reflect.Value) *jsObject {
	object := &jsObject{}
	for _, field := range rules.SettingsFields(value.Type()) {
		object.props = append(object.props, jsProp{field.Name, fieldSchema(field, value.FieldByIndex(field.Index))})
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
		chain = append(chain, z("default", jsValue(value, false)))
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

// jsValue is a default as json.dumps writes it; hard objects are the ones
// json.dumps(indent=6) spreads over lines.
func jsValue(v reflect.Value, hard bool) any {
	switch v.Kind() {
	case reflect.Pointer:
		if v.IsNil() {
			return jsRaw("undefined")
		}
		return jsValue(v.Elem(), hard)
	case reflect.Slice:
		items := make(jsArray, v.Len())
		for i := range items {
			items[i] = jsValue(v.Index(i), hard)
		}
		return items
	case reflect.Struct:
		object := &jsObject{hard: hard}
		for _, field := range rules.SettingsFields(v.Type()) {
			object.props = append(object.props, jsProp{field.Name, jsValue(v.FieldByIndex(field.Index), hard)})
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
func entry(definition *rules.Definition, defaults reflect.Value) *jsObject {
	settings := &jsObject{hard: true}
	for _, field := range rules.SettingsFields(defaults.Type()) {
		var description any = jsRaw("undefined")
		if field.Described {
			description = jsString(field.Description)
		}
		settings.props = append(settings.props, jsProp{field.Name, &jsObject{hard: true, props: []jsProp{
			{"description", description},
			{"default", jsValue(defaults.FieldByIndex(field.Index), true)},
		}}})
	}
	result := &jsObject{hard: true}
	for _, described := range []jsProp{{"score", definition.Result.Score}, {"passed", definition.Result.Passed}, {"label", definition.Result.Label}} {
		if description := described.value.(string); description != "" {
			result.props = append(result.props, jsProp{described.key, &jsObject{hard: true, props: []jsProp{{"description", jsString(description)}}}})
		}
	}
	return &jsObject{hard: true, props: []jsProp{
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
	}}
}

func stringArray(values []string) jsArray {
	items := make(jsArray, len(values))
	for i, value := range values {
		items[i] = jsString(value)
	}
	return items
}

// printer turns catalogue values into layout documents the way prettier's
// estree printer does, for the shapes the catalogue uses.
type printer struct{}

func (p printer) node(value any) *doc {
	switch v := value.(type) {
	case jsString:
		return text(quoteJS(string(v)))
	case jsRaw:
		return text(string(v))
	case jsTemplate:
		lines := strings.Split(string(v), "\n")
		docs := make([]*doc, len(lines))
		for i, segment := range lines {
			docs[i] = text(segment)
		}
		return concat(text("`"), join(literalline, docs), text("`"))
	case jsArray:
		return p.array(v)
	case *jsObject:
		return p.object(v)
	case zodChain:
		return p.chain(v)
	default:
		panic(fmt.Sprintf("catalogue: no layout for %T", value))
	}
}

func (p printer) nodes(values []any) []*doc {
	docs := make([]*doc, len(values))
	for i, value := range values {
		docs[i] = p.node(value)
	}
	return docs
}

func (p printer) array(items jsArray) *doc {
	if len(items) == 0 {
		return text("[]")
	}
	elements := join(concat(text(","), line), p.nodes(items))
	return group(concat(text("["), indent(concat(softline, elements, ifBreak(text(","), nil))), softline, text("]")), breaksArray(items))
}

// breaksArray is prettier's rule: two or more objects of two or more keys
// each always break.
func breaksArray(items jsArray) bool {
	for _, item := range items {
		if object, ok := item.(*jsObject); !ok || len(object.props) < 2 {
			return false
		}
	}
	return len(items) > 1
}

func (p printer) object(object *jsObject) *doc {
	if len(object.props) == 0 {
		return text("{}")
	}
	props := make([]*doc, len(object.props))
	for i, prop := range object.props {
		props[i] = p.property(prop)
	}
	members := join(concat(text(","), line), props)
	return group(concat(text("{"), indent(concat(line, members, ifBreak(text(","), nil))), line, text("}")), object.hard)
}

var identifier = regexp.MustCompile(`^[A-Za-z_$][A-Za-z0-9_$]*$`)

// property is prettier's assignment layout: a string value under a key of
// five or more characters breaks after the colon; anything else stays on it.
func (p printer) property(prop jsProp) *doc {
	key := prop.key
	if !identifier.MatchString(key) {
		key = quoteJS(key)
	}
	value := p.node(prop.value)
	if _, isString := prop.value.(jsString); isString && utf8.RuneCountInString(key) >= 5 {
		return group(concat(text(key+":"), group(indent(concat(line, value)), false)), false)
	}
	return group(concat(text(key+": "), value), false)
}

// chain is prettier's member chain: one call stays on its line; more print
// on one line when they fit, else one call per line.
func (p printer) chain(chain zodChain) *doc {
	calls := make([]*doc, len(chain))
	for i, call := range chain {
		calls[i] = concat(text("."+call.method), p.arguments(call.args))
	}
	oneLine := concat(append([]*doc{text("z")}, calls...)...)
	if len(chain) == 1 {
		return group(oneLine, false)
	}
	expanded := concat(text("z"), indent(group(concat(hardline, join(hardline, calls)), false)))
	if (len(chain) > 2 && !simpleArguments(chain)) || anyWillBreak(calls[:len(calls)-1]) {
		return group(expanded, false)
	}
	if willBreak(oneLine) {
		return concat(breakParent, conditionalGroup(oneLine, expanded))
	}
	return conditionalGroup(oneLine, expanded)
}

// arguments is prettier's call arguments: a last object or array argument
// hugs the parentheses when the rest fits.
func (p printer) arguments(args []any) *doc {
	if len(args) == 0 {
		return text("()")
	}
	docs := p.nodes(args)
	last := len(args) - 1
	if !huggable(args[last]) || (last > 0 && reflect.TypeOf(args[last-1]) == reflect.TypeOf(args[last])) {
		return group(concat(text("("), indent(concat(softline, join(concat(text(","), line), docs))), ifBreak(text(","), nil), softline, text(")")), false)
	}
	allFlat := concat(text("("), join(text(", "), docs), text(")"))
	hugged := concat(text("("), join(text(", "), append(docs[:last:last], group(docs[last], true))), text(")"))
	allBroken := group(concat(text("("), indent(concat(line, join(concat(text(","), line), docs))), text(","), line, text(")")), true)
	if anyWillBreak(docs) {
		return concat(breakParent, conditionalGroup(allFlat, hugged, allBroken))
	}
	return conditionalGroup(allFlat, hugged, allBroken)
}

func huggable(arg any) bool {
	switch v := arg.(type) {
	case *jsObject:
		return len(v.props) > 0
	case jsArray:
		return len(v) > 0
	}
	return false
}

func anyWillBreak(docs []*doc) bool {
	for _, d := range docs {
		if willBreak(d) {
			return true
		}
	}
	return false
}

// simpleArguments is whether every call's arguments are simple, as
// prettier's member chain asks before keeping a long chain on one line.
func simpleArguments(chain zodChain) bool {
	for _, call := range chain {
		if !allSimple(call.args, 0) {
			return false
		}
	}
	return true
}

// simpleCalls is prettier's isSimpleCallArgument for a chain used as an
// argument: its calls may take no more arguments than the depth.
func simpleCalls(chain zodChain, depth int) bool {
	for _, call := range chain {
		if len(call.args) > depth || !allSimple(call.args, depth+1) {
			return false
		}
	}
	return true
}

func isSimple(value any, depth int) bool {
	switch v := value.(type) {
	case jsString, jsRaw:
		return true
	case jsTemplate:
		return !strings.Contains(string(v), "\n")
	case jsArray:
		return allSimple(v, depth+1)
	case *jsObject:
		values := make([]any, len(v.props))
		for i, prop := range v.props {
			values[i] = prop.value
		}
		return allSimple(values, depth+1)
	case zodChain:
		return simpleCalls(v, depth)
	}
	return false
}

func allSimple(values []any, depth int) bool {
	for _, value := range values {
		if !isSimple(value, depth) {
			return false
		}
	}
	return true
}

// quoteJS writes s as json.dumps does (ASCII only), then in the quotes
// prettier prefers: double, unless the text holds more of them than singles.
func quoteJS(s string) string {
	raw := escapeJSON(s)
	if strings.Count(raw, `"`) <= strings.Count(raw, "'") {
		return `"` + raw + `"`
	}
	return singleQuoted(raw)
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

// singleQuoted is prettier's makeString into single quotes.
func singleQuoted(raw string) string {
	var single strings.Builder
	for i := 0; i < len(raw); i++ {
		switch {
		case raw[i] == '\\' && raw[i+1] == '"':
			single.WriteByte('"')
			i++
		case raw[i] == '\\':
			single.WriteString(raw[i : i+2])
			i++
		case raw[i] == '\'':
			single.WriteString(`\'`)
		default:
			single.WriteByte(raw[i])
		}
	}
	return "'" + single.String() + "'"
}
