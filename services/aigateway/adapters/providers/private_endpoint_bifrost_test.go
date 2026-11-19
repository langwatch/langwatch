package providers

import (
	"context"
	"crypto/ecdsa"
	"crypto/elliptic"
	"crypto/rand"
	"crypto/tls"
	"crypto/x509"
	"crypto/x509/pkix"
	"encoding/pem"
	"io"
	"math/big"
	"net"
	"net/http"
	"net/http/httptest"
	"net/netip"
	"strconv"
	"sync"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"go.uber.org/zap"

	"github.com/langwatch/langwatch/services/aigateway/domain"
)

const boundHost = "llm.internal.acme.test"

// privateEndpointServer is a TLS server on loopback standing in for a
// customer's PrivateLink endpoint. Its certificate covers only the bound
// hostname, so a call that reached it with any other SNI, or verified it
// against an address, fails the handshake.
type privateEndpointServer struct {
	srv   *httptest.Server
	caPEM string
	port  int

	mu       sync.Mutex
	requests []seenRequest
}

type seenRequest struct {
	sni, host, path, auth string
}

func newPrivateEndpointServer(t *testing.T) *privateEndpointServer {
	t.Helper()
	caKey, err := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	require.NoError(t, err)
	caTmpl := &x509.Certificate{
		SerialNumber:          big.NewInt(1),
		Subject:               pkix.Name{CommonName: "private endpoint test CA"},
		NotBefore:             time.Now().Add(-time.Hour),
		NotAfter:              time.Now().Add(time.Hour),
		IsCA:                  true,
		KeyUsage:              x509.KeyUsageCertSign,
		BasicConstraintsValid: true,
	}
	caDER, err := x509.CreateCertificate(rand.Reader, caTmpl, caTmpl, &caKey.PublicKey, caKey)
	require.NoError(t, err)
	caCert, err := x509.ParseCertificate(caDER)
	require.NoError(t, err)

	leafKey, err := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	require.NoError(t, err)
	leafTmpl := &x509.Certificate{
		SerialNumber: big.NewInt(2),
		Subject:      pkix.Name{CommonName: boundHost},
		DNSNames:     []string{boundHost},
		NotBefore:    time.Now().Add(-time.Hour),
		NotAfter:     time.Now().Add(time.Hour),
		KeyUsage:     x509.KeyUsageDigitalSignature,
		ExtKeyUsage:  []x509.ExtKeyUsage{x509.ExtKeyUsageServerAuth},
	}
	leafDER, err := x509.CreateCertificate(rand.Reader, leafTmpl, caCert, &leafKey.PublicKey, caKey)
	require.NoError(t, err)

	pe := &privateEndpointServer{
		caPEM: string(pem.EncodeToMemory(&pem.Block{Type: "CERTIFICATE", Bytes: caDER})),
	}
	pe.srv = httptest.NewUnstartedServer(http.HandlerFunc(pe.serve))
	pe.srv.TLS = &tls.Config{Certificates: []tls.Certificate{{
		Certificate: [][]byte{leafDER},
		PrivateKey:  leafKey,
	}}}
	pe.srv.StartTLS()
	t.Cleanup(pe.srv.Close)
	_, port, err := net.SplitHostPort(pe.srv.Listener.Addr().String())
	require.NoError(t, err)
	pe.port, err = strconv.Atoi(port)
	require.NoError(t, err)
	return pe
}

func (pe *privateEndpointServer) serve(w http.ResponseWriter, r *http.Request) {
	_, _ = io.Copy(io.Discard, r.Body)
	pe.mu.Lock()
	pe.requests = append(pe.requests, seenRequest{sni: r.TLS.ServerName, host: r.Host, path: r.URL.Path, auth: r.Header.Get("Authorization")})
	pe.mu.Unlock()
	w.Header().Set("Content-Type", "application/json")
	switch r.URL.Path {
	case "/v1/models":
		_, _ = w.Write([]byte(`{"object":"list","data":[{"id":"acme-model","object":"model"}]}`))
	default:
		_, _ = w.Write([]byte(`{"id":"chatcmpl-1","object":"chat.completion","created":1,"model":"acme-model",` +
			`"choices":[{"index":0,"message":{"role":"assistant","content":"hello from the private endpoint"},"finish_reason":"stop"}],` +
			`"usage":{"prompt_tokens":3,"completion_tokens":5,"total_tokens":8}}`))
	}
}

func (pe *privateEndpointServer) seen() []seenRequest {
	pe.mu.Lock()
	defer pe.mu.Unlock()
	return append([]seenRequest(nil), pe.requests...)
}

func (pe *privateEndpointServer) binding() domain.PrivateEndpoint {
	return domain.PrivateEndpoint{
		Hostname:  boundHost,
		Addresses: []netip.Addr{netip.MustParseAddr("127.0.0.1")},
		Port:      pe.port,
	}
}

func (pe *privateEndpointServer) baseURL() string {
	return "https://" + boundHost + ":" + strconv.Itoa(pe.port) + "/v1"
}

func newPinnedTestRouter(t *testing.T, caPEM string) *BifrostRouter {
	t.Helper()
	router, err := NewBifrostRouter(context.Background(), BifrostOptions{
		Logger:                        zap.NewNop(),
		BlockLocalHTTPCalls:           true,
		RequireHTTPSCustomerEndpoints: true,
		privateEndpointSeam:           privateEndpointSeam{allowLoopback: true, caCertPEM: caPEM},
	})
	require.NoError(t, err)
	t.Cleanup(router.Close)
	return router
}

