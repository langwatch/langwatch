package egress

import (
	"context"
	"crypto/tls"
	"crypto/x509"
	"errors"
	"io"
	"net"
	"net/http"
	"net/netip"
	"os"
	"strconv"
	"strings"
	"syscall"
	"time"

	"github.com/langwatch/langwatch/pkg/ssrf"
)

// maxRedirects bounds a followed redirect chain.
const maxRedirects = 10

// headersTimeout backs a caller without a deadline, as undici's 300s default does.
const headersTimeout = 300 * time.Second

// originBoundHeaders never travel to another origin on a redirect.
var originBoundHeaders = []string{"authorization", "cookie", "proxy-authorization", "host"}

// RedirectRefusedError is a redirect this client declined to follow.
type RedirectRefusedError struct{ Message string }

func (e *RedirectRefusedError) Error() string { return e.Message }

// msgRedirectsUnjudged is what packages/egress answers a redirect it was
// given no policy to judge, which is how the Node child calls it.
const msgRedirectsUnjudged = "Redirects are not followed without an address policy to judge the next hop."

// Request is one outbound call.
type Request struct {
	Method  string
	URL     string
	Headers map[string]string
	// Body is sent when non-nil.
	Body *string
}

// Response is a fully read response.
type Response struct {
	Status     int
	StatusText string
	Header     http.Header
	Body       []byte
}

// OK reports a 2xx status.
func (r *Response) OK() bool { return r.Status >= 200 && r.Status < 300 }

// ClientOptions configure a Client.
type ClientOptions struct {
	Validator *Validator
	// RejectUnauthorized verifies TLS certificates (NODE_TLS_REJECT_UNAUTHORIZED
	// != "0" in the Node child).
	RejectUnauthorized bool
	// ExtraCAFile is a PEM bundle trusted beside the system roots
	// (NODE_EXTRA_CA_CERTS in the Node child).
	ExtraCAFile string
	// FollowRedirects re-validates and follows each hop. Off, a redirect is
	// refused, which is what the Node child does today.
	FollowRedirects bool
}

// Client makes fenced requests: each destination is validated, then dialed
// at the address it was judged at.
type Client struct {
	opts  ClientOptions
	roots *x509.CertPool
}

// NewClient returns a fenced client.
func NewClient(opts ClientOptions) *Client {
	return &Client{opts: opts, roots: rootsWith(opts.ExtraCAFile)}
}

func rootsWith(extraCAFile string) *x509.CertPool {
	if extraCAFile == "" {
		return nil
	}
	pem, err := os.ReadFile(extraCAFile)
	if err != nil {
		return nil
	}
	pool, err := x509.SystemCertPool()
	if err != nil || pool == nil {
		pool = x509.NewCertPool()
	}
	pool.AppendCertsFromPEM(pem)
	return pool
}

// Do validates the URL and performs the request.
func (c *Client) Do(ctx context.Context, req Request) (*Response, error) {
	dest, err := c.opts.Validator.Validate(ctx, req.URL)
	if err != nil {
		return nil, err
	}
	return c.fetch(ctx, hop{dest: dest, req: req})
}

// hop is one request of a redirect chain.
type hop struct {
	dest Destination
	req  Request
	n    int
}

func (c *Client) fetch(ctx context.Context, h hop) (*Response, error) {
	resp, err := c.send(ctx, h.dest, h.req)
	if err != nil {
		return nil, err
	}
	location := resp.Header.Get("Location")
	if resp.Status >= 300 && resp.Status < 400 && location != "" {
		return c.followRedirect(ctx, redirect{dest: h.dest, req: h.req, hops: h.n, status: resp.Status, location: location})
	}
	return resp, nil
}

type redirect struct {
	dest     Destination
	req      Request
	hops     int
	status   int
	location string
}

func (c *Client) followRedirect(ctx context.Context, r redirect) (*Response, error) {
	if !c.opts.FollowRedirects {
		return nil, &RedirectRefusedError{Message: msgRedirectsUnjudged}
	}
	if r.hops >= maxRedirects {
		return nil, refusalf("Too many redirects (max %d)", maxRedirects)
	}
	next, err := r.dest.URL.Parse(r.location)
	if err != nil {
		return nil, refusal(msgInvalidURL)
	}
	nextDest, err := c.opts.Validator.Validate(ctx, next.String())
	if err != nil {
		return nil, err
	}
	nextReq := Request{Method: r.req.Method, URL: next.String(), Headers: r.req.Headers, Body: r.req.Body}
	if origin(next.Scheme, next.Host) != origin(r.dest.URL.Scheme, r.dest.URL.Host) {
		nextReq.Headers = withoutOriginBound(r.req.Headers)
	}
	if r.status == http.StatusSeeOther || (r.status != http.StatusTemporaryRedirect && r.status != http.StatusPermanentRedirect && r.req.Method == http.MethodPost) {
		nextReq.Method, nextReq.Body = http.MethodGet, nil
	}
	return c.fetch(ctx, hop{dest: nextDest, req: nextReq, n: r.hops + 1})
}

func origin(scheme, host string) string { return scheme + "://" + strings.ToLower(host) }

