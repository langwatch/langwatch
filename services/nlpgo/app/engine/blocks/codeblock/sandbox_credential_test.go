package codeblock_test

// The sandbox credential is the one thing that reaches user code through the
// environment, so what the subprocess sees is the contract these tests hold.
//
// Spec: specs/nlp-go/code-block.feature

import (
	"context"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/langwatch/langwatch/services/nlpgo/app/engine/blocks/codeblock"
)

// readsLangWatchEnv returns the three variables the sandbox credential is made
// of, as the user code sees them.
const readsLangWatchEnv = "import os\n" +
	"def execute():\n" +
	"    return {\n" +
	"        'key': os.environ.get('LANGWATCH_API_KEY', '<absent>'),\n" +
	"        'endpoint': os.environ.get('LANGWATCH_ENDPOINT', '<absent>'),\n" +
	"        'skip': os.environ.get('LANGWATCH_SKIP_OTEL_SETUP', '<absent>'),\n" +
	"    }\n"

var langWatchEnvOutputs = []string{"key", "endpoint", "skip"}

// @scenario "the run's credential and endpoint reach user code"
func TestCodeBlock_SandboxCredentialReachesUserCode(t *testing.T) {
	requirePython(t)

	e, err := codeblock.New(codeblock.Options{
		SandboxEndpoint: "https://app.langwatch.test",
	})
	require.NoError(t, err)

	res, err := e.Execute(context.Background(), codeblock.Request{
		Code:            readsLangWatchEnv,
		DeclaredOutputs: langWatchEnvOutputs,
		SandboxAPIKey:   "sk-lw-run-scoped",
	})
	require.NoError(t, err)
	require.Nil(t, res.Error, "expected no error, got %+v", res.Error)
	assert.Equal(t, "sk-lw-run-scoped", res.Outputs["key"])
	assert.Equal(t, "https://app.langwatch.test", res.Outputs["endpoint"])
	assert.Equal(t, "true", res.Outputs["skip"])
}

// @scenario "a run with no sandbox key gets no LangWatch environment at all"
func TestCodeBlock_NoSandboxCredentialWithoutAKey(t *testing.T) {
	requirePython(t)

	e, err := codeblock.New(codeblock.Options{
		SandboxEndpoint: "https://app.langwatch.test",
	})
	require.NoError(t, err)

	res, err := e.Execute(context.Background(), codeblock.Request{
		Code:            readsLangWatchEnv,
		DeclaredOutputs: langWatchEnvOutputs,
	})
	require.NoError(t, err)
	require.Nil(t, res.Error, "expected no error, got %+v", res.Error)
	assert.Equal(t, "<absent>", res.Outputs["key"])
	assert.Equal(t, "<absent>", res.Outputs["endpoint"],
		"an endpoint with no key gives agent code half a credential")
	assert.Equal(t, "<absent>", res.Outputs["skip"])
}

// @scenario "a sandbox key with no endpoint is not injected either"
func TestCodeBlock_NoSandboxCredentialWithoutAnEndpoint(t *testing.T) {
	requirePython(t)

	e, err := codeblock.New(codeblock.Options{})
	require.NoError(t, err)

	res, err := e.Execute(context.Background(), codeblock.Request{
		Code:            readsLangWatchEnv,
		DeclaredOutputs: langWatchEnvOutputs,
		SandboxAPIKey:   "sk-lw-run-scoped",
	})
	require.NoError(t, err)
	require.Nil(t, res.Error, "expected no error, got %+v", res.Error)
	assert.Equal(t, "<absent>", res.Outputs["key"],
		"a key with no endpoint would send the call to the wrong instance")
	assert.Equal(t, "<absent>", res.Outputs["endpoint"])
	assert.Equal(t, "<absent>", res.Outputs["skip"])
}

// The engine's own LANGWATCH_API_KEY is not on the allowlist, so nothing but
// the run's own credential can arrive under that name.
// @scenario "the engine's own LangWatch key never reaches user code"
func TestCodeBlock_EngineCredentialNeverReachesUserCode(t *testing.T) {
	requirePython(t)
	t.Setenv("LANGWATCH_API_KEY", "the-engines-own-key")
	t.Setenv("LANGWATCH_ENDPOINT", "https://app.langwatch.test")

	res, err := newExec(t).Execute(context.Background(), codeblock.Request{
		Code:            readsLangWatchEnv,
		DeclaredOutputs: langWatchEnvOutputs,
	})
	require.NoError(t, err)
	require.Nil(t, res.Error, "expected no error, got %+v", res.Error)
	assert.Equal(t, "<absent>", res.Outputs["key"])
	assert.Equal(t, "<absent>", res.Outputs["endpoint"])
}
