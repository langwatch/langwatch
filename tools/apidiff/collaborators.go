package apidiff

import (
	"context"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/url"
	"strings"
	"sync"
	"time"
)

// Throwaway values for the collaborators a run stands up on both sides, so the
// routes they gate are compared instead of refused alike. None is a real
// credential; each only has to satisfy the shape its reader checks.
const (
	// LangWatchQL (ADR-159): with both passwords set and the access model in
	// sql mode, the lwql provision task converges the restricted identity,
	// its row policies and the key map into the run's own databases.
	throwawayLwqlClickHousePassword = "apidiff-lwql-clickhouse-password-000000000000"
	throwawayLwqlReaderPassword     = "apidiff-lwql-reader-password-000000000000000"

	// Instant Evals are offered only where a judge is configured. The key
	// reaches only the stub judge (collaborators-judge.go); JEV_BASE_URL falls back to
	// a dead https loopback port when no stub runs, and a judged column then
	// fails the same way on both sides.
	throwawayJudgeKey     = "apidiff-throwaway-jev-key"
	throwawayJudgeBaseURL = "https://127.0.0.1:9"

	// The shared secret the stub Langy agent manager and both APIs agree on.
	throwawayLangyInternalSecret = "apidiff-langy-internal-secret-000000000000000000"

	// The gateway address a Langy turn hands its worker; a dead loopback port,
	// since the run starts no gateway and no worker ever dials it.
	throwawayGatewayBaseURL = "http://127.0.0.1:9"

	// seedEmailDomain pins the branch seed's admin address (main's is fixed),
	// so a developer SEED_EMAIL_DOMAIN cannot move the account the run signs in as.
	seedEmailDomain = "mail.langwatch.localhost"
)

// collaboratorEnvKeys are removed from the inherited environment like the
// managed keys: a developer's own judge key, LangWatchQL identity or Langy
// agent address must never reach a run instance.
var collaboratorEnvKeys = []string{
	"LWQL_CLICKHOUSE_PASSWORD", "LWQL_POSTGRES_READER_PASSWORD", "LWQL_CLICKHOUSE_URL",
	"LWQL_CLICKHOUSE_USER", "LWQL_DATABASE", "LWQL_TENANT_SETTING", "LWQL_ACCESS_MODEL_MODE",
	"LWQL_ACCESS_MODEL_SQL_SINGLE_NODE", "SKIP_LWQL_PROVISION",
	"JEV_API_KEY", "JEV_BASE_URL", "JEV_MODEL", "INSTANT_EVAL_CLASSIFIER",
	"LANGY_AGENT_URL", "LANGY_INTERNAL_SECRET", "SEED_EMAIL_DOMAIN", "LW_GATEWAY_BASE_URL",
	"NODE_EXTRA_CA_CERTS",
}

// collaboratorEnv is one instance's collaborator configuration. Each side gets
// its own restricted LangWatchQL user: both converge on one ClickHouse server,
// and a shared user would carry whichever side's grants converged last.
func collaboratorEnv(instanceName, langyAgentURL string) []string {
	judgeURL := throwawayJudgeBaseURL
	env := []string{
		"LWQL_CLICKHOUSE_PASSWORD=" + throwawayLwqlClickHousePassword,
		"LWQL_POSTGRES_READER_PASSWORD=" + throwawayLwqlReaderPassword,
		"LWQL_CLICKHOUSE_USER=apidiff_lwql_" + instanceName,
		"LWQL_ACCESS_MODEL_MODE=sql",
		"LWQL_ACCESS_MODEL_SQL_SINGLE_NODE=true",
		"JEV_API_KEY=" + throwawayJudgeKey,
		"SEED_EMAIL_DOMAIN=" + seedEmailDomain,
		"LW_GATEWAY_BASE_URL=" + throwawayGatewayBaseURL,
	}
	if judge := judgeBeside(langyAgentURL); judge != nil {
		judgeURL = judge.url
		env = append(env, "NODE_EXTRA_CA_CERTS="+judge.caPath)
	} else if inherited := inheritedCABundle(); inherited != "" {
		env = append(env, "NODE_EXTRA_CA_CERTS="+inherited)
	}
	env = append(env, "JEV_BASE_URL="+judgeURL)
	if langyAgentURL != "" {
		env = append(env, "LANGY_AGENT_URL="+langyAgentURL, "LANGY_INTERNAL_SECRET="+throwawayLangyInternalSecret)
	}
	return env
}

