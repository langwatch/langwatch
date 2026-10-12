// Package outboundsim is a local stand-in for the things the product sends
// messages to: Slack incoming webhooks and the Slack Web API, customer webhook
// endpoints and customer SQS queues. Every call is kept in memory as a Record,
// listed under /_sim/api/records for the console, haven's CLI and tests.
//
// ponytail: credentials are accepted, never checked. It is a dev shim; never expose it.
package outboundsim

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"io/fs"
	"net"
	"net/http"
	"os"
	"strconv"
	"strings"
	"time"
)

// Config is outboundsim's environment-derived configuration.
type Config struct {
	// Addr is the listen address (OUTBOUNDSIM_ADDR, default :5597).
	Addr string
	// Stack is the haven stack slug the console names (OUTBOUNDSIM_STACK, may be empty).
	Stack string
	// MaxRecords is how many records the ring keeps (OUTBOUNDSIM_MAX_RECORDS, default 5000).
	MaxRecords int
	// MaxBodyBytes is the largest body kept per record; the rest is cut
	// and the record says so (OUTBOUNDSIM_MAX_BODY_BYTES, default 262144).
	MaxBodyBytes int
	// Seed loads sample records at start (OUTBOUNDSIM_SEED=1).
	Seed bool
	// TLSAddr is a second, https listener (OUTBOUNDSIM_TLS_ADDR) serving the same routes
	// under TLSCert and TLSKey (OUTBOUNDSIM_TLS_CERT, OUTBOUNDSIM_TLS_KEY, PEM files):
	// a stand-in the product must reach over https on an IP address, such as a push service.
	TLSAddr, TLSCert, TLSKey string
}

// LoadConfig reads outboundsim's configuration from the environment.
func LoadConfig() Config {
	cfg := Config{
		Addr: os.Getenv("OUTBOUNDSIM_ADDR"), Stack: os.Getenv("OUTBOUNDSIM_STACK"),
		MaxRecords:   envInt("OUTBOUNDSIM_MAX_RECORDS", 5000),
		MaxBodyBytes: envInt("OUTBOUNDSIM_MAX_BODY_BYTES", 256<<10),
		Seed:         os.Getenv("OUTBOUNDSIM_SEED") == "1",
		TLSAddr:      os.Getenv("OUTBOUNDSIM_TLS_ADDR"), TLSCert: os.Getenv("OUTBOUNDSIM_TLS_CERT"),
		TLSKey: os.Getenv("OUTBOUNDSIM_TLS_KEY"),
	}
	if cfg.Addr == "" {
		cfg.Addr = ":5597"
	}
	return cfg
}

func envInt(key string, fallback int) int {
	if n, err := strconv.Atoi(os.Getenv(key)); err == nil && n > 0 {
		return n
	}
	return fallback
}

// maxBody bounds one incoming call.
const maxBody = 16 << 20

// Server answers the product's outbound calls, the control API and the console.
type Server struct {
	cfg        Config
	records    *store
	faults     *faultSet
	receivers  *receiverSet
	slack      *slackWorkspace
	databricks *dbxWorkspace
	azure      *azureStorage
	push       *pushDevices
	codex      *codexAccount
	now        func() time.Time
	mux        *http.ServeMux
	console    http.Handler
}

// NewServer builds the server over the embedded console bundle.
func NewServer(cfg Config) *Server {
	return newServer(cfg, embeddedConsole())
}

func newServer(cfg Config, bundle fs.FS) *Server {
	if cfg.MaxRecords < 1 {
		cfg.MaxRecords = 5000
	}
	if cfg.MaxBodyBytes < 1 {
		cfg.MaxBodyBytes = 256 << 10
	}
	s := &Server{
		cfg: cfg, records: newStore(cfg.MaxRecords), faults: &faultSet{}, receivers: seedReceivers(),
		slack: seedWorkspace(), databricks: seedDatabricks(time.Now()), codex: newCodexAccount(),
		azure: newAzureStorage(), push: newPushDevices(), now: time.Now,
		console: newConsole(bundle),
	}
	if cfg.Seed {
		seeds := seedRecords()
		for i := range seeds {
			s.records.add(seeds[i], s.now())
		}
	}
	s.mux = s.routes()
	return s
}

