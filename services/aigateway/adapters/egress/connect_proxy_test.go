package egress

import (
	"bufio"
	"encoding/base64"
	"io"
	"net"
	"net/http"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// echoListener accepts on loopback and echoes one line per connection.
func echoListener(t *testing.T) (address string, accepted chan struct{}) {
	t.Helper()
	ln, err := net.Listen("tcp", "127.0.0.1:0")
	require.NoError(t, err)
	t.Cleanup(func() { _ = ln.Close() })
	accepted = make(chan struct{}, 8)
	go func() {
		for {
			conn, err := ln.Accept()
			if err != nil {
				return
			}
			accepted <- struct{}{}
			go func() {
				defer func() { _ = conn.Close() }()
				line, _ := bufio.NewReader(conn).ReadString('\n')
				_, _ = io.WriteString(conn, line)
			}()
		}
	}()
	return ln.Addr().String(), accepted
}

func startProxy(t *testing.T, policy Policy) *ConnectProxy {
	t.Helper()
	proxy, err := StartConnectProxy(policy.Dialer(2*time.Second), nil)
	require.NoError(t, err)
	t.Cleanup(proxy.Close)
	return proxy
}

func proxyRequest(t *testing.T, proxy *ConnectProxy, request string) (net.Conn, *bufio.Reader, int) {
	t.Helper()
	conn, err := net.Dial("tcp", proxy.listener.Addr().String())
	require.NoError(t, err)
	t.Cleanup(func() { _ = conn.Close() })
	_, err = io.WriteString(conn, request)
	require.NoError(t, err)
	reader := bufio.NewReader(conn)
	resp, err := http.ReadResponse(reader, nil)
	require.NoError(t, err)
	return conn, reader, resp.StatusCode
}

func connect(proxy *ConnectProxy, target string, withAuth bool) string {
	request := "CONNECT " + target + " HTTP/1.1\r\nHost: " + target + "\r\n"
	if withAuth {
		auth := base64.StdEncoding.EncodeToString([]byte(proxy.Username() + ":" + proxy.Password()))
		request += "Proxy-Authorization: Basic " + auth + "\r\n"
	}
	return request + "\r\n"
}

func TestConnectProxyTunnelsToAnAddressThePolicyAdmits(t *testing.T) {
	target, accepted := echoListener(t)
	proxy := startProxy(t, NewPolicy(true, []string{"127.0.0.1"}))

	conn, reader, status := proxyRequest(t, proxy, connect(proxy, target, true))
	require.Equal(t, http.StatusOK, status)
	_, err := io.WriteString(conn, "ping\n")
	require.NoError(t, err)
	line, err := reader.ReadString('\n')
	require.NoError(t, err)
	assert.Equal(t, "ping\n", line)
	assert.Len(t, accepted, 1)
}

func TestConnectProxyRefusesAnAddressThePolicyRefusesWithoutConnecting(t *testing.T) {
	target, accepted := echoListener(t)
	_, port, _ := net.SplitHostPort(target)
	proxy := startProxy(t, NewPolicy(false, nil).WithLookup(loopbackLookup))

	_, _, status := proxyRequest(t, proxy, connect(proxy, net.JoinHostPort("rebind.example", port), true))
	assert.Equal(t, http.StatusForbidden, status)
	_, _, status = proxyRequest(t, proxy, connect(proxy, "169.254.169.254:80", true))
	assert.Equal(t, http.StatusForbidden, status)
	assert.Empty(t, accepted, "a refused target is never connected to")
}

func TestConnectProxyAnswersOnlyItsOwnAuthenticatedConnect(t *testing.T) {
	target, accepted := echoListener(t)
	proxy := startProxy(t, NewPolicy(false, nil))

	_, _, status := proxyRequest(t, proxy, connect(proxy, target, false))
	assert.Equal(t, http.StatusProxyAuthRequired, status)
	_, _, status = proxyRequest(t, proxy, "GET http://"+target+"/ HTTP/1.1\r\nHost: "+target+"\r\n\r\n")
	assert.Equal(t, http.StatusMethodNotAllowed, status)
	assert.Empty(t, accepted)
}
