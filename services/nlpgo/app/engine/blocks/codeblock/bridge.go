package codeblock

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"io"
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
)

// bridge is one run's host side: the guest's stdin and stdout. Each host call
// completes inside the guest's write, so stdin always holds the reply before
// the guest reads it and no goroutine or pipe is needed.
type bridge struct {
	ctx    context.Context
	client *http.Client
	egress ssrf.Options

	mu     sync.Mutex
	stdin  bytes.Buffer
	line   bytes.Buffer
	skip   bool
	calls  int
	stray  bytes.Buffer
	closed bool
}

func (w *wasmRuntime) newBridge(ctx context.Context, payload []byte) *bridge {
	b := &bridge{ctx: ctx, client: w.client, egress: w.opts.Egress}
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
	for len(rest) > 0 {
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
	if overflowed {
		b.reply(bridgeFailure("limit", "host call exceeds the frame size limit"))
		return
	}
	if !bytes.HasPrefix(line, []byte(bridgeFramePrefix)) {
		b.keepStray(line)
		return
	}
	b.reply(b.handle(line[len(bridgeFramePrefix):]))
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
	timer := time.NewTimer(time.Duration(seconds * float64(time.Second)))
	defer timer.Stop()
	select {
	case <-timer.C:
	case <-b.ctx.Done():
	}
	return bridgeReply{OK: true}
}

func (b *bridge) fetch(req bridgeRequest) bridgeReply {
	if err := ssrf.CheckURL(req.URL, b.egress); err != nil {
		return bridgeFailure("blocked", "this destination is not permitted by the deployment's egress policy")
	}
	body, err := base64.StdEncoding.DecodeString(req.BodyB64)
	if err != nil {
		return bridgeFailure("protocol", "request body is not valid base64")
	}
	if len(body) > maxFetchBodyBytes {
		return bridgeFailure("limit", "request body exceeds the size limit")
	}
	timeout := defaultFetchTimeout
	if req.Timeout > 0 {
		timeout = time.Duration(req.Timeout * float64(time.Second))
	}
	ctx, cancel := context.WithTimeout(b.ctx, timeout)
	defer cancel()

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
	transport.DialContext = ssrf.SafeDialer(egress)
	return &http.Client{
		Transport: transport,
		CheckRedirect: func(req *http.Request, via []*http.Request) error {
			if len(via) >= maxFetchRedirects {
				return errTooManyRedirects
			}
			return ssrf.CheckURL(req.URL.String(), egress)
		},
	}
}
