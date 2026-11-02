package codeblock_test

import (
	"context"
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"unicode/utf8"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/langwatch/langwatch/services/nlpgo/app/engine/blocks/codeblock"
)

// A runner that dies before writing a result must say why in the error that
// reaches spans and logs, not only "exit status 1".
// @scenario "A runner error carries the end of the interpreter stderr"
func TestCodeBlock_RunnerDeathCarriesBoundedStderrInError(t *testing.T) {
	requirePython(t)

	dir := t.TempDir()
	runnerPath := filepath.Join(dir, "runner.py")
	script := "import sys\nsys.stderr.write('boom: cannot import sandbox\\n' + 'x' * 10000 + 'TAILMARK')\nsys.exit(1)\n"
	require.NoError(t, os.WriteFile(runnerPath, []byte(script), 0o600))

	exe, err := codeblock.New(codeblock.Options{RunnerPath: runnerPath})
	require.NoError(t, err)

	res, err := exe.Execute(context.Background(), codeblock.Request{
		Code:            "def execute():\n    return {'ok': True}\n",
		DeclaredOutputs: []string{"ok"},
	})
	require.NoError(t, err)
	require.NotNil(t, res.Error)

	assert.Equal(t, codeblock.RunnerErrorType, res.Error.Type)
	assert.True(t, strings.HasPrefix(res.Error.Message, "exit status 1: "), res.Error.Message)
	assert.Contains(t, res.Error.Message, "TAILMARK")
	assert.Less(t, len(res.Error.Message), 3<<10)
}

// @scenario "A runner error carries the end of the interpreter stderr"
func TestCodeBlock_RunnerExitingZeroWithoutResultCarriesStderrInError(t *testing.T) {
	requirePython(t)

	dir := t.TempDir()
	runnerPath := filepath.Join(dir, "runner.py")
	script := "import sys\nsys.stderr.write('quiet failure reason\\n')\n"
	require.NoError(t, os.WriteFile(runnerPath, []byte(script), 0o600))

	exe, err := codeblock.New(codeblock.Options{RunnerPath: runnerPath})
	require.NoError(t, err)

	res, err := exe.Execute(context.Background(), codeblock.Request{
		Code:            "def execute():\n    return {'ok': True}\n",
		DeclaredOutputs: []string{"ok"},
	})
	require.NoError(t, err)
	require.NotNil(t, res.Error)

	assert.Equal(t, codeblock.RunnerErrorType, res.Error.Type)
	assert.True(t, strings.HasPrefix(res.Error.Message, "empty_result: "), res.Error.Message)
	assert.Contains(t, res.Error.Message, "quiet failure reason")
}

func tailOf(message string) string {
	_, tail, _ := strings.Cut(message, ": ")
	return tail
}

func TestWithStderrTail_CutDropsTheStartAndBeginsOnALine(t *testing.T) {
	var b strings.Builder
	b.WriteString("boom first line\n")
	for i := 0; i < 400; i++ {
		b.WriteString("line-filler-text\n")
	}

	got := codeblock.WithStderrTail("exit status 1", b.String())

	assert.NotContains(t, got, "boom")
	assert.True(t, strings.HasPrefix(tailOf(got), "line-filler-text"), got)
	assert.LessOrEqual(t, len(tailOf(got)), codeblock.MaxStderrInMessage)
}

func TestWithStderrTail_CutInsideAMultiByteCharacterStaysValidUTF8(t *testing.T) {
	for _, prefix := range []string{"", "a"} {
		got := codeblock.WithStderrTail("exit status 1", prefix+strings.Repeat("é", 3000))
		assert.True(t, utf8.ValidString(got), "prefix %q", prefix)
		assert.NotEmpty(t, tailOf(got))
	}
}

// @scenario "A secret is scrubbed from stderr in its JSON-escaped forms"
func TestReadRunnerStderr_JSONEscapedSecretIsRedacted(t *testing.T) {
	secret := "pa\"ss\nwo\\rd\u00e9\U0001F600"
	encoded, err := json.Marshal(map[string]string{"stderr": secret})
	require.NoError(t, err)
	pythonStyle := `{"stderr": "pa\"ss\nwo\\rd\u00e9\ud83d\ude00"}`
	stderr := "trace\nraw " + secret + "\n" + string(encoded) + "\n" + pythonStyle + "\n"

	got, err := codeblock.ReadRunnerStderr(t.TempDir(), stderr, map[string]string{"K": secret})
	require.NoError(t, err)

	assert.NotContains(t, got, "wo")
	assert.NotContains(t, got, "pa")
	assert.NotContains(t, got, "ud83d")
	assert.Contains(t, got, "[redacted]")
}

