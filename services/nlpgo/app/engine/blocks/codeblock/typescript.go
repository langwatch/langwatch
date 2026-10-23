package codeblock

import (
	"context"
	"encoding/json"
	"fmt"
	"regexp"
	"strconv"
	"strings"

	"github.com/evanw/esbuild/pkg/api"
)

// LanguageTypeScript runs on the JavaScript guest once its types are erased.
// Types are never checked at run time; the editor checks them while you write.
const LanguageTypeScript = "typescript"

// strippedCode is a TypeScript code block as JavaScript, with the TypeScript
// line each JavaScript line came from.
type strippedCode struct {
	js    string
	lines []int
}

// executeTypeScript erases the code's types, runs it as JavaScript, and points
// the traceback back at the lines the author wrote.
func (e *Executor) executeTypeScript(ctx context.Context, req Request) (*Result, error) {
	if len(req.Code) > maxWasmPayloadBytes {
		return &Result{Error: &Error{Type: RunnerErrorType, Message: fmt.Sprintf("the code block's code and inputs exceed the %d MiB limit", maxWasmPayloadBytes>>20)}}, nil
	}
	stripped, failure := stripTypes(req.Code)
	if failure != nil {
		return &Result{Error: failure}, nil
	}
	req.Language, req.Code = LanguageJavaScript, stripped.js
	res, err := e.Execute(ctx, req)
	if res != nil && res.Error != nil {
		res.Error.Traceback = stripped.remap(res.Error.Traceback)
	}
	return res, err
}

// stripTypes erases TypeScript syntax with esbuild. It does not type-check:
// only code that does not parse is refused, as a SyntaxError at its line.
func stripTypes(code string) (strippedCode, *Error) {
	out := api.Transform(code, api.TransformOptions{
		Loader:     api.LoaderTS,
		Target:     api.ESNext,
		Sourcemap:  api.SourceMapExternal,
		Sourcefile: "code-block.ts",
		LogLevel:   api.LogLevelSilent,
	})
	if len(out.Errors) > 0 {
		first := out.Errors[0]
		failure := &Error{Type: "SyntaxError", Message: first.Text}
		if loc := first.Location; loc != nil {
			failure.Traceback = fmt.Sprintf("SyntaxError: %s\n    at code-block.ts:%d:%d", first.Text, loc.Line, loc.Column+1)
		}
		return strippedCode{}, failure
	}
	return strippedCode{js: string(out.Code), lines: sourceLines(out.Map)}, nil
}

var jsLocation = regexp.MustCompile(`code-block\.mjs:(\d+)(?::\d+)?`)

// remap rewrites code-block.mjs:<line> to the TypeScript line it came from.
func (s strippedCode) remap(traceback string) string {
	return jsLocation.ReplaceAllStringFunc(traceback, func(match string) string {
		line, err := strconv.Atoi(jsLocation.FindStringSubmatch(match)[1])
		if err != nil || line < 1 || line > len(s.lines) || s.lines[line-1] == 0 {
			return "code-block.ts"
		}
		return "code-block.ts:" + strconv.Itoa(s.lines[line-1])
	})
}

// sourceLines reads a source map's mappings: for each generated line, the
// 1-based source line of its first mapped segment, or 0 when it has none.
func sourceLines(sourceMap []byte) []int {
	var parsed struct {
		Mappings string `json:"mappings"`
	}
	if json.Unmarshal(sourceMap, &parsed) != nil {
		return nil
	}
	generated := strings.Split(parsed.Mappings, ";")
	lines := make([]int, len(generated))
	source := 0
	for i, segments := range generated {
		for _, segment := range strings.Split(segments, ",") {
			fields := decodeVLQ(segment)
			if len(fields) < 4 {
				continue
			}
			source += fields[2]
			if lines[i] == 0 {
				lines[i] = source + 1
			}
		}
	}
	return lines
}

const base64Digits = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/"

// decodeVLQ decodes one source-map segment into its signed fields.
func decodeVLQ(segment string) []int {
	var fields []int
	value, shift := 0, 0
	for _, c := range segment {
		digit := strings.IndexRune(base64Digits, c)
		if digit < 0 {
			return nil
		}
		value += (digit & 31) << shift
		if digit&32 != 0 {
			shift += 5
			continue
		}
		if value&1 != 0 {
			fields = append(fields, -(value >> 1))
		} else {
			fields = append(fields, value>>1)
		}
		value, shift = 0, 0
	}
	return fields
}
