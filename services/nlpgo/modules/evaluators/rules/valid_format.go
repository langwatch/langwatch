package rules

import (
	"errors"
	"regexp"
	"strings"

	"github.com/go-python/gpython/parser"
	"github.com/go-python/gpython/py"
	"github.com/santhosh-tekuri/jsonschema/v6"
	"github.com/xwb1989/sqlparser"
)

// FormatVerdict is valid_format's answer for one output. ErrorType set means
// langevals answered an error, not a verdict; Unscored means it failed the
// output without a score.
type FormatVerdict struct {
	Passed    bool
	Unscored  bool
	Details   string
	ErrorType string
}

// FormatAtParity says whether a valid_format mode answers as langevals did on
// every recorded case. python and sql are best effort (plan D15).
func FormatAtParity(format string) bool {
	return format == "json" || format == "markdown"
}

// ValidFormat ports langevals_langevals/valid_format.py for a non-empty
// output; an empty one is skipped before this runs.
func ValidFormat(output string, settings ValidFormatSettings) FormatVerdict {
	switch settings.Format {
	case "markdown":
		return validMarkdown(output)
	case "python":
		return validPython(output)
	case "sql":
		return validSQL(output)
	default:
		return validJSON(output, derefOr(settings.JSONSchema, ""))
	}
}

func failed(details string) FormatVerdict { return FormatVerdict{Details: details} }

func validJSON(output, schemaText string) FormatVerdict {
	instance, err := jsonschema.UnmarshalJSON(strings.NewReader(output))
	if err != nil {
		return failed("Invalid JSON: " + err.Error())
	}
	if schemaText == "" {
		return FormatVerdict{Passed: true}
	}
	schemaDoc, err := jsonschema.UnmarshalJSON(strings.NewReader(schemaText))
	if err != nil {
		return FormatVerdict{Details: "Invalid JSON Schema: " + err.Error(), ErrorType: "json_schema_error"}
	}
	compiler := jsonschema.NewCompiler()
	compiler.UseLoader(refuseLoader{})
	const location = "urn:langevals:json_schema"
	if err := compiler.AddResource(location, schemaDoc); err != nil {
		return FormatVerdict{Details: err.Error(), ErrorType: "SchemaError"}
	}
	schema, err := compiler.Compile(location)
	if err != nil {
		return FormatVerdict{Details: err.Error(), ErrorType: "SchemaError"}
	}
	if err := schema.Validate(instance); err != nil {
		return failed("JSON Schema validation failed: " + err.Error())
	}
	return FormatVerdict{Passed: true}
}

// refuseLoader keeps a tenant's $ref off the server's files and network;
// Python's jsonschema retrieves no remote reference by default either.
type refuseLoader struct{}

func (refuseLoader) Load(url string) (any, error) {
	return nil, errors.New("unresolvable reference: " + url)
}

// markdownRenders approximates Python-Markdown's "the HTML differs from the
// text" check: escaped characters, inline markup, and blocks that open at the
// start of the text or after a blank line.
// ponytail: a pattern heuristic, not a renderer; goldmark if cases drift.
const markdownRenders = "[`<>&]" +
	`|\\[\\` + "`" + `*_{}\[\]()#+\-.!]` +
	`|\*[^*\n]+\*` +
	`|(?:^|\W)_[^_\n]+_(?:\W|$)` +
	`|\[[^\]\n]*\] ?[(\[]` +
	`|(?m:^ {0,3}\[[^\]\n]+\]:[ \t]*\S)` +
	`|(?m:^#)` +
	`|(?:\A|\n[ \t]*\n) {0,3}(?:[*+-]|\d+\.)[ \t]+\S` +
	`|(?:\A|\n[ \t]*\n)(?: {4}|\t)[ \t]*\S` +
	`|(?m:^ {0,3}[-*_](?: *[-*_]){2,} *$)` +
	`|\S[^\n]*\n *(?:=+|-+) *(?:\n|$)` +
	`|\S {2,}\n[ \t]*\S`

var markdownRendersRe = regexp.MustCompile(markdownRenders)

func validMarkdown(output string) FormatVerdict {
	if markdownRendersRe.MatchString(output) {
		return FormatVerdict{Passed: true}
	}
	return FormatVerdict{Unscored: true, Details: "No markdown elements found. Text should contain markdown formatting like headers (#), bold (**), lists, etc."}
}

// validPython parses with gpython, a Python 3.4 grammar: newer syntax
// (f-strings, walrus, match) is refused where CPython accepts it.
func validPython(output string) FormatVerdict {
	if _, err := parser.ParseString(output, py.ExecMode); err != nil {
		return failed("Invalid Python: " + err.Error())
	}
	return FormatVerdict{Passed: true}
}

// validSQL refuses JSON first, then parses each statement with a MySQL
// grammar, stricter than sqlglot's default dialect.
func validSQL(output string) FormatVerdict {
	if _, err := jsonschema.UnmarshalJSON(strings.NewReader(output)); err == nil {
		return FormatVerdict{Unscored: true, Details: "Invalid SQL: Detected JSON instead of SQL string"}
	}
	statements, err := sqlparser.SplitStatementToPieces(output)
	if err != nil {
		return failed("Invalid SQL: " + err.Error())
	}
	for _, statement := range statements {
		if strings.TrimSpace(statement) == "" {
			continue
		}
		if _, err := sqlparser.Parse(statement); err != nil {
			return failed("Invalid SQL: " + err.Error())
		}
	}
	return FormatVerdict{Passed: true}
}
