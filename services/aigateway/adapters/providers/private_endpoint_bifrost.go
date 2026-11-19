package providers

import (
	"bufio"
	"context"
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha256"
	"crypto/subtle"
	"crypto/tls"
	"crypto/x509"
	"encoding/base64"
	"encoding/hex"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"strings"
	"sync"
	"time"

	bfschemas "github.com/maximhq/bifrost/core/schemas"
	"go.uber.org/zap"

	"github.com/langwatch/langwatch/services/aigateway/domain"
)

// How a bound credential's call reaches its private endpoint through Bifrost.
//
// Bifrost builds one fasthttp client per provider key, once, and its dial
// function has no request context. Its only per-provider dial hook is the
// proxy setting. So a bound call is enqueued on a provider key of its own,
// derived from the endpoint and the binding ("private-url-<hash>"), whose
// config routes the client through an in-process CONNECT proxy on loopback.
// The proxy authenticates the provider key, looks its binding up and dials
// the binding's registered addresses (privateEndpointDialer): no DNS, the
// exact hostname and port only. TLS runs end to end inside the tunnel, so
// SNI, certificate verification and the Host header all use the hostname.
//
// One provider key per binding also means one connection pool per binding:
// a pooled connection to a private endpoint can never serve another tenant's
// unbound call to the same name, nor the other way round. Unbound calls keep
// their provider key, client and Bifrost's own dial guard unchanged.
//
// The swap to the derived key happens at the Bifrost call (pinnedProvider),
// after every gateway decision that reads the provider key, so lane choice,
// parameter policy and credential checks see the same key they always did.

// privateEndpointPrefix namespaces the provider keys derived for calls pinned
// to a private endpoint.
const privateEndpointPrefix = "private-url-"

func isPrivateEndpointProvider(provider bfschemas.ModelProvider) bool {
	return strings.HasPrefix(string(provider), privateEndpointPrefix)
}

// privateEndpointSeam holds test-only overrides. Production leaves it zero.
type privateEndpointSeam struct {
	// allowLoopback lets a binding carry a loopback address, so a local TLS
	// server can stand in for the private endpoint.
	allowLoopback bool
	// caCertPEM is an extra CA the pinned clients trust, for that server's
	// certificate.
	caCertPEM string
}

// privateEndpointBaseEndpoint is the endpoint Bifrost would reach for this
// credential and provider, re-based onto a provider type that can be derived
// per endpoint. The shared vLLM provider cannot (Bifrost does not accept it as
// a custom base), so its OpenAI-compatible calls go through an OpenAI-type
// provider, which speaks the same wire. ok is false for a provider that
// cannot be pinned; validateCredentialEndpoints refuses those first.
func privateEndpointBaseEndpoint(cred domain.Credential, provider bfschemas.ModelProvider) (anthropicCompatEndpoint, bool) {
	switch {
	case provider == bfschemas.VLLM:
		return anthropicCompatEndpoint{
			baseURL:  normalizeOpenAICompatBaseURL(credBaseURL(cred)),
			keyless:  strings.TrimSpace(cred.APIKey) == "",
			baseType: bfschemas.OpenAI,
		}, true
	case strings.HasPrefix(string(provider), openAICompatPrefix):
		endpoint, _ := openAIResponsesEndpointForCred(cred)
		return endpoint, true
	case isURLDerivedProvider(provider):
		endpoint, _ := compatEndpointForCred(cred)
		return endpoint, true
	default:
		return anthropicCompatEndpoint{}, false
	}
}

// pinnedProvider returns the Bifrost provider key a call for cred must be
// enqueued on. An unbound credential keeps provider. A bound one gets the
// derived key of its endpoint and binding, registered so the account can
// build its config.
func (r *BifrostRouter) pinnedProvider(cred domain.Credential, provider bfschemas.ModelProvider) bfschemas.ModelProvider {
	ep, bound := boundEndpointForCredential(cred)
	if !bound || r.anthropicCompat == nil {
		return provider
	}
	endpoint, ok := privateEndpointBaseEndpoint(cred, provider)
	if !ok {
		return provider
	}
	pinned := ep
	endpoint.pin = &pinned
	sum := sha256.Sum256([]byte(fmt.Sprintf("%s|%s|keyless=%t|%s",
		endpoint.baseType, endpoint.baseURL, endpoint.keyless, ep.Identity())))
	key := bfschemas.ModelProvider(privateEndpointPrefix + hex.EncodeToString(sum[:8]))
	return r.anthropicCompat.registerEndpoint(endpoint, key)
}

