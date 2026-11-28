package main

import (
	"os"
	"os/exec"
	"path/filepath"
	"slices"
	"strings"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/langwatch/langwatch/pkg/cloudcredentials"
)

// The child half: when the test binary is started as the launcher, it launches
// `env`, so the parent reads exactly the environment the adapter would get.
func TestMain(m *testing.M) {
	if target := os.Getenv("LAMBDAEXTENSION_TEST_TARGET"); target != "" {
		os.Unsetenv("LAMBDAEXTENSION_TEST_TARGET")
		launch(target, os.Args, os.Environ())
		os.Exit(3) // launch only returns when the exec failed
	}
	os.Exit(m.Run())
}

// @scenario "on AWS Lambda, the web adapter starts without the role's credentials"
func TestLauncherHandsTheAdapterNoRoleCredentials(t *testing.T) {
	env, err := exec.LookPath("env")
	require.NoError(t, err)
	cmd := exec.Command(os.Args[0]) //nolint:gosec // this test binary
	cmd.Env = []string{
		"LAMBDAEXTENSION_TEST_TARGET=" + env,
		"AWS_ACCESS_KEY_ID=ASIA-canary",
		"AWS_SECRET_ACCESS_KEY=secret-canary",
		"AWS_SESSION_TOKEN=token-canary",
		"AWS_CONTAINER_AUTHORIZATION_TOKEN=container-canary",
		"AZURE_CLIENT_SECRET=azure-canary",
		"AWS_LAMBDA_RUNTIME_API=127.0.0.1:9001",
		"AWS_LWA_INVOKE_MODE=RESPONSE_STREAM",
		"AWS_REGION=eu-central-1",
	}
	out, err := cmd.Output()
	require.NoError(t, err)

	got := strings.Split(strings.TrimSpace(string(out)), "\n")
	assert.NotContains(t, string(out), "canary", "no role credential reaches the adapter")
	for _, kept := range []string{"AWS_LAMBDA_RUNTIME_API=127.0.0.1:9001", "AWS_LWA_INVOKE_MODE=RESPONSE_STREAM", "AWS_REGION=eu-central-1"} {
		assert.True(t, slices.Contains(got, kept), "%s must reach the adapter: %v", kept, got)
	}
}

// @scenario "the web adapter launcher strips every credential the exposure check looks for"
func TestWithoutRoleCredentialsStripsEveryAmbientCredential(t *testing.T) {
	environ := []string{"PATH=/bin"}
	for _, name := range cloudcredentials.Names() {
		environ = append(environ, name+"=x")
	}
	assert.Equal(t, []string{"PATH=/bin"}, withoutRoleCredentials(environ))
}

func TestWithoutRoleCredentialsKeepsEverythingElse(t *testing.T) {
	assert.Equal(t,
		[]string{"AWS_LAMBDA_RUNTIME_API=x", "AWS_SESSION_TOKEN_FILE=/y", "PATH=/bin"},
		withoutRoleCredentials([]string{"AWS_ACCESS_KEY_ID=a", "AWS_LAMBDA_RUNTIME_API=x", "AWS_SECRET_ACCESS_KEY=b", "AWS_SESSION_TOKEN=c", "AWS_SESSION_TOKEN_FILE=/y", "PATH=/bin"}),
	)
}

func TestAdapterKeepsTheExtensionName(t *testing.T) {
	assert.Equal(t, "lambda-adapter", filepath.Base(adapterPath),
		"Lambda requires the registered extension name to match the file in /opt/extensions")
}
