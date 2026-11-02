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

func TestWithStderrTail_CutDropsTheStartAndBeginsOnALine(t *testing.T) {
	var b strings.Builder
	b.WriteString("boom first line\n")
	for i := 0; i < 400; i++ {
		b.WriteString("line-filler-text\n")
	}

	got := codeblock.WithStderrTail("exit status 1", b.String())

	assert.NotContains(t, got, "boom")
	assert.True(t, strings.HasPrefix(tailOf(got), "… line-filler-text"), got)
	assert.LessOrEqual(t, len(tailOf(got)), codeblock.MaxStderrInMessage+len("… "))
}

func TestWithStderrTail_CutInsideAMultiByteCharacterStaysValidUTF8(t *testing.T) {
	for _, prefix := range []string{"", "a"} {
		got := codeblock.WithStderrTail("exit status 1", prefix+strings.Repeat("é", 3000))
		assert.True(t, utf8.ValidString(got), "prefix %q", prefix)
		assert.NotEmpty(t, tailOf(got))
	}
}

func TestWithStderrTail_ShortTextIsShownWholeWithoutAnEllipsis(t *testing.T) {
	got := codeblock.WithStderrTail("exit status 1", codeblock.TruncatedPrefix+"Traceback\nBoom\n")
	assert.Equal(t, "exit status 1: "+strings.TrimSpace(codeblock.TruncatedPrefix+"Traceback\nBoom"), got)
}

func TestWithStderrTail_WindowStartingInsideAMarkerSkipsTheFragment(t *testing.T) {
	text := strings.Repeat("x", 100) + "[redacted]" + strings.Repeat("y", codeblock.MaxStderrInMessage-7)

	got := codeblock.WithStderrTail("exit status 1", text)

	assert.NotContains(t, got, "acted]")
	assert.True(t, strings.HasPrefix(tailOf(got), "… yyyy"), got)
}

func TestWithStderrTail_BlankStderrLeavesTheMessageUnchanged(t *testing.T) {
	assert.Equal(t, "exit status 1", codeblock.WithStderrTail("exit status 1", " \n\t "))
}

func TestWithStderrTail_SingleLongLineKeepsTheByteTail(t *testing.T) {
	stderr := codeblock.TruncatedPrefix + strings.Repeat("é", codeblock.MaxRunnerStderr)

	got := codeblock.WithStderrTail("exit status 1", stderr)

	assert.True(t, utf8.ValidString(got))
	assert.True(t, strings.HasPrefix(tailOf(got), "… éééé"), got)
	assert.LessOrEqual(t, len(tailOf(got)), codeblock.MaxStderrInMessage+len("… "))
}

// @scenario "The error message carries the end of a stderr longer than the cap"
func TestCodeBlock_ErrorMessageCarriesTheFinalTracebackOfAStderrLongerThanTheCap(t *testing.T) {
	requirePython(t)

	dir := t.TempDir()
	runnerPath := filepath.Join(dir, "runner.py")
	script := "import sys\nsys.stderr.write('first line\\n' + 'noise\\n' * 40000 + 'Traceback (most recent call last):\\nFinalError: boom')\nsys.exit(1)\n"
	require.NoError(t, os.WriteFile(runnerPath, []byte(script), 0o600))
	exe, err := codeblock.New(codeblock.Options{RunnerPath: runnerPath})
	require.NoError(t, err)

	res, err := exe.Execute(context.Background(), codeblock.Request{
		Code:            "def execute():\n    return {'ok': True}\n",
		DeclaredOutputs: []string{"ok"},
	})
	require.NoError(t, err)
	require.NotNil(t, res.Error)

	assert.Contains(t, res.Error.Message, "FinalError: boom")
	assert.Contains(t, res.Error.Message, "Traceback (most recent call last)")
	assert.NotContains(t, res.Error.Message, "first line")
	assert.True(t, strings.HasPrefix(res.Stderr, codeblock.TruncatedPrefix), res.Stderr[:40])
	assert.True(t, strings.HasSuffix(res.Stderr, "FinalError: boom"))
}

// @scenario "A secret that crosses the stderr cap is never partly shown"
func TestCodeBlock_SecretStraddlingTheStderrWindowStartIsAbsentAndResultSaysTruncated(t *testing.T) {
	requirePython(t)
	const secret = "CAPSECRET-0123456789"

	dir := t.TempDir()
	runnerPath := filepath.Join(dir, "runner.py")
	script := "import sys\nsys.stderr.write('x' * 1000 + '" + secret + "' + 'y' * (64*1024 - 10))\nsys.exit(1)\n"
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

	assert.True(t, strings.HasPrefix(res.Stderr, codeblock.TruncatedPrefix), res.Stderr[:40])
	assert.NotContains(t, res.Stderr, "CAPSEC")
	assert.NotContains(t, res.Error.Message, "CAPSEC")
}