// @scenario "A secret is scrubbed from stderr in its JSON-escaped forms"
func TestReadRunnerStderr_PythonJSONEscapedSecretWithHTMLCharsIsRedacted(t *testing.T) {
	secret := "a&b<c>\nd"
	stderr := "x \"a&b<c>\\nd\" y"

	got, err := codeblock.ReadRunnerStderr(t.TempDir(), stderr, map[string]string{"K": secret})
	require.NoError(t, err)

	assert.NotContains(t, got, "a&b")
	assert.Contains(t, got, "[redacted]")
}

func TestWithStderrTail_BlankStderrLeavesTheMessageUnchanged(t *testing.T) {
	assert.Equal(t, "exit status 1", codeblock.WithStderrTail("exit status 1", " \n\t "))
}

// @scenario "A secret that crosses the stderr cap is never partly shown"
func TestCodeBlock_SecretStraddlingTheStderrCapIsAbsentAndResultSaysTruncated(t *testing.T) {
	requirePython(t)
	const secret = "CAPSECRET-0123456789"

	dir := t.TempDir()
	runnerPath := filepath.Join(dir, "runner.py")
	script := "import sys\nsys.stderr.write('head\\n' + 'x' * (64*1024 - 5 - 10) + '" + secret + "' + 'y' * 100)\nsys.exit(1)\n"
	require.NoError(t, os.WriteFile(runnerPath, []byte(script), 0o600))
	exe, err := codeblock.New(codeblock.Options{RunnerPath: runnerPath})
	require.NoError(t, err)

	res, err := exe.Execute(context.Background(), codeblock.Request{
		Code:            "def execute():\n    return {'ok': True}\n",
		DeclaredOutputs: []string{"ok"},
		Secrets:         map[string]string{"K": secret},
	})
	require.NoError(t, err)
	require.NotNil(t, res.Error)

	assert.True(t, strings.HasSuffix(res.Stderr, "[stderr truncated]"), res.Stderr)
	assert.NotContains(t, res.Stderr, "CAPSEC")
	assert.NotContains(t, res.Error.Message, "CAPSEC")
}

// @scenario "A secret that crosses the stderr cap is never partly shown"
func TestCodeBlock_MultiLineSecretStartingBeforeTheStderrCapIsAbsent(t *testing.T) {
	requirePython(t)
	const secret = "-----BEGIN KEY-----\nLEAKEDLINEAAAA\nBBBB\n-----END KEY-----"

	dir := t.TempDir()
	runnerPath := filepath.Join(dir, "runner.py")
	pySecret := strings.ReplaceAll(secret, "\n", `\n`)
	script := "import sys\nsys.stderr.write('x' * (64*1024 - 30) + '\\n' + '" + pySecret + "' + '\\n' + 'y' * 100)\nsys.exit(1)\n"
	require.NoError(t, os.WriteFile(runnerPath, []byte(script), 0o600))
	exe, err := codeblock.New(codeblock.Options{RunnerPath: runnerPath})
	require.NoError(t, err)

	res, err := exe.Execute(context.Background(), codeblock.Request{
		Code:            "def execute():\n    return {'ok': True}\n",
		DeclaredOutputs: []string{"ok"},
		Secrets:         map[string]string{"K": secret},
	})
	require.NoError(t, err)
	require.NotNil(t, res.Error)

	assert.True(t, strings.HasSuffix(res.Stderr, "[stderr truncated]"), res.Stderr)
	assert.NotContains(t, res.Stderr, "LEAKEDLINE")
	assert.NotContains(t, res.Error.Message, "LEAKEDLINE")
}

// @scenario "A secret that crosses the stderr cap is never partly shown"
func TestReadRunnerStderr_LongSecretCrossingTheCapIsAbsentWhenShortSecretsAreNearby(t *testing.T) {
	const long = "LONGSECRET-ABCDEFGHIJ"
	raw := strings.Repeat("xx\n", 40) + strings.Repeat(".", codeblock.MaxRunnerStderr-80-len(long)/2) + long + strings.Repeat(".", 200)

	got, err := codeblock.ReadRunnerStderr(t.TempDir(), raw, map[string]string{"S": "x", "L": long})
	require.NoError(t, err)

	assertNoFragments(t, got, long, 4)
	assert.True(t, strings.HasSuffix(got, "[stderr truncated]"), got)
}