// privateEndpointProxy is the in-process CONNECT proxy pinned providers dial
// through. It listens on loopback only and accepts a tunnel only for a live
// pinned provider key presenting that key's secret, to that key's exact
// hostname and port.
type privateEndpointProxy struct {
	registry *anthropicCompatRegistry
	dialer   privateEndpointDialer
	logger   *zap.Logger
	// secret keys the per-provider proxy passwords. Random per process, so a
	// password is only ever valid for this process's own providers.
	secret []byte

	once   sync.Once
	url    string
	err    error
	server *http.Server
}

func newPrivateEndpointProxy(registry *anthropicCompatRegistry, logger *zap.Logger, allowLoopback bool) *privateEndpointProxy {
	secret := make([]byte, 32)
	_, _ = rand.Read(secret)
	return &privateEndpointProxy{
		registry: registry,
		dialer:   newPrivateEndpointDialer(30*time.Second, allowLoopback),
		logger:   logger,
		secret:   secret,
	}
}

// password is the proxy credential for a provider key. Derived rather than
// stored so a key evicted and registered again keeps the password a still
// running Bifrost provider was built with.
func (p *privateEndpointProxy) password(key string) string {
	mac := hmac.New(sha256.New, p.secret)
	mac.Write([]byte(key))
	return hex.EncodeToString(mac.Sum(nil))
}

// start binds the loopback listener on first use.
func (p *privateEndpointProxy) start() (string, error) {
	p.once.Do(func() {
		ln, err := (&net.ListenConfig{}).Listen(context.Background(), "tcp4", "127.0.0.1:0")
		if err != nil {
			p.err = fmt.Errorf("private endpoint proxy: %w", err)
			return
		}
		p.server = &http.Server{Handler: p, ReadHeaderTimeout: 10 * time.Second}
		p.url = "http://" + ln.Addr().String()
		go func() { _ = p.server.Serve(ln) }()
	})
	return p.url, p.err
}

func (p *privateEndpointProxy) close() {
	if p == nil || p.server == nil {
		return
	}
	_ = p.server.Close()
}

// proxyConfig is the Bifrost proxy setting for a pinned provider key.
func (p *privateEndpointProxy) proxyConfig(key string) (*bfschemas.ProxyConfig, error) {
	if p == nil {
		return nil, fmt.Errorf("no private endpoint proxy for provider %q", key)
	}
	proxyURL, err := p.start()
	if err != nil {
		return nil, err
	}
	u, user, pass := envVar(proxyURL), envVar(key), envVar(p.password(key))
	return &bfschemas.ProxyConfig{Type: bfschemas.HTTPProxy, URL: &u, Username: &user, Password: &pass}, nil
}

func (p *privateEndpointProxy) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodConnect {
		http.Error(w, "CONNECT only", http.StatusMethodNotAllowed)
		return
	}
	key, ok := p.authenticate(r.Header.Get("Proxy-Authorization"))
	if !ok {
		w.Header().Set("Proxy-Authenticate", `Basic realm="private-endpoint"`)
		http.Error(w, "proxy authentication required", http.StatusProxyAuthRequired)
		return
	}
	endpoint, live := p.registry.lookup(key)
	if !live || endpoint.pin == nil {
		http.Error(w, "unknown private endpoint", http.StatusForbidden)
		return
	}
	upstream, err := p.dialer.DialEndpoint(r.Context(), *endpoint.pin, r.Host)
	if err != nil {
		if p.logger != nil {
			// Operator log: the cause may name the address, which is fine here.
			p.logger.Warn("private endpoint dial failed",
				zap.String("hostname", endpoint.pin.Hostname), zap.Error(errors.Unwrap(err)), zap.String("reason", err.Error()))
		}
		http.Error(w, "private endpoint unreachable", http.StatusBadGateway)
		return
	}
	hj, ok := w.(http.Hijacker)
	if !ok {
		_ = upstream.Close()
		http.Error(w, "tunnel unsupported", http.StatusInternalServerError)
		return
	}
	client, buf, err := hj.Hijack()
	if err != nil {
		_ = upstream.Close()
		return
	}
	if _, err := client.Write([]byte("HTTP/1.1 200 Connection established\r\n\r\n")); err != nil {
		_ = client.Close()
		_ = upstream.Close()
		return
	}
	splice(client, buf.Reader, upstream)
}