// @scenario "A secret that crosses the stderr cap is never partly shown"
func TestCodeBlock_MultiLineSecretStraddlingTheStderrWindowStartIsAbsent(t *testing.T) {
	requirePython(t)
	const secret = "-----BEGIN KEY-----\nLEAKEDLINEAAAA\nBBBB\n-----END KEY-----"

	dir := t.TempDir()
	runnerPath := filepath.Join(dir, "runner.py")
	pySecret := strings.ReplaceAll(secret, "\n", `\n`)
	script := "import sys\nsys.stderr.write('x' * 1000 + '\\n' + '" + pySecret + "' + '\\n' + 'y' * (64*1024 - 28))\nsys.exit(1)\n"
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

	assert.True(t, strings.HasPrefix(res.Stderr, codeblock.TruncatedPrefix), res.Stderr[:40])
	assert.NotContains(t, res.Stderr, "LEAKEDLINE")
	assert.NotContains(t, res.Error.Message, "LEAKEDLINE")
}

// @scenario "A secret that crosses the stderr cap is never partly shown"
func TestReadRunnerStderr_LongSecretStraddlingTheWindowStartIsAbsentWhenShortSecretsAreNearby(t *testing.T) {
	const long = "LONGSECRET-ABCDEFGHIJ"
	raw := strings.Repeat("xx\n", 40) + strings.Repeat(".", 1000) + long + strings.Repeat(".", codeblock.MaxRunnerStderr-len(long)/2)

	got, err := codeblock.ReadRunnerStderr(t.TempDir(), raw, map[string]string{"S": "x", "L": long})
	require.NoError(t, err)

	assertNoFragments(t, got, long, 4)
	assert.True(t, strings.HasPrefix(got, codeblock.TruncatedPrefix), got[:40])
}

// @scenario "A secret that crosses the stderr cap is never partly shown"
func TestReadRunnerStderr_NoFragmentOfASecretSurvivesAnyOffsetAroundTheWindowStart(t *testing.T) {
	const long = "LONGSECRET-ABCDEFGHIJ"
	const mid = "MIDVAL99"
	secrets := map[string]string{"A": "ab", "B": "Q", "M": mid, "L": long}
	for _, secret := range []string{long, mid} {
		for offset := -len(secret) - 3; offset <= 3; offset++ {
			raw := strings.Repeat("ab.", 30) + strings.Repeat("Q", 5) + strings.Repeat(".", 1000) + secret + strings.Repeat(".", codeblock.MaxRunnerStderr+offset)

			got, err := codeblock.ReadRunnerStderr(t.TempDir(), raw, secrets)
			require.NoError(t, err)

			assertNoFragments(t, got, long, 4)
			assertNoFragments(t, got, mid, 4)
		}
	}
}

// @scenario "A cut interpreter stderr starts with a truncation marker"
func TestReadRunnerStderr_CutTextWithoutANewlineKeepsTheEndAndIsMarked(t *testing.T) {
	got, err := codeblock.ReadRunnerStderr(t.TempDir(), strings.Repeat("a", 500)+strings.Repeat("z", codeblock.MaxRunnerStderr-1)+"E", nil)
	require.NoError(t, err)

	assert.True(t, strings.HasPrefix(got, codeblock.TruncatedPrefix+"z"), got[:40])
	assert.True(t, strings.HasSuffix(got, "zE"))
	assert.Len(t, got, codeblock.MaxRunnerStderr+len(codeblock.TruncatedPrefix))
}

// @scenario "A cut interpreter stderr starts with a truncation marker"
func TestReadRunnerStderr_SizesAroundTheCapAreCutExactlyAtIt(t *testing.T) {
	empty, err := codeblock.ReadRunnerStderr(t.TempDir(), "", nil)
	require.NoError(t, err)
	assert.Empty(t, empty)

	exact, err := codeblock.ReadRunnerStderr(t.TempDir(), strings.Repeat("a", codeblock.MaxRunnerStderr), nil)
	require.NoError(t, err)
	assert.Len(t, exact, codeblock.MaxRunnerStderr)

	over, err := codeblock.ReadRunnerStderr(t.TempDir(), "S"+strings.Repeat("a", codeblock.MaxRunnerStderr), nil)
	require.NoError(t, err)
	assert.Equal(t, codeblock.TruncatedPrefix+strings.Repeat("a", codeblock.MaxRunnerStderr), over)
}

