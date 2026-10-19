package scenariorunner

import (
	"context"
	"io"
	"net/http"
	"net/http/httptest"
	"net/url"
	"sync/atomic"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"go.uber.org/zap"

	"github.com/langwatch/langwatch/services/scenariorunner/egress"
)

// The runner's own HTTP client, built from the policy the parent states, is
// the one an HTTP target dials through: attack it the way a target URL would.

// @scenario "An HTTP target behind the fence is refused before any connection is made"
func TestRuntimeFenceRefusesPrivateAndMetadataTargets(t *testing.T) {
	var hits atomic.Int32
	internal := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		hits.Add(1)
		_, _ = w.Write([]byte("internal"))
	}))
	defer internal.Close()
	port := portOf(t, internal.URL)
	rt, err := readRuntime(Env{
		LangWatchEndpoint: "https://collector.example", LangWatchAPIKey: "run-key",
		EgressPolicy: `{"blockLocal":true,"allowedHosts":["169.254.169.254","metadata.google.internal","fd00:ec2::254"]}`,
	}, zap.NewNop())
	require.NoError(t, err)

	for _, raw := range []string{
		"http://127.0.0.1:" + port + "/", "http://localhost:" + port + "/", "http://[::1]:" + port + "/",
		"http://2130706433:" + port + "/", "http://0x7f.1:" + port + "/", "http://0177.0.0.1:" + port + "/",
		"http://[::ffff:127.0.0.1]:" + port + "/", "http://127.1:" + port + "/", "http://１２７.0.0.1:" + port + "/",
		"http://169.254.169.254/latest/meta-data/", "http://metadata.google.internal/",
		"http://[fd00:ec2::254]/", "http://[fd00:ec2::254%25eth0]/", "http://2852039166/",
		"http://10.0.0.1/", "http://[fd00::1]/", "http://[fe80::1%25lo0]/",
	} {
		_, err := rt.HTTP.Do(context.Background(), egress.Request{Method: http.MethodGet, URL: raw})
		require.Error(t, err, raw)
	}
	assert.Zero(t, hits.Load(), "no attack reaches the internal server")
}

// @scenario "A redirect is refused as the Node child refuses it"
func TestRuntimeRefusesARedirectFromAnAllowedHostToAPrivateOne(t *testing.T) {
	var hits atomic.Int32
	internal := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		hits.Add(1)
	}))
	defer internal.Close()
	first := httptest.NewServer(http.RedirectHandler(internal.URL+"/", http.StatusFound))
	defer first.Close()
	rt, err := readRuntime(Env{
		LangWatchEndpoint: "https://collector.example", LangWatchAPIKey: "run-key",
		EgressPolicy: `{"blockLocal":true,"allowedHosts":["127.0.0.1"]}`,
	}, zap.NewNop())
	require.NoError(t, err)

	_, err = rt.HTTP.Do(context.Background(), egress.Request{Method: http.MethodGet, URL: first.URL + "/"})

	var refused *egress.RedirectRefusedError
	require.ErrorAs(t, err, &refused)
	assert.Zero(t, hits.Load())
}

// The parent's environment reaches the runner already stripped; the runner
// still reads only the variables it names, never the whole environment.
func TestRunnerReadsOnlyTheVariablesItNames(t *testing.T) {
	asked := map[string]bool{}
	ReadEnv(func(name string) string {
		asked[name] = true
		return ""
	}, io.Discard)
	names := make([]string, 0, len(asked))
	for name := range asked {
		names = append(names, name)
	}
	assert.ElementsMatch(t, []string{
		egress.PolicyEnv, envAPIKey, envEndpoint, envLogContext, envNLPInternalSecret,
		envEngineCodeBlockTimeout, envExtraCACerts, envRejectUnauthorized, envNLPFetchMaxTimeout,
		envLogLevel, envResourceAttributes, envServiceName, envVerbose,
	}, names)
}

func portOf(t *testing.T, raw string) string {
	t.Helper()
	u, err := url.Parse(raw)
	require.NoError(t, err)
	return u.Port()
}
