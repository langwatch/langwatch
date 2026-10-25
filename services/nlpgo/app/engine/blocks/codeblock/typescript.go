package codeblock

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"regexp"
	"strconv"
	"strings"

	"github.com/tetratelabs/wazero"
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

// maxTypeScriptBytes bounds TypeScript source; esbuild's parser can take time
// quadratic in it, which the run's deadline then cuts short.
const maxTypeScriptBytes = 64 << 10

// maxStrippedBytes bounds what tsstrip hands back: the JavaScript and its map.
const maxStrippedBytes = 2 << 20

// erasedTypes turns a TypeScript request into the JavaScript it runs as. The
// erasure runs in its own wasm instance under ctx, once the run is admitted.
func (w *wasmRuntime) erasedTypes(ctx context.Context, req *Request) (*strippedCode, *Error) {
	if req.Language != LanguageTypeScript {
		return nil, nil
	}
	if len(req.Code) > maxTypeScriptBytes {
		return nil, &Error{Type: RunnerErrorType, Message: fmt.Sprintf("TypeScript code blocks are limited to %d KB; use JavaScript for longer code", maxTypeScriptBytes>>10)}
	}
	stripped, failure := w.stripTypes(ctx, req.Code)
	if failure != nil {
		return nil, failure
	}
	req.Language, req.Code = LanguageJavaScript, stripped.js
	return &stripped, nil
}

// remapResult points a traceback back at the TypeScript lines; nil leaves it be.
func (s *strippedCode) remapResult(res *Result) *Result {
	if s != nil && res != nil && res.Error != nil {
		traceback := res.Error.Traceback
		if len(traceback) > maxRemappedTraceback {
			traceback = strings.ToValidUTF8(traceback[:maxRemappedTraceback], "")
		}
		res.Error.Traceback = s.remap(traceback)
	}
	return res
}

// maxRemappedTraceback bounds the traceback remap rewrites; the guest writes
// the traceback, so its length is the customer's to choose.
const maxRemappedTraceback = 64 << 10

// stripTypes erases TypeScript syntax with tsstrip. It does not type-check:
// only code that does not parse is refused, as a SyntaxError at its line.
func (w *wasmRuntime) stripTypes(ctx context.Context, code string) (strippedCode, *Error) {
	if w.tsstrip == nil {
		return strippedCode{}, &Error{Type: RunnerErrorType, Message: "TypeScript code blocks are not available on this deployment"}
	}
	stdout := limitedBuffer{limit: maxStrippedBytes + 1}
	config := wazero.NewModuleConfig().
		WithName("").
		WithArgs("tsstrip").
		WithStdin(strings.NewReader(code)).
		WithStdout(&stdout)
	instance, err := w.runtime.InstantiateModule(ctx, w.tsstrip, config)
	if instance != nil {
		_ = instance.Close(context.WithoutCancel(ctx))
	}
	if ctx.Err() != nil {
		return strippedCode{}, &Error{Type: TimeoutType, Message: "code_block_timeout"}
	}
	var out struct {
		JS    string `json:"js"`
		Map   string `json:"map"`
		Error *struct {
			Text   string `json:"text"`
			Line   int    `json:"line"`
			Column int    `json:"column"`
		} `json:"error"`
	}
	if err != nil || stdout.buf.Len() > maxStrippedBytes || json.Unmarshal(stdout.buf.Bytes(), &out) != nil {
		return strippedCode{}, &Error{Type: "SyntaxError", Message: "the TypeScript is too large or too deeply nested to erase its types" + causeOf(err)}
	}
	if failure := out.Error; failure != nil {
		traceback := fmt.Sprintf("SyntaxError: %s\n    at code-block.ts:%d:%d", failure.Text, failure.Line, failure.Column)
		return strippedCode{}, &Error{Type: "SyntaxError", Message: failure.Text, Traceback: traceback}
	}
	return strippedCode{js: out.JS, lines: sourceLines([]byte(out.Map))}, nil
}

// causeOf names a trap such as a stack overflow; an exit or no error adds nothing.
func causeOf(err error) string {
	if err == nil || errors.Is(err, context.Canceled) {
		return ""
	}
	return " (" + firstLine(err.Error()) + ")"
}

var jsLocation = regexp.MustCompile(`code-block\.mjs:(\d+)(?::\d+)?`)

// remap rewrites code-block.mjs:<line> to the TypeScript line it came from.
func (s *strippedCode) remap(traceback string) string {
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
