package codeblock

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"strings"
	"sync"
	"time"

	"github.com/langwatch/langwatch/pkg/ssrf"
)

// bridgeFramePrefix marks a host call on the guest's stdout; see wasmsite/_lw_host.py.
const bridgeFramePrefix = "\x1eLWHOST "

// Per-run bridge limits. A run that reaches one gets an error reply, not a hang.
const (
	maxBridgeCalls      = 64
	maxBridgeFrameBytes = 16 << 20
	maxFetchBodyBytes   = 10 << 20
	maxStrayOutputBytes = 64 << 10
	defaultFetchTimeout = 30 * time.Second
	maxFetchRedirects   = 10
	// maxQueuedReplyBytes bounds replies the guest has not read yet. A guest
	// that keeps calling without reading is stopped rather than buffered.
	maxQueuedReplyBytes = 32 << 20
	// maxFailedCalls stops a run whose host calls keep failing: malformed,
	// unknown, refused or over budget. A working block never gets near it.
	maxFailedCalls = 256
)

// errUnreadReplies stops a run that let host replies pile up unread.
var errUnreadReplies = errors.New("the code block made host calls without reading their replies")

// errTooManyFailedCalls stops a run that keeps making host calls that fail.
var errTooManyFailedCalls = fmt.Errorf("the code block made more than %d failing host calls", maxFailedCalls)

// bridge is one run's host side: the guest's stdin and stdout. Each host call
// completes inside the guest's write, so stdin always holds the reply before
// the guest reads it and no goroutine or pipe is needed.
type bridge struct {
	ctx    context.Context
	cancel context.CancelCauseFunc
	client *http.Client
	egress ssrf.Options

	mu     sync.Mutex
	stdin  bytes.Buffer
	line   bytes.Buffer
	skip   bool
	calls  int
	failed int
	stray  bytes.Buffer
	closed bool
}

func (w *wasmRuntime) newBridge(ctx context.Context, cancel context.CancelCauseFunc, payload []byte) *bridge {
	b := &bridge{ctx: ctx, cancel: cancel, client: w.client, egress: w.opts.Egress}
	b.stdin.Write(payload)
	b.stdin.WriteByte('\n')
	return b
}

// Read serves the guest's stdin. An empty queue is end of input: the guest
// only reads after a host call, whose reply is already queued.
func (b *bridge) Read(p []byte) (int, error) {
	b.mu.Lock()
	defer b.mu.Unlock()
	if b.stdin.Len() == 0 {
		return 0, io.EOF
	}
	return b.stdin.Read(p)
}

// Write receives the guest's stdout, splits it into lines and answers frames.
func (b *bridge) Write(p []byte) (int, error) {
	b.mu.Lock()
	defer b.mu.Unlock()
	if b.closed {
		return len(p), nil
	}
	rest := p
	for len(rest) > 0 && b.ctx.Err() == nil {
		i := bytes.IndexByte(rest, '\n')
		if i < 0 {
			b.appendLine(rest)
			break
		}
		b.appendLine(rest[:i])
		b.endLine()
		rest = rest[i+1:]
	}
	return len(p), nil
}

func (b *bridge) appendLine(chunk []byte) {
	if b.skip {
		return
	}
	if b.line.Len()+len(chunk) > maxBridgeFrameBytes {
		b.line.Reset()
		b.skip = true
		return
	}
	b.line.Write(chunk)
}

func (b *bridge) endLine() {
	line := b.line.Bytes()
	overflowed := b.skip
	b.skip = false
	defer b.line.Reset()
	switch {
	case overflowed:
		b.answer(bridgeFailure("limit", "host call exceeds the frame size limit"))
	case !bytes.HasPrefix(line, []byte(bridgeFramePrefix)):
		b.keepStray(line)
	default:
		b.answer(b.handle(line[len(bridgeFramePrefix):]))
	}
}

// answer replies to one host call. Every failed call counts towards
// maxFailedCalls, whatever made it fail; past it the run is stopped.
func (b *bridge) answer(reply bridgeReply) {
	if !reply.OK {
		b.failed++
		if b.failed > maxFailedCalls {
			b.closed = true
			b.cancel(errTooManyFailedCalls)
			return
		}
	}
	b.reply(reply)
}

// keepStray holds output the guest wrote straight to fd 1, bounded, so it can
// surface on the result's stderr instead of vanishing.
func (b *bridge) keepStray(line []byte) {
	room := maxStrayOutputBytes - b.stray.Len()
	if room <= 0 {
		return
	}
	if len(line)+1 > room {
		line = line[:room-1]
	}
	b.stray.Write(line)
	b.stray.WriteByte('\n')
}

func (b *bridge) reply(v any) {
	out, err := json.Marshal(v)
	if err != nil {
		out, _ = json.Marshal(bridgeFailure("error", "reply could not be encoded"))
	}
	if b.stdin.Len()+len(out)+1 > maxQueuedReplyBytes {
		b.closed = true
		b.cancel(errUnreadReplies)
		return
	}
	b.stdin.Write(out)
	b.stdin.WriteByte('\n')
}

// close stops answering: a frame written after the run ends gets no reply.
func (b *bridge) close() string {
	b.mu.Lock()
	defer b.mu.Unlock()
	b.closed = true
	return b.stray.String()
}

type bridgeRequest struct {
	Op      string            `json:"op"`
	Method  string            `json:"method"`
	URL     string            `json:"url"`
	Headers map[string]string `json:"headers"`
	BodyB64 string            `json:"body_b64"`
	Timeout float64           `json:"timeout"`
	Seconds float64           `json:"seconds"`
}