func chatRequest() *domain.Request {
	return &domain.Request{
		Type:  domain.RequestTypeChat,
		Model: "acme-model",
		Body:  []byte(`{"model":"acme-model","messages":[{"role":"user","content":"hi"}]}`),
	}
}

// Scenario: an AI gateway virtual-key request reaches the private endpoint
// through a bound hostname, with SNI and certificate checks on the hostname.
func TestBifrostDispatchReachesPrivateEndpointThroughBoundHostname(t *testing.T) {
	pe := newPrivateEndpointServer(t)
	router := newPinnedTestRouter(t, pe.caPEM)
	cred := customCred(pe.baseURL(), pe.binding())

	resp, err := router.Dispatch(context.Background(), chatRequest(), cred)
	require.NoError(t, err)
	assert.Equal(t, http.StatusOK, resp.StatusCode)
	assert.Contains(t, string(resp.Body), "hello from the private endpoint")

	seen := pe.seen()
	require.Len(t, seen, 1)
	assert.Equal(t, boundHost, seen[0].sni, "TLS SNI is the bound hostname")
	assert.Equal(t, boundHost+":"+strconv.Itoa(pe.port), seen[0].host, "the Host header keeps the hostname")
	assert.Equal(t, "/v1/chat/completions", seen[0].path)
	assert.Equal(t, "Bearer sk-acme", seen[0].auth)
}

func TestBifrostDispatchStreamReachesPrivateEndpoint(t *testing.T) {
	pe := newPrivateEndpointServer(t)
	pe.srv.Config.Handler = http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_, _ = io.Copy(io.Discard, r.Body)
		pe.mu.Lock()
		pe.requests = append(pe.requests, seenRequest{sni: r.TLS.ServerName, host: r.Host, path: r.URL.Path})
		pe.mu.Unlock()
		w.Header().Set("Content-Type", "text/event-stream")
		_, _ = w.Write([]byte(`data: {"id":"c1","object":"chat.completion.chunk","created":1,"model":"acme-model","choices":[{"index":0,"delta":{"role":"assistant","content":"hi"},"finish_reason":null}]}` + "\n\n"))
		_, _ = w.Write([]byte(`data: {"id":"c1","object":"chat.completion.chunk","created":1,"model":"acme-model","choices":[{"index":0,"delta":{},"finish_reason":"stop"}],"usage":{"prompt_tokens":1,"completion_tokens":1,"total_tokens":2}}` + "\n\n"))
		_, _ = w.Write([]byte("data: [DONE]\n\n"))
	})
	router := newPinnedTestRouter(t, pe.caPEM)
	req := chatRequest()
	req.Body = []byte(`{"model":"acme-model","stream":true,"messages":[{"role":"user","content":"hi"}]}`)

	iter, err := router.DispatchStream(context.Background(), req, customCred(pe.baseURL(), pe.binding()))
	require.NoError(t, err)
	defer func() { _ = iter.Close() }()
	chunks := 0
	for iter.Next(context.Background()) {
		chunks++
	}
	require.NoError(t, iter.Err())
	assert.Positive(t, chunks)
	seen := pe.seen()
	require.NotEmpty(t, seen)
	assert.Equal(t, boundHost, seen[0].sni)
}

// Scenario: another organization's call to the same hostname carries no
// binding, so it is resolved as usual and never reaches the endpoint.
func TestBifrostDispatchWithoutBindingNeverReachesPrivateEndpoint(t *testing.T) {
	pe := newPrivateEndpointServer(t)
	router := newPinnedTestRouter(t, pe.caPEM)

	_, err := router.Dispatch(context.Background(), chatRequest(), customCred(pe.baseURL()))
	require.Error(t, err)
	assert.Empty(t, pe.seen(), "an unbound call never reaches the private endpoint")
}

func TestBifrostDispatchRefusesBoundHostnameOnAnotherPort(t *testing.T) {
	pe := newPrivateEndpointServer(t)
	router := newPinnedTestRouter(t, pe.caPEM)
	binding := pe.binding()
	binding.Port = pe.port + 1

	_, err := router.Dispatch(context.Background(), chatRequest(), customCred(pe.baseURL(), binding))
	require.Error(t, err)
	assert.Contains(t, err.Error(), boundHost)
	assert.NotContains(t, err.Error(), "127.0.0.1")
	assert.Empty(t, pe.seen(), "no connection is opened")
}

// Scenario: model discovery reaches the private endpoint through a bound
// hostname.
func TestListModelsReachesPrivateEndpointThroughBoundHostname(t *testing.T) {
	pe := newPrivateEndpointServer(t)
	router := newPinnedTestRouter(t, pe.caPEM)
	router.hostedCatalogs = map[domain.ProviderID]catalogProbe{}

	models, gaps, err := router.ListModels(context.Background(), []domain.Credential{customCred(pe.baseURL(), pe.binding())})
	require.NoError(t, err)
	assert.Empty(t, gaps)
	require.Len(t, models, 1)
	assert.Equal(t, "acme-model", models[0].ID)
	seen := pe.seen()
	require.Len(t, seen, 1)
	assert.Equal(t, boundHost, seen[0].sni)
	assert.Equal(t, "/v1/models", seen[0].path)
}
