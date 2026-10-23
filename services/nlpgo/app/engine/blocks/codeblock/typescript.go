package codeblock

import (
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

// maxTypeScriptBytes bounds TypeScript source. esbuild parses in the engine,
// outside the sandbox, and its stack grows with nesting: 64 KiB of the worst
// nesting stays near 200 MiB, inside the run's admitted memory.
const maxTypeScriptBytes = 64 << 10

// erasedTypes turns a TypeScript request into the JavaScript it runs as. It is
// called once the run is admitted, so concurrent parses share the memory budget.
func erasedTypes(req *Request) (*strippedCode, *Error) {
	if req.Language != LanguageTypeScript {
		return nil, nil
	}
	if len(req.Code) > maxTypeScriptBytes {
		return nil, &Error{Type: RunnerErrorType, Message: fmt.Sprintf("TypeScript code blocks are limited to %d KB; use JavaScript for longer code", maxTypeScriptBytes>>10)}
	}
	stripped, failure := stripTypes(req.Code)
	if failure != nil {
		return nil, failure
	}
	req.Language, req.Code = LanguageJavaScript, stripped.js
	return &stripped, nil
}

// remapResult points a traceback back at the TypeScript lines; nil leaves it be.
func (s *strippedCode) remapResult(res *Result) *Result {
	if s != nil && res != nil && res.Error != nil {
		res.Error.Traceback = s.remap(res.Error.Traceback)
	}
	return res
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
