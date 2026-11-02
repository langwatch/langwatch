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

	got := codeblock.WithStderrTail("exit status 1", b.String(), nil)

	assert.NotContains(t, got, "boom")
	assert.True(t, strings.HasPrefix(tailOf(got), "line-filler-text"), got)
	assert.LessOrEqual(t, len(tailOf(got)), codeblock.MaxStderrInMessage)
}

func TestWithStderrTail_CutInsideAMultiByteCharacterStaysValidUTF8(t *testing.T) {
	for _, prefix := range []string{"", "a"} {
		got := codeblock.WithStderrTail("exit status 1", prefix+strings.Repeat("é", 3000), nil)
		assert.True(t, utf8.ValidString(got), "prefix %q", prefix)
		assert.NotEmpty(t, tailOf(got))
	}
}

func TestWithStderrTail_SecretStraddlingTheCutIsNotPresentEvenPartially(t *testing.T) {
	secret := "SECRETVALUE12345678"
	head := "boom\n" + strings.Repeat("a", 500) + "\n"
	after := strings.Repeat("b", codeblock.MaxStderrInMessage-len(secret)/2) + "\n"
	stderr := head + secret + after

	got := codeblock.WithStderrTail("exit status 1", stderr, map[string]string{"K": secret})

	assert.NotContains(t, got, "SECR")
	assert.NotContains(t, got, "5678")
	assert.NotContains(t, got, "boom")
}

func TestWithStderrTail_JSONEscapedSecretIsRedacted(t *testing.T) {
	secret := "pa\"ss\nwo\\rd\u00e9\U0001F600"
	encoded, err := json.Marshal(map[string]string{"stderr": secret})
	require.NoError(t, err)
	pythonStyle := `{"stderr": "pa\"ss\nwo\\rd\u00e9\ud83d\ude00"}`
	stderr := "trace\nraw " + secret + "\n" + string(encoded) + "\n" + pythonStyle + "\n"

	got := codeblock.WithStderrTail("exit status 1", stderr, map[string]string{"K": secret})

	assert.NotContains(t, got, "wo")
	assert.NotContains(t, got, "pa")
	assert.NotContains(t, got, "ud83d")
	assert.Contains(t, got, "[redacted]")
}

func TestWithStderrTail_BlankStderrLeavesTheMessageUnchanged(t *testing.T) {
	assert.Equal(t, "exit status 1", codeblock.WithStderrTail("exit status 1", " \n\t ", map[string]string{"K": "v"}))
}