func (s *Server) routes() *http.ServeMux {
	mux := http.NewServeMux()
	mux.HandleFunc("GET /healthz", s.handleHealthz)
	mux.HandleFunc("POST /services/{team}/{bot}/{secret}", s.handleSlackWebhook)
	mux.HandleFunc("POST /api/{method}", s.handleSlackAPI)
	mux.HandleFunc("POST /hooks/{name}", s.handleWebhook)
	mux.HandleFunc("POST /", s.handleSQS)
	mux.HandleFunc("POST /oidc/v1/token", s.handleDbxToken)
	mux.HandleFunc("GET /api/2.0/genie/spaces", s.handleDbxSpaces)
	mux.HandleFunc("GET /api/2.0/genie/spaces/{space}/conversations", s.handleDbxConversations)
	mux.HandleFunc("GET /api/2.0/genie/spaces/{space}/conversations/{conversation}/messages", s.handleDbxMessages)
	mux.HandleFunc("GET /api/2.0/preview/scim/v2/Users", s.handleDbxUsers)
	mux.HandleFunc("GET /api/2.0/preview/scim/v2/Users/{id}", s.handleDbxUser)
	mux.HandleFunc("GET /feeds/{name}", s.handleFeed)
	mux.HandleFunc("GET /openai/v1/organization/users", s.handleVendorMembers)
	mux.HandleFunc("GET /openai/v1/organization/projects", s.handleOpenAIProjects)
	mux.HandleFunc("GET /anthropic/v1/organizations/users", s.handleVendorMembers)
	mux.HandleFunc("GET /anthropic/v1/organizations/me", s.handleAnthropicMe)
	mux.HandleFunc("POST /microsoft-login/{tenant}/oauth2/v2.0/token", s.handleMicrosoftToken)
	mux.HandleFunc("GET /microsoft-graph/v1.0/users", s.handleGraphUsers)
	mux.HandleFunc("GET /microsoft-graph/v1.0/subscribedSkus", s.handleGraphSkus)
	mux.HandleFunc("GET /openai/v1/organization/costs", s.handleOpenAICosts)
	mux.HandleFunc("GET /anthropic/v1/organizations/usage_report/messages", s.handleAnthropicUsage)
	mux.HandleFunc("GET /anthropic/v1/organizations/cost_report", s.handleAnthropicCost)
	mux.HandleFunc("GET /anthropic/v1/organizations/audit_log", s.handleClaudeCompliance)
	mux.HandleFunc("GET /microsoft-graph/v1.0/auditLogs/directoryAudits", s.handleGraphDirectoryAudits)
	mux.HandleFunc("GET /dataverse/api/data/v9.2/bots", s.handleDataverseBots)
	mux.HandleFunc("GET /dataverse/api/data/v9.2/conversationtranscripts", s.handleDataverseTranscripts)
	mux.HandleFunc("POST /codex-auth/api/accounts/deviceauth/usercode", s.handleCodexUserCode)
	mux.HandleFunc("POST /codex-auth/api/accounts/deviceauth/token", s.handleCodexDeviceToken)
	mux.HandleFunc("POST /codex-auth/oauth/token", s.handleCodexOAuthToken)
	mux.HandleFunc("GET /codex-auth/codex/device", s.handleCodexDevicePage)
	mux.HandleFunc("POST /codex-auth/codex/device", s.handleCodexDeviceDecision)
	mux.HandleFunc("POST /codex-api/responses", s.handleCodexResponses)
	mux.HandleFunc("GET /_sim/api/codex", s.handleCodexState)
	mux.HandleFunc("PUT /_sim/api/codex", s.handleSetCodexState)
	mux.HandleFunc("POST /_sim/api/codex/expire-tokens", s.handleExpireCodexTokens)
	mux.HandleFunc("POST /_sim/api/codex/devices/{code}/{action}", s.handleCodexDeviceAction)
	mux.HandleFunc("POST /sts/", s.handleSTS)
	for _, method := range []string{"PUT", "GET", "HEAD", "DELETE"} {
		mux.HandleFunc(method+" /azure-blob/{account}/{container}/{blob...}", s.handleAzureBlob)
	}
	mux.HandleFunc("HEAD /azure-blob/{account}/{container}", s.handleAzureBlob)
	mux.HandleFunc("POST /azure-blob/{account}/", s.handleAzureDelegationKey)
	mux.HandleFunc("OPTIONS /azure-blob/", s.handleAzureCORS)
	mux.HandleFunc("GET /azure-msi/token", s.handleAzureManagedIdentity)
	mux.HandleFunc("POST /push/{device}", s.handlePush)
	mux.HandleFunc("PUT /_sim/api/databricks/users", s.handleSetDbxUsers)
	mux.HandleFunc("GET /_sim/api/azure", s.handleAzureStatus)
	mux.HandleFunc("DELETE /_sim/api/azure/tokens", s.handleAzureRevokeTokens)
	mux.HandleFunc("GET /_sim/api/push", s.handlePushDevices)
	mux.HandleFunc("PUT /_sim/api/push/{device}", s.handleSetPushAnswer)
	mux.HandleFunc("DELETE /_sim/api/push/{device}", s.handleClearPushAnswer)
	mux.HandleFunc("GET /_sim/api/status", s.handleStatus)
	mux.HandleFunc("GET /_sim/api/setup", s.handleSetup)
	mux.HandleFunc("GET /_sim/api/records", s.handleRecords)
	mux.HandleFunc("DELETE /_sim/api/records", s.handleClearRecords)
	mux.HandleFunc("GET /_sim/api/deliveries", s.handleDeliveries)
	mux.HandleFunc("GET /_sim/api/faults", s.handleFaults)
	mux.HandleFunc("POST /_sim/api/faults", s.handleAddFault)
	mux.HandleFunc("DELETE /_sim/api/faults", s.handleClearFaults)
	mux.HandleFunc("DELETE /_sim/api/faults/{id}", s.handleRemoveFault)
	mux.HandleFunc("PUT /_sim/api/receivers/{name}", s.handleSetReceiver)
	mux.HandleFunc("DELETE /_sim/api/receivers/{name}", s.handleClearReceiver)
	// A path outboundsim does not fake is a 404, never the console page.
	for _, pattern := range []string{"PUT /", "GET /api/", "GET /hooks/", "GET /services/", "GET /_sim/api/"} {
		mux.HandleFunc(pattern, func(w http.ResponseWriter, r *http.Request) {
			writeError(w, http.StatusNotFound, "outboundsim does not fake "+r.Method+" "+r.URL.Path)
		})
	}
	mux.HandleFunc("GET /", s.handleConsole)
	return mux
}