func withoutOriginBound(headers map[string]string) map[string]string {
	out := make(map[string]string, len(headers))
	for k, v := range headers {
		drop := false
		for _, bound := range originBoundHeaders {
			if strings.EqualFold(k, bound) {
				drop = true
			}
		}
		if !drop {
			out[k] = v
		}
	}
	return out
}

func (c *Client) send(ctx context.Context, dest Destination, req Request) (*Response, error) {
	httpReq, err := c.buildRequest(ctx, dest, req)
	if err != nil {
		return nil, err
	}
	transport := c.transport(dest)
	defer transport.CloseIdleConnections()
	client := &http.Client{
		Transport:     transport,
		CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse },
	}
	resp, err := client.Do(httpReq)
	if err != nil {
		return nil, connectionError(err, dest)
	}
	defer func() { _ = resp.Body.Close() }()
	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, connectionError(err, dest)
	}
	return &Response{
		Status:     resp.StatusCode,
		StatusText: strings.TrimSpace(strings.TrimPrefix(resp.Status, strconv.Itoa(resp.StatusCode))),
		Header:     resp.Header,
		Body:       body,
	}, nil
}

func (c *Client) buildRequest(ctx context.Context, dest Destination, req Request) (*http.Request, error) {
	target := *dest.URL
	target.Host = dest.RequestHost + ":" + strconv.Itoa(dest.Port)
	var body io.Reader
	if req.Body != nil {
		body = strings.NewReader(*req.Body)
	}
	httpReq, err := http.NewRequestWithContext(ctx, req.Method, target.String(), body)
	if err != nil {
		return nil, err
	}
	httpReq.Host = dest.RequestHost
	for k, v := range req.Headers {
		if strings.EqualFold(k, "host") {
			httpReq.Host = v
			continue
		}
		httpReq.Header.Set(k, v)
	}
	return httpReq, nil
}

func (c *Client) transport(dest Destination) *http.Transport {
	dialer := &net.Dialer{Timeout: 30 * time.Second, KeepAlive: 30 * time.Second}
	return &http.Transport{
		DialContext: func(ctx context.Context, network, addr string) (net.Conn, error) {
			_, port, err := net.SplitHostPort(addr)
			if err != nil {
				return nil, err
			}
			ip, err := connectAddress(ctx, dest)
			if err != nil {
				return nil, err
			}
			return dialer.DialContext(ctx, network, net.JoinHostPort(ip.String(), port))
		},
		TLSClientConfig: &tls.Config{
			ServerName:         dest.Hostname,
			RootCAs:            c.roots,
			InsecureSkipVerify: !c.opts.RejectUnauthorized, //nolint:gosec // G402: the deployment's own TLS policy, as the Node child applies NODE_TLS_REJECT_UNAUTHORIZED
			MinVersion:         tls.VersionTLS12,
		},
		ResponseHeaderTimeout: headersTimeout,
		ForceAttemptHTTP2:     true,
	}
}

// connectAddress is the pinned address, or for a destination that did not
// resolve at judgement time every address resolved now, metadata refused.
func connectAddress(ctx context.Context, dest Destination) (netip.Addr, error) {
	if dest.Pinned.IsValid() {
		return dest.Pinned, nil
	}
	addrs, err := net.DefaultResolver.LookupNetIP(ctx, "ip", dest.Hostname)
	if err != nil || len(addrs) == 0 {
		return netip.Addr{}, &net.DNSError{Err: "no such host", Name: dest.Hostname, IsNotFound: true}
	}
	for _, a := range addrs {
		if ssrf.Classify(a) == ssrf.CategoryMetadata {
			return netip.Addr{}, refusal(msgResolvesMetadata)
		}
	}
	return addrs[0].Unmap(), nil
}

// connectionError words a socket failure as packages/egress does.
func connectionError(err error, dest Destination) error {
	var refused *RedirectRefusedError
	if errors.As(err, &refused) {
		return refused
	}
	host, port := dest.RequestHost, dest.Port
	var dnsErr *net.DNSError
	var certErr *tls.CertificateVerificationError
	var unknownAuth x509.UnknownAuthorityError
	var invalidCert x509.CertificateInvalidError
	var hostnameErr x509.HostnameError
	switch {
	case errors.Is(err, syscall.ECONNREFUSED):
		return refusalf("Connection refused - is the server running at %s:%d?", host, port)
	case errors.As(err, &dnsErr):
		return refusalf("Could not resolve hostname: %s", host)
	case errors.Is(err, syscall.ECONNRESET):
		return refusalf("Connection was reset by %s:%d", host, port)
	case errors.As(err, &certErr), errors.As(err, &unknownAuth), errors.As(err, &invalidCert), errors.As(err, &hostnameErr):
		return refusalf("TLS certificate error for %s: %s", host, innermost(err))
	case isTimeout(err):
		return refusalf("Connection timed out while connecting to %s:%d", host, port)
	}
	return refusalf("Connection failed to %s:%d: %s", host, port, innermost(err))
}

func isTimeout(err error) bool {
	var netErr net.Error
	return errors.As(err, &netErr) && netErr.Timeout()
}

func innermost(err error) string {
	for {
		next := errors.Unwrap(err)
		if next == nil {
			return err.Error()
		}
		err = next
	}
}
