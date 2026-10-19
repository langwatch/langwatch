package targets

import (
	"context"
	"io"
	"net/http"
	"strings"
	"sync"
	"time"

	"go.opentelemetry.io/otel/propagation"
)

// NLP engine and relay paths for one synchronous studio execution.
const (
	executeSyncEnginePath = "/go/studio/execute_sync"
	executeSyncRelayPath  = "/api/scenario/execute-sync"
	// NLPInternalSecretHeader carries the engine hop's shared credential.
	NLPInternalSecretHeader = "X-LangWatch-NLP-Secret"
)

// Operator deadlines for one engine call (nlp-fetch.channel.ts).
const (
	engineCodeBlockTimeoutDefaultSeconds = 600
	nlpFetchHeadroomMs                   = 30_000
	nlpFetchMaxTimeoutDefaultMs          = 900_000
)

// NLPTimeouts are the operator's engine deadlines as the parent read them.
type NLPTimeouts struct {
	EngineCodeBlockTimeoutSeconds *float64 `json:"engineCodeBlockTimeoutSeconds,omitempty"`
	MaxTimeoutMs                  *float64 `json:"maxTimeoutMs,omitempty"`
}

// floorMs is the engine's own code-block ceiling plus headroom, so the engine
// reports its own timeout before the client gives up.
func (t NLPTimeouts) floorMs() int {
	seconds := float64(engineCodeBlockTimeoutDefaultSeconds)
	if v := t.EngineCodeBlockTimeoutSeconds; v != nil && *v > 0 && *v == float64(int64(*v)) {
		seconds = *v
	}
	return int(seconds*1000) + nlpFetchHeadroomMs
}

// maxMs is the platform's own maximum for one turn.
func (t NLPTimeouts) maxMs() int {
	if v := t.MaxTimeoutMs; v != nil && *v > 0 {
		return int(*v)
	}
	return nlpFetchMaxTimeoutDefaultMs
}

// ExecuteSyncRoute is where a code or workflow turn posts.
type ExecuteSyncRoute struct {
	Mode          string `json:"mode"`
	NLPServiceURL string `json:"nlpServiceUrl,omitempty"`
	RelayBaseURL  string `json:"relayBaseUrl,omitempty"`
}

// syncResponse is the engine's answer to one POST.
type syncResponse struct {
	ok     bool
	status int
	body   string
}

// executeSyncTransport posts one execute_flow event.
type executeSyncTransport struct {
	endpoint string
	headers  func(ctx context.Context) map[string]string
}

var (
	clientsMu sync.Mutex
	clients   = map[time.Duration]*http.Client{}
)

// clientFor pools one client per deadline, as the Node child memoises its dispatchers.
func clientFor(timeout time.Duration) *http.Client {
	clientsMu.Lock()
	defer clientsMu.Unlock()
	if c, ok := clients[timeout]; ok {
		return c
	}
	transport := http.DefaultTransport.(*http.Transport).Clone()
	transport.ResponseHeaderTimeout = timeout
	c := &http.Client{Transport: transport}
	clients[timeout] = c
	return c
}

func (t executeSyncTransport) post(ctx context.Context, body string, timeout time.Duration) (syncResponse, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, t.endpoint, strings.NewReader(body))
	if err != nil {
		return syncResponse{}, err
	}
	req.Header.Set("Content-Type", "application/json")
	for k, v := range t.headers(ctx) {
		req.Header.Set(k, v)
	}
	resp, err := clientFor(timeout).Do(req)
	if err != nil {
		return syncResponse{}, err
	}
	defer func() { _ = resp.Body.Close() }()
	raw, err := io.ReadAll(resp.Body)
	if err != nil {
		return syncResponse{}, err
	}
	return syncResponse{ok: resp.StatusCode >= 200 && resp.StatusCode < 300, status: resp.StatusCode, body: string(raw)}, nil
}

// secretHeaders is the internal credential header, none when blank.
func secretHeaders(secret string) map[string]string {
	if v := strings.TrimSpace(secret); v != "" {
		return map[string]string{NLPInternalSecretHeader: v}
	}
	return map[string]string{}
}

// TransportInput chooses the execute_sync route of a code or workflow turn.
type TransportInput struct {
	Route             *ExecuteSyncRoute
	NLPServiceURL     string
	NLPInternalSecret string
	ProjectAPIKey     string
}

// newExecuteSyncTransport relays when the parent named a relay, else posts to
// the engine directly with the internal secret.
func newExecuteSyncTransport(in TransportInput) executeSyncTransport {
	if in.Route != nil && in.Route.Mode == "relay" && in.Route.RelayBaseURL != "" {
		return executeSyncTransport{
			endpoint: trimTrailingSlash(in.Route.RelayBaseURL) + executeSyncRelayPath,
			headers: func(ctx context.Context) map[string]string {
				h := map[string]string{"X-Auth-Token": in.ProjectAPIKey}
				carrier := propagation.MapCarrier{}
				propagation.TraceContext{}.Inject(ctx, carrier)
				if tp := carrier["traceparent"]; tp != "" {
					h["traceparent"] = tp
				}
				return h
			},
		}
	}
	base := in.NLPServiceURL
	if in.Route != nil && in.Route.Mode == "direct" {
		base = in.Route.NLPServiceURL
	}
	return executeSyncTransport{
		endpoint: trimTrailingSlash(base) + executeSyncEnginePath,
		headers:  func(context.Context) map[string]string { return secretHeaders(in.NLPInternalSecret) },
	}
}