// @scenario "A secret that crosses the stderr cap is never partly shown"
func TestReadRunnerStderr_NoFragmentOfASecretSurvivesAnyOffsetAroundTheCap(t *testing.T) {
	const long = "LONGSECRET-ABCDEFGHIJ"
	const mid = "MIDVAL99"
	secrets := map[string]string{"A": "ab", "B": "Q", "M": mid, "L": long}
	for _, secret := range []string{long, mid} {
		for offset := -len(secret) - 3; offset <= 3; offset++ {
			pad := codeblock.MaxRunnerStderr + offset
			raw := strings.Repeat("ab.", 30) + strings.Repeat("Q", 5) + strings.Repeat(".", pad-95) + secret + strings.Repeat(".", 300)

			got, err := codeblock.ReadRunnerStderr(t.TempDir(), raw, secrets)
			require.NoError(t, err)

			assertNoFragments(t, got, long, 4)
			assertNoFragments(t, got, mid, 4)
		}
	}
}

// @scenario "A cut interpreter stderr ends with a truncation marker"
func TestReadRunnerStderr_CutTextWithoutANewlineIsKeptAndMarked(t *testing.T) {
	got, err := codeblock.ReadRunnerStderr(t.TempDir(), strings.Repeat("z", codeblock.MaxRunnerStderr+500), nil)
	require.NoError(t, err)

	assert.True(t, strings.HasSuffix(got, "z\n[stderr truncated]"))
	assert.Len(t, got, codeblock.MaxRunnerStderr+len("\n[stderr truncated]"))
}

// @scenario "A secret that crosses the stderr cap is never partly shown"
func TestReadRunnerStderr_RedactionThatShrinksTheTextStillCutsOnTheRawCap(t *testing.T) {
	const long = "LONGSECRET-ABCDEFGHIJ"
	for offset := -len(long); offset <= 3; offset++ {
		head := strings.Repeat(long+"\n", 300)
		raw := head + strings.Repeat(".", codeblock.MaxRunnerStderr+offset-len(head)) + long + strings.Repeat(".", 300)

		got, err := codeblock.ReadRunnerStderr(t.TempDir(), raw, map[string]string{"L": long})
		require.NoError(t, err)

		assertNoFragments(t, got, long, 4)
		assert.True(t, strings.HasSuffix(got, "[stderr truncated]"), "offset %d", offset)
	}
}

func assertNoFragments(t *testing.T, text, secret string, minLen int) {
	t.Helper()
	for i := 0; i+minLen <= len(secret); i++ {
		for j := i + minLen; j <= len(secret); j++ {
			if strings.Contains(text, secret[i:j]) {
				t.Fatalf("fragment %q of a secret is shown", secret[i:j])
			}
		}
	}
}

// @scenario "A runner error carries the end of the interpreter stderr"
func TestWithStderrTail_SingleLongLineKeepsTheByteTail(t *testing.T) {
	stderr := strings.Repeat("é", codeblock.MaxRunnerStderr) + "\n[stderr truncated]"

	got := codeblock.WithStderrTail("exit status 1", stderr)

	assert.True(t, utf8.ValidString(got))
	assert.Contains(t, tailOf(got), "éééé")
	assert.True(t, strings.HasSuffix(got, "[stderr truncated]"), got)
	assert.LessOrEqual(t, len(tailOf(got)), codeblock.MaxStderrInMessage+len("\n[stderr truncated]"))
}

// @scenario "A cut interpreter stderr ends with a truncation marker"
func TestReadRunnerStderr_CutInsideAMultiByteRuneWithoutANewlineStaysValidUTF8(t *testing.T) {
	for _, prefix := range []string{"", "a", "ab", "abc"} {
		got, err := codeblock.ReadRunnerStderr(t.TempDir(), prefix+strings.Repeat("é", codeblock.MaxRunnerStderr), nil)
		require.NoError(t, err)

		assert.True(t, utf8.ValidString(got), "prefix %q", prefix)
		assert.True(t, strings.HasSuffix(got, "é\n[stderr truncated]"), "prefix %q", prefix)
	}
}