// @scenario "A secret that crosses the stderr cap is never partly shown"
func TestReadRunnerStderr_RedactionThatShrinksTheTextStillCutsOnTheRawCap(t *testing.T) {
	const long = "LONGSECRET-ABCDEFGHIJ"
	for offset := -len(long); offset <= 3; offset++ {
		head := strings.Repeat(long+"\n", 300)
		raw := head + strings.Repeat(".", 2000) + long + strings.Repeat(".", codeblock.MaxRunnerStderr+offset)

		got, err := codeblock.ReadRunnerStderr(t.TempDir(), raw, map[string]string{"L": long})
		require.NoError(t, err)

		assertNoFragments(t, got, long, 4)
		assert.True(t, strings.HasPrefix(got, codeblock.TruncatedPrefix), "offset %d", offset)
	}
}

// @scenario "A secret that crosses the stderr cap is never partly shown"
func TestReadRunnerStderr_AFloodOfAOneCharacterSecretIsOneMarkerAfterTheTruncationMarker(t *testing.T) {
	got, err := codeblock.ReadRunnerStderr(t.TempDir(), strings.Repeat("a", 3*codeblock.MaxRunnerStderr), map[string]string{"K": "a"})
	require.NoError(t, err)

	assert.Equal(t, codeblock.TruncatedPrefix, got)
}

// @scenario "A secret that crosses the stderr cap is never partly shown"
func TestReadRunnerStderr_InvalidUTF8AtTheWindowStartIsDropped(t *testing.T) {
	raw := "x" + strings.Repeat("\x80", 10) + strings.Repeat("y", codeblock.MaxRunnerStderr-3)

	got, err := codeblock.ReadRunnerStderr(t.TempDir(), raw, nil)
	require.NoError(t, err)

	assert.True(t, utf8.ValidString(got))
	assert.True(t, strings.HasPrefix(got, codeblock.TruncatedPrefix))
}

// @scenario "A secret cut off at the end of the stderr is never partly shown"
func TestReadRunnerStderr_AStderrEndingInAPartOfASecretShowsNoFragmentOfIt(t *testing.T) {
	secret := "pa\"ss\nwo\u00e9rd-SECRET"
	forms := []string{secret, `pa\"ss\nwoérd-SECRET`, `pa\"ss\nwo\u00e9rd-SECRET`}
	for _, form := range forms {
		for n := 1; n < len(form); n++ {
			got, err := codeblock.ReadRunnerStderr(t.TempDir(), "Traceback\nBoom "+form[:n], map[string]string{"K": secret})
			require.NoError(t, err)

			for _, f := range forms {
				assertNoFragments(t, got, f, 4)
			}
		}
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

// @scenario "A secret that crosses the stderr cap is never partly shown"
func TestReadRunnerStderr_SecretEndingAtTheWindowStartBeforeAStrayByteIsNotPartlyShown(t *testing.T) {
	const secret = "SECRET12"
	for _, stray := range []string{"\x80", "\xa9"} {
		for _, tail := range []int{codeblock.MaxRunnerStderr - 2, codeblock.MaxRunnerStderr - 1, codeblock.MaxRunnerStderr} {
			raw := strings.Repeat(".", 1000) + secret + stray + strings.Repeat(".", tail)

			got, err := codeblock.ReadRunnerStderr(t.TempDir(), raw, map[string]string{"K": secret})
			require.NoError(t, err)

			assertNoFragments(t, got, secret, 4)
			assertNoFragments(t, codeblock.WithStderrTail("exit status 1", got), secret, 4)
		}
	}
}

// @scenario "The error message carries the end of a stderr longer than the cap"
func TestWithStderrTail_ASecretLargerThanTheTailAtTheEndLeavesNoFragment(t *testing.T) {
	secret := strings.Repeat("S3cr3t-", 600)
	got, err := codeblock.ReadRunnerStderr(t.TempDir(), "Traceback\nBoom: "+secret, map[string]string{"K": secret})
	require.NoError(t, err)

	msg := codeblock.WithStderrTail("exit status 1", got)

	assert.NotContains(t, msg, "S3cr3")
	assert.Contains(t, msg, "Boom")
}
