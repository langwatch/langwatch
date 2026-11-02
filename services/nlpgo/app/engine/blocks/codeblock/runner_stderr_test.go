package codeblock_test

import (
	"context"
	"os"
	"path/filepath"
	"strings"
	"testing"

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