// langyAgentStub stands in for the Langy agent manager (services/langyagent)
// on both sides. It accepts every warm, dispatch and cancel, and reports no
// live worker to a probe, which is all an API needs to mint a conversation
// and a turn. Each side is served under its own path prefix. The stub judge
// starts and stops with it, found from the agent URL by judgeBeside.
type langyAgentStub struct {
	server   *http.Server
	listener net.Listener
	judge    *judgeStub
}

// judgeStubs maps a Langy stub's address to the judge started beside it.
var judgeStubs sync.Map

func startLangyAgentStub() (*langyAgentStub, error) {
	var listenConfig net.ListenConfig
	listener, err := listenConfig.Listen(context.Background(), "tcp", "127.0.0.1:0")
	if err != nil {
		return nil, fmt.Errorf("langy agent stub: %w", err)
	}
	judge, err := startJudgeStub()
	if err != nil {
		_ = listener.Close()
		return nil, err
	}
	stub := &langyAgentStub{listener: listener, judge: judge}
	judgeStubs.Store(listener.Addr().String(), judge)
	stub.server = &http.Server{Handler: http.HandlerFunc(langyAgentStubHandler), ReadHeaderTimeout: 10 * time.Second}
	go func() {
		if serveErr := stub.server.Serve(listener); serveErr != nil && !errors.Is(serveErr, http.ErrServerClosed) {
			return
		}
	}()
	return stub, nil
}

// URL is the agent address one side is configured with.
func (stub *langyAgentStub) URL(instanceName string) string {
	return "http://" + stub.listener.Addr().String() + "/" + instanceName
}

func (stub *langyAgentStub) Close() {
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	_ = stub.server.Shutdown(ctx)
	judgeStubs.Delete(stub.listener.Addr().String())
	stub.judge.Close()
}

// judgeBeside is the stub judge started with the Langy stub an agent URL
// names, or nil when that URL names none.
func judgeBeside(langyAgentURL string) *judgeStub {
	parsed, err := url.Parse(langyAgentURL)
	if err != nil || parsed.Host == "" {
		return nil
	}
	judge, ok := judgeStubs.Load(parsed.Host)
	if !ok {
		return nil
	}
	typed, _ := judge.(*judgeStub)
	return typed
}

// langyAgentStubHandler answers the manager's four routes the way a manager
// with capacity and no warm worker does. The secret is checked, so a side
// that sends none is refused like a real manager would refuse it.
func langyAgentStubHandler(writer http.ResponseWriter, request *http.Request) {
	_, _ = io.Copy(io.Discard, request.Body)
	if request.Header.Get("Authorization") != "Bearer "+throwawayLangyInternalSecret {
		writer.WriteHeader(http.StatusUnauthorized)
		return
	}
	writer.Header().Set("Content-Type", "application/json")
	switch {
	case strings.HasSuffix(request.URL.Path, "/worker/probe"):
		_, _ = writer.Write([]byte(`{"alive":false}`))
	case strings.HasSuffix(request.URL.Path, "/worker/cancel"), strings.HasSuffix(request.URL.Path, "/warm"):
		_, _ = writer.Write([]byte(`{}`))
	default:
		writer.WriteHeader(http.StatusAccepted)
		_, _ = writer.Write([]byte(`{"accepted":true}`))
	}
}