type bridgeReply struct {
	OK      bool                `json:"ok"`
	Kind    string              `json:"kind,omitempty"`
	Error   string              `json:"error,omitempty"`
	Status  int                 `json:"status,omitempty"`
	Headers map[string][]string `json:"headers,omitempty"`
	BodyB64 string              `json:"body_b64,omitempty"`
	URL     string              `json:"url,omitempty"`
}

func bridgeFailure(kind, message string) bridgeReply {
	return bridgeReply{OK: false, Kind: kind, Error: message}
}

func (b *bridge) handle(frame []byte) bridgeReply {
	var req bridgeRequest
	if err := json.Unmarshal(frame, &req); err != nil {
		return bridgeFailure("protocol", "host call is not valid JSON")
	}
	switch req.Op {
	case "sleep":
		return b.sleep(req.Seconds)
	case "fetch":
		b.calls++
		if b.calls > maxBridgeCalls {
			return bridgeFailure("limit", fmt.Sprintf("a code block may make at most %d requests", maxBridgeCalls))
		}
		return b.fetch(req)
	default:
		return bridgeFailure("protocol", fmt.Sprintf("unknown host call %q", req.Op))
	}
}

// sleep blocks the guest until the time passes or the run's budget ends.
func (b *bridge) sleep(seconds float64) bridgeReply {
	sleepUntilDone(b.ctx, time.Duration(seconds*float64(time.Second)))
	return bridgeReply{OK: true}
}

func (b *bridge) fetch(req bridgeRequest) bridgeReply {
	// The deadline comes first, so the policy check's own DNS lookup is held to it.
	timeout := defaultFetchTimeout
	if req.Timeout > 0 {
		timeout = time.Duration(req.Timeout * float64(time.Second))
	}
	ctx, cancel := context.WithTimeout(b.ctx, timeout)
	defer cancel()
	if err := ssrf.CheckURL(req.URL, withContextResolver(ctx, b.egress)); err != nil {
		return bridgeFailure("blocked", "this destination is not permitted by the deployment's egress policy")
	}
	body, err := base64.StdEncoding.DecodeString(req.BodyB64)
	if err != nil {
		return bridgeFailure("protocol", "request body is not valid base64")
	}
	if len(body) > maxFetchBodyBytes {
		return bridgeFailure("limit", "request body exceeds the size limit")
	}

	method := strings.ToUpper(req.Method)
	if method == "" {
		method = http.MethodGet
	}
	httpReq, err := http.NewRequestWithContext(ctx, method, req.URL, bytes.NewReader(body))
	if err != nil {
		return bridgeFailure("protocol", "request could not be built: "+err.Error())
	}
	for name, value := range req.Headers {
		httpReq.Header.Set(name, value)
	}
	resp, err := b.client.Do(httpReq)
	if err != nil {
		return fetchFailure(ctx, err)
	}
	defer func() { _ = resp.Body.Close() }()
	data, err := io.ReadAll(io.LimitReader(resp.Body, maxFetchBodyBytes+1))
	if err != nil {
		return fetchFailure(ctx, err)
	}
	if len(data) > maxFetchBodyBytes {
		return bridgeFailure("limit", "response body exceeds the size limit")
	}
	return bridgeReply{
		OK:      true,
		Status:  resp.StatusCode,
		Headers: resp.Header,
		BodyB64: base64.StdEncoding.EncodeToString(data),
		URL:     resp.Request.URL.String(),
	}
}

func fetchFailure(ctx context.Context, err error) bridgeReply {
	switch {
	case errors.Is(ctx.Err(), context.DeadlineExceeded):
		return bridgeFailure("timeout", "the request timed out")
	case errors.Is(err, errTooManyRedirects):
		return bridgeFailure("redirects", "the request was redirected too many times")
	case errors.Is(err, ssrf.ErrBlocked):
		return bridgeFailure("blocked", "this destination is not permitted by the deployment's egress policy")
	default:
		return bridgeFailure("connect", "the request failed: "+err.Error())
	}
}

var errTooManyRedirects = errors.New("codeblock: too many redirects")

// newFetchClient is the client every host fetch uses: the deployment's egress
// policy at dial time, and again on every redirect hop.
func newFetchClient(egress ssrf.Options) *http.Client {
	transport := http.DefaultTransport.(*http.Transport).Clone()
	transport.Proxy = nil
	transport.DialContext = func(ctx context.Context, network, addr string) (net.Conn, error) {
		return ssrf.SafeDialer(withContextResolver(ctx, egress))(ctx, network, addr)
	}
	return &http.Client{
		Transport: transport,
		CheckRedirect: func(req *http.Request, via []*http.Request) error {
			if len(via) >= maxFetchRedirects {
				return errTooManyRedirects
			}
			return ssrf.CheckURL(req.URL.String(), withContextResolver(req.Context(), egress))
		},
	}
}

// withContextResolver makes the egress policy's DNS lookups end with ctx, so a
// slow resolver cannot hold a run past its deadline. A test's resolver is kept.
func withContextResolver(ctx context.Context, egress ssrf.Options) ssrf.Options {
	if egress.Resolver != nil {
		return egress
	}
	egress.Resolver = func(host string) ([]net.IP, error) {
		addrs, err := net.DefaultResolver.LookupIPAddr(ctx, host)
		if err != nil {
			return nil, err
		}
		ips := make([]net.IP, len(addrs))
		for i, addr := range addrs {
			ips[i] = addr.IP
		}
		return ips, nil
	}
	return egress
}