// Handler is the whole HTTP surface, for tests that drive it without a listener.
func (s *Server) Handler() http.Handler { return s.mux }

// Serve listens on cfg.Addr until ctx is done.
func (s *Server) Serve(ctx context.Context) error {
	var lc net.ListenConfig
	ln, err := lc.Listen(ctx, "tcp", s.cfg.Addr)
	if err != nil {
		return fmt.Errorf("binding %s: %w", s.cfg.Addr, err)
	}
	srv := &http.Server{Handler: s.Handler(), ReadHeaderTimeout: 10 * time.Second}
	servers := []*http.Server{srv}
	failed, stop := make(chan error, 1), make(chan struct{})
	if s.cfg.TLSAddr != "" {
		tlsLn, err := lc.Listen(ctx, "tcp", s.cfg.TLSAddr)
		if err != nil {
			_ = ln.Close()
			return fmt.Errorf("binding %s: %w", s.cfg.TLSAddr, err)
		}
		tlsSrv := &http.Server{Handler: s.Handler(), ReadHeaderTimeout: 10 * time.Second}
		servers = append(servers, tlsSrv)
		go func() {
			if err := tlsSrv.ServeTLS(tlsLn, s.cfg.TLSCert, s.cfg.TLSKey); !errors.Is(err, http.ErrServerClosed) {
				failed <- fmt.Errorf("https listener %s: %w", s.cfg.TLSAddr, err)
				close(stop)
			}
		}()
	}
	go func() {
		select {
		case <-ctx.Done():
		case <-stop:
		}
		shutdownCtx, cancel := context.WithTimeout(context.WithoutCancel(ctx), 5*time.Second)
		defer cancel()
		for _, server := range servers {
			_ = server.Shutdown(shutdownCtx)
		}
	}()
	if err := srv.Serve(ln); !errors.Is(err, http.ErrServerClosed) {
		return err
	}
	select {
	case err := <-failed:
		return err
	default:
		return nil
	}
}

