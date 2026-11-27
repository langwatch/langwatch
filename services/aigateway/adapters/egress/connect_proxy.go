package egress

import (
	"bufio"
	"context"
	"crypto/rand"
	"crypto/subtle"
	"encoding/base64"
	"encoding/hex"
	"errors"
	"fmt"
	"io"
	"math"
	"net"
	"net/http"
	"sync"
	"time"

	"go.uber.org/zap"
)

// connectRequestTimeout bounds how long a client may take to send CONNECT.
const connectRequestTimeout = 10 * time.Second

// maxConnectHeadBytes caps the CONNECT request head read before authorizing.
const maxConnectHeadBytes = 16 << 10

// proxyUser is the fixed user name; the per-process token is the password.
const proxyUser = "langwatch-egress"

// ConnectProxy is an in-process HTTP CONNECT proxy on loopback that dials
// every tunnel through a policy Dialer. Bifrost builds its own provider
// clients and offers no dialer hook, only a proxy setting, so this is how
// its connections get the same pinned, policy-checked dial as every other
// customer-endpoint call. It answers only CONNECT carrying its own token.
type ConnectProxy struct {
	listener net.Listener
	dialer   Dialer
	token    string
	logger   *zap.Logger
	// ctx ends every upstream dial when Close runs.
	ctx    context.Context
	cancel context.CancelFunc

	mu     sync.Mutex
	conns  map[net.Conn]struct{}
	closed bool
	wg     sync.WaitGroup
}

// StartConnectProxy listens on a random loopback port and serves until Close.
func StartConnectProxy(dialer Dialer, logger *zap.Logger) (*ConnectProxy, error) {
	if logger == nil {
		logger = zap.NewNop()
	}
	secret := make([]byte, 32)
	if _, err := rand.Read(secret); err != nil {
		return nil, err
	}
	listener, err := (&net.ListenConfig{}).Listen(context.Background(), "tcp", "127.0.0.1:0")
	if err != nil {
		return nil, err
	}
	ctx, cancel := context.WithCancel(context.Background())
	p := &ConnectProxy{
		listener: listener,
		dialer:   dialer,
		token:    hex.EncodeToString(secret),
		logger:   logger,
		ctx:      ctx,
		cancel:   cancel,
		conns:    map[net.Conn]struct{}{},
	}
	p.wg.Add(1)
	go p.serve()
	return p, nil
}

// URL is the proxy's address, without credentials.
func (p *ConnectProxy) URL() string { return "http://" + p.listener.Addr().String() }

// Username and Password are the credentials a client must present.
func (p *ConnectProxy) Username() string { return proxyUser }

// Password is the per-process token.
func (p *ConnectProxy) Password() string { return p.token }

// Close stops the listener and every open tunnel.
func (p *ConnectProxy) Close() {
	if p == nil {
		return
	}
	p.mu.Lock()
	if p.closed {
		p.mu.Unlock()
		return
	}
	p.closed = true
	p.cancel()
	_ = p.listener.Close()
	for conn := range p.conns {
		_ = conn.Close()
	}
	p.mu.Unlock()
	p.wg.Wait()
}

func (p *ConnectProxy) serve() {
	defer p.wg.Done()
	for {
		conn, err := p.listener.Accept()
		if err != nil {
			return
		}
		if !p.track(conn) {
			_ = conn.Close()
			return
		}
		p.wg.Add(1)
		go func() {
			defer p.wg.Done()
			defer p.untrack(conn)
			p.handle(conn)
		}()
	}
}

func (p *ConnectProxy) track(conn net.Conn) bool {
	p.mu.Lock()
	defer p.mu.Unlock()
	if p.closed {
		return false
	}
	p.conns[conn] = struct{}{}
	return true
}

func (p *ConnectProxy) untrack(conn net.Conn) {
	p.mu.Lock()
	delete(p.conns, conn)
	p.mu.Unlock()
	_ = conn.Close()
}

func (p *ConnectProxy) handle(client net.Conn) {
	_ = client.SetReadDeadline(time.Now().Add(connectRequestTimeout))
	head := &io.LimitedReader{R: client, N: maxConnectHeadBytes}
	reader := bufio.NewReader(head)
	req, err := http.ReadRequest(reader)
	if err != nil {
		return
	}
	head.N = math.MaxInt64
	if req.Method != http.MethodConnect {
		writeStatus(client, http.StatusMethodNotAllowed)
		return
	}
	if !p.authorized(req.Header.Get("Proxy-Authorization")) {
		writeStatus(client, http.StatusProxyAuthRequired)
		return
	}
	target := req.URL.Host
	upstream, err := p.dialer.DialContext(p.ctx, "tcp", target)
	if err != nil {
		status := http.StatusBadGateway
		if errors.Is(err, ErrBlocked) {
			status = http.StatusForbidden
			p.logger.Warn("egress_proxy_refused", zap.String("host", target), zap.Error(err))
		}
		writeStatus(client, status)
		return
	}
	if !p.track(upstream) {
		_ = upstream.Close()
		return
	}
	defer p.untrack(upstream)
	_ = client.SetReadDeadline(time.Time{})
	if _, err := io.WriteString(client, "HTTP/1.1 200 Connection Established\r\n\r\n"); err != nil {
		return
	}
	pipe(client, reader, upstream)
}

func (p *ConnectProxy) authorized(header string) bool {
	want := "Basic " + base64.StdEncoding.EncodeToString([]byte(proxyUser+":"+p.token))
	return subtle.ConstantTimeCompare([]byte(header), []byte(want)) == 1
}

// pipe copies both ways until either side ends, then closes both.
func pipe(client net.Conn, clientReader io.Reader, upstream net.Conn) {
	done := make(chan struct{}, 2)
	go func() {
		_, _ = io.Copy(upstream, clientReader)
		done <- struct{}{}
	}()
	go func() {
		_, _ = io.Copy(client, upstream)
		done <- struct{}{}
	}()
	<-done
	_ = client.Close()
	_ = upstream.Close()
	<-done
}

func writeStatus(conn net.Conn, status int) {
	_, _ = fmt.Fprintf(conn, "HTTP/1.1 %d %s\r\nContent-Length: 0\r\n\r\n", status, http.StatusText(status))
}