// authenticate checks a Basic Proxy-Authorization value and returns the
// provider key it names.
func (p *privateEndpointProxy) authenticate(header string) (string, bool) {
	const prefix = "Basic "
	if len(header) < len(prefix) || !strings.EqualFold(header[:len(prefix)], prefix) {
		return "", false
	}
	raw, err := base64.StdEncoding.DecodeString(strings.TrimSpace(header[len(prefix):]))
	if err != nil {
		return "", false
	}
	user, pass, found := strings.Cut(string(raw), ":")
	if !found || !isPrivateEndpointProvider(bfschemas.ModelProvider(user)) {
		return "", false
	}
	if subtle.ConstantTimeCompare([]byte(pass), []byte(p.password(user))) != 1 {
		return "", false
	}
	return user, true
}

// splice copies both directions until either side closes.
func splice(client net.Conn, clientReader *bufio.Reader, upstream net.Conn) {
	done := make(chan struct{}, 2)
	go func() {
		_, _ = io.Copy(upstream, clientReader)
		closeWrite(upstream)
		done <- struct{}{}
	}()
	go func() {
		_, _ = io.Copy(client, upstream)
		closeWrite(client)
		done <- struct{}{}
	}()
	<-done
	<-done
	_ = client.Close()
	_ = upstream.Close()
}

func closeWrite(c net.Conn) {
	if tc, ok := c.(interface{ CloseWrite() error }); ok {
		_ = tc.CloseWrite()
		return
	}
	_ = c.Close()
}

// privateEndpointClients holds one net/http client per binding for the
// direct HTTP lanes that apply bindings (model discovery). One client per
// binding keeps a pinned connection out of every other caller's pool.
type privateEndpointClients struct {
	mu      sync.Mutex
	clients map[string]*http.Client
	dialer  privateEndpointDialer
	roots   *x509.CertPool
}

// privateEndpointClientsMax bounds the cache; past it the cache starts over.
const privateEndpointClientsMax = 64

func newPrivateEndpointClients(seam privateEndpointSeam) *privateEndpointClients {
	c := &privateEndpointClients{
		clients: map[string]*http.Client{},
		dialer:  newPrivateEndpointDialer(modelsDiscoveryTimeout, seam.allowLoopback),
	}
	if seam.caCertPEM != "" {
		roots, err := x509.SystemCertPool()
		if err != nil || roots == nil {
			roots = x509.NewCertPool()
		}
		roots.AppendCertsFromPEM([]byte(seam.caCertPEM))
		c.roots = roots
	}
	return c
}

// client returns the discovery client for ep: no redirects, no proxy from the
// environment, every dial pinned to the binding.
func (c *privateEndpointClients) client(ep domain.PrivateEndpoint) *http.Client {
	id := ep.Identity()
	c.mu.Lock()
	defer c.mu.Unlock()
	if existing, ok := c.clients[id]; ok {
		return existing
	}
	if len(c.clients) >= privateEndpointClientsMax {
		for _, old := range c.clients {
			old.CloseIdleConnections()
		}
		c.clients = map[string]*http.Client{}
	}
	dialer := c.dialer
	transport := &http.Transport{
		DialContext: func(ctx context.Context, _, address string) (net.Conn, error) {
			return dialer.DialEndpoint(ctx, ep, address)
		},
		TLSClientConfig:     &tls.Config{MinVersion: tls.VersionTLS12, RootCAs: c.roots},
		TLSHandshakeTimeout: modelsDiscoveryTimeout,
		MaxIdleConnsPerHost: 4,
		IdleConnTimeout:     30 * time.Second,
	}
	client := &http.Client{
		Timeout:   modelsDiscoveryTimeout,
		Transport: transport,
		CheckRedirect: func(*http.Request, []*http.Request) error {
			return http.ErrUseLastResponse
		},
	}
	c.clients[id] = client
	return client
}