// writeError answers {"error": message}, the shape the console's fetch reads.
func writeError(w http.ResponseWriter, status int, message string) {
	writeJSON(w, status, map[string]string{"error": message})
}

func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Cache-Control", "no-store")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(v)
}

func (s *Server) handleHealthz(w http.ResponseWriter, _ *http.Request) {
	writeJSON(w, http.StatusOK, map[string]string{"status": "ok"})
}

// call is one incoming request, read and ready to be answered and recorded.
type call struct {
	ctx       context.Context
	channel   string
	target    string
	method    string
	header    http.Header
	body      []byte
	parsed    map[string]any
	eventID   string
	signature string
}

// reply is the answer to give: the vendor's natural one, or a fault's.
type reply struct {
	status      int
	contentType string
	body        string
	header      map[string]string
	latency     time.Duration
}

func textReply(status int, body string) reply {
	return reply{status: status, contentType: "text/plain", body: body}
}

func jsonReply(status int, v any) reply {
	encoded, _ := json.Marshal(v)
	return reply{status: status, contentType: "application/json", body: string(encoded)}
}

// readCall reads the request; a body over maxBody is refused with 413 and false.
func readCall(w http.ResponseWriter, r *http.Request, channel, target string) (call, bool) {
	body, err := io.ReadAll(http.MaxBytesReader(w, r.Body, maxBody))
	if err != nil {
		writeError(w, http.StatusRequestEntityTooLarge, "reading the body: "+err.Error())
		return call{}, false
	}
	return call{ctx: r.Context(), channel: channel, target: target, method: r.Method, header: r.Header, body: body}, true
}

// finish applies the first matching fault to natural, records the call, then
// answers (after the latency), or drops the connection without an answer.
func (s *Server) finish(w http.ResponseWriter, c call, natural reply) {
	out, drop := natural, false
	fault, hit := s.faults.take(c.channel, c.target)
	if hit {
		out, drop = fault.apply(natural)
	}
	s.keep(c, out, fault.ID, drop)
	if drop {
		dropConnection(w)
		return
	}
	if pause(c.ctx, out.latency) {
		out.write(w)
	}
}

func (s *Server) keep(c call, out reply, faultID string, drop bool) {
	rec := Record{
		Channel: c.channel, Target: c.target, Method: c.method, Headers: redactHeaders(c.header),
		Parsed: c.parsed, EventID: c.eventID, Signature: c.signature, Status: out.status,
		FaultID: faultID, Dropped: drop, LatencyMs: out.latency.Milliseconds(),
	}
	rec.Body, rec.Truncated = capBody(c.body, s.cfg.MaxBodyBytes)
	if drop {
		rec.Status = 0
	}
	s.records.add(rec, s.now())
}

func (r reply) write(w http.ResponseWriter) {
	w.Header().Set("Cache-Control", "no-store")
	if r.contentType != "" {
		w.Header().Set("Content-Type", r.contentType)
	}
	for key, value := range r.header {
		w.Header().Set(key, value)
	}
	w.WriteHeader(r.status)
	_, _ = io.WriteString(w, r.body)
}

// dropConnection closes the client's connection without writing an answer.
func dropConnection(w http.ResponseWriter) {
	conn, _, err := http.NewResponseController(w).Hijack()
	if err != nil {
		w.WriteHeader(http.StatusBadGateway)
		return
	}
	_ = conn.Close()
}

// pause waits d, and reports false when the client left first.
func pause(ctx context.Context, d time.Duration) bool {
	if d <= 0 {
		return true
	}
	timer := time.NewTimer(d)
	defer timer.Stop()
	select {
	case <-timer.C:
		return true
	case <-ctx.Done():
		return false
	}
}

// pick is the entries of m under keys that are present.
func pick(m map[string]any, keys ...string) map[string]any {
	out := map[string]any{}
	for _, key := range keys {
		if v, ok := m[key]; ok {
			out[key] = v
		}
	}
	return out
}

// baseURL is the origin the caller reached outboundsim at.
func baseURL(r *http.Request) string {
	scheme := "http"
	if r.TLS != nil || strings.EqualFold(r.Header.Get("X-Forwarded-Proto"), "https") {
		scheme = "https"
	}
	return scheme + "://" + r.Host
}
