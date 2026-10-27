package egress

import (
	"context"
	"net/http"
	"net/http/httptest"
	"net/netip"
	"net/url"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// fakeDNS answers from a table; an unknown name has no records.
func fakeDNS(table map[string]string) Resolver {
	return func(_ context.Context, host string) []netip.Addr {
		if a, ok := table[host]; ok {
			return []netip.Addr{netip.MustParseAddr(a)}
		}
		return nil
	}
}

func TestDecodePolicyRefusesAMissingDocumentByName(t *testing.T) {
	_, err := DecodePolicy("")
	require.ErrorContains(t, err, PolicyEnv+" is not set")
}

func TestDecodePolicyRefusesAPartialDocument(t *testing.T) {
	_, err := DecodePolicy(`{"blockLocal":true}`)
	require.ErrorContains(t, err, "allowedHosts")
}

func TestDecodePolicyReadsTheParentsPolicy(t *testing.T) {
	p, err := DecodePolicy(`{"blockLocal":true,"allowedHosts":["agent.internal.example"]}`)
	require.NoError(t, err)
	assert.Equal(t, Policy{BlockLocal: true, AllowedHosts: []string{"agent.internal.example"}}, p)
}

// @scenario "The fence refuses private, loopback, metadata and cloud-internal destinations"
func TestValidatorRefusals(t *testing.T) {
	dns := fakeDNS(map[string]string{
		"private.example":  "10.1.2.3",
		"loopback.example": "127.0.0.1",
		"imds.example":     "169.254.169.254",
		"public.example":   "93.184.216.34",
	})
	strict := NewValidator(Policy{BlockLocal: true, AllowedHosts: []string{"imds.example", "loopback.example"}}, dns)
	open := NewValidator(Policy{BlockLocal: false}, dns)
	cases := []struct {
		name string
		v    *Validator
		url  string
		want string
	}{
		{"private IP literal", strict, "http://10.0.0.1/", msgPrivateLiteral},
		{"loopback literal", strict, "http://127.0.0.1:8080/", msgPrivateLiteral},
		{"IPv6 loopback literal", strict, "http://[::1]/", msgPrivateLiteral},
		{"name resolving to private", strict, "https://private.example/", msgResolvesPrivate},
		{"metadata literal even when local is allowed", open, "http://169.254.169.254/latest", msgMetadataHost},
		{"metadata name even when local is allowed", open, "http://metadata.google.internal/", msgMetadataHost},
		{"metadata through an allowlisted name", strict, "http://imds.example/", msgResolvesMetadata},
		{"name resolving to metadata when local is allowed", open, "http://imds.example/", msgResolvesMetadata},
		{"cloud internal domain", open, "https://bucket.s3.amazonaws.com/", msgCloudDomain},
		{"unparseable URL", open, "not a url", msgInvalidURL},
		{"unsupported protocol", open, "ftp://public.example/", "Unsupported protocol: ftp:"},
		{"unresolvable when local is blocked", strict, "http://nowhere.example/", `Unable to resolve hostname "nowhere.example"`},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			_, err := tc.v.Validate(context.Background(), tc.url)
			require.ErrorContains(t, err, tc.want)
		})
	}
}

// @scenario "An allowlisted host passes and is pinned to its resolved address"
func TestValidatorAdmissions(t *testing.T) {
	dns := fakeDNS(map[string]string{"loopback.example": "127.0.0.1", "public.example": "93.184.216.34"})
	strict := NewValidator(Policy{BlockLocal: true, AllowedHosts: []string{" Loopback.Example. "}}, dns)

	public, err := strict.Validate(context.Background(), "https://public.example/path?q=1")
	require.NoError(t, err)
	assert.Equal(t, KindResolved, public.Kind)
	assert.Equal(t, netip.MustParseAddr("93.184.216.34"), public.Pinned)
	assert.Equal(t, 443, public.Port)

	allowed, err := strict.Validate(context.Background(), "http://loopback.example:9000/")
	require.NoError(t, err)
	assert.Equal(t, KindAllowlisted, allowed.Kind)
	assert.Equal(t, netip.MustParseAddr("127.0.0.1"), allowed.Pinned)

	open := NewValidator(Policy{BlockLocal: false}, dns)
	unresolved, err := open.Validate(context.Background(), "http://nowhere.example/")
	require.NoError(t, err)
	assert.Equal(t, KindUnresolved, unresolved.Kind)
	assert.False(t, unresolved.Pinned.IsValid())
}

// @scenario "An allowlisted on-premise .local host is reachable"
func TestValidatorAdmitsAnAllowlistedOnPremiseHost(t *testing.T) {
	dns := fakeDNS(map[string]string{"llm.corp.local": "10.0.5.9"})
	strict := NewValidator(Policy{BlockLocal: true, AllowedHosts: []string{"llm.corp.local"}}, dns)

	dest, err := strict.Validate(context.Background(), "http://llm.corp.local./v1/chat")
	require.NoError(t, err)
	assert.Equal(t, KindAllowlisted, dest.Kind)
	assert.Equal(t, netip.MustParseAddr("10.0.5.9"), dest.Pinned)
}

// @scenario "A .local host the allowlist does not name stays refused"
func TestValidatorRefusesAnOnPremiseHostTheAllowlistDoesNotName(t *testing.T) {
	v := NewValidator(Policy{BlockLocal: true, AllowedHosts: []string{"llm.corp.local"}}, fakeDNS(nil))
	_, err := v.Validate(context.Background(), "http://other.corp.local/api")
	require.ErrorContains(t, err, msgCloudDomain)
}

// @scenario "A cloud internal domain cannot be allowlisted"
func TestValidatorRefusesAnAllowlistedCloudDomain(t *testing.T) {
	assertAllowlistRefusesCloudDomains(t, "s3.amazonaws.com", "ip-10-0-0-1.ec2.compute.internal", "grafana.internal")
}

// @scenario "A cloud internal domain with an on-premise suffix added cannot be allowlisted"
func TestValidatorRefusesACloudDomainDressedAsOnPremise(t *testing.T) {
	assertAllowlistRefusesCloudDomains(t,
		"metadata.google.internal.local",
		"metadata.google.internal.local.local",
		"s3.amazonaws.com.localhost.local",
		"s3.amazonaws.com.local.localhost",
		"grafana.internal.local",
	)
}

// assertAllowlistRefusesCloudDomains checks each host is refused as a cloud
// domain even when the allowlist names it exactly.
func assertAllowlistRefusesCloudDomains(t *testing.T, hosts ...string) {
	t.Helper()
	for _, host := range hosts {
		t.Run(host, func(t *testing.T) {
			v := NewValidator(Policy{BlockLocal: true, AllowedHosts: []string{host}}, fakeDNS(nil))
			_, err := v.Validate(context.Background(), "http://"+host+"/")
			require.ErrorContains(t, err, msgCloudDomain)
		})
	}
}

// serverPort is the port an httptest server listens on.
func serverPort(t *testing.T, srv *httptest.Server) string {
	t.Helper()
	u, err := url.Parse(srv.URL)
	require.NoError(t, err)
	return u.Port()
}

// @scenario "The judged address is the one connected to and the name is never resolved again"
func TestClientDialsTheJudgedAddressAndKeepsTheHostHeader(t *testing.T) {
	var gotHost string
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotHost = r.Host
		_, _ = w.Write([]byte("ok"))
	}))
	defer srv.Close()
	lookups := 0
	resolver := func(context.Context, string) []netip.Addr {
		lookups++
		return []netip.Addr{netip.MustParseAddr("127.0.0.1")}
	}
	client := NewClient(ClientOptions{Validator: NewValidator(Policy{BlockLocal: false}, resolver), RejectUnauthorized: true})

	resp, err := client.Do(context.Background(), Request{Method: http.MethodGet, URL: "http://agent.example:" + serverPort(t, srv) + "/turn"})
	require.NoError(t, err)
	assert.Equal(t, "ok", string(resp.Body))
	assert.Equal(t, "agent.example", gotHost)
	assert.Equal(t, 1, lookups, "the name is resolved once, at judgement, never again at dial")
}

// @scenario "A redirect is refused as the Node child refuses it"
func TestClientRefusesARedirectAsTheNodeChildDoes(t *testing.T) {
	srv := httptest.NewServer(http.RedirectHandler("http://elsewhere.example/", http.StatusFound))
	defer srv.Close()
	client := NewClient(ClientOptions{Validator: NewValidator(Policy{}, fakeDNS(map[string]string{"agent.example": "127.0.0.1"}))})

	_, err := client.Do(context.Background(), Request{Method: http.MethodGet, URL: "http://agent.example:" + serverPort(t, srv) + "/"})
	var refused *RedirectRefusedError
	require.ErrorAs(t, err, &refused)
	assert.Equal(t, msgRedirectsUnjudged, refused.Message)
}

// @scenario "A followed redirect is judged again at every hop"
func TestClientRevalidatesEachRedirectHop(t *testing.T) {
	dns := fakeDNS(map[string]string{
		"agent.example": "127.0.0.1", "next.example": "127.0.0.1", "private.example": "10.0.0.5",
	})
	policy := Policy{BlockLocal: true, AllowedHosts: []string{"agent.example", "next.example"}}
	client := NewClient(ClientOptions{Validator: NewValidator(policy, dns), FollowRedirects: true})

	var gotAuth string
	final := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotAuth = r.Header.Get("Authorization")
		_, _ = w.Write([]byte("landed"))
	}))
	defer final.Close()

	cases := []struct {
		name     string
		location string
		wantErr  string
	}{
		{"to a private address", "http://private.example/", msgResolvesPrivate},
		{"to cloud metadata", "http://169.254.169.254/latest/meta-data", msgMetadataHost},
		{"to an allowed host", "http://next.example:" + serverPort(t, final) + "/", ""},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			first := httptest.NewServer(http.RedirectHandler(tc.location, http.StatusTemporaryRedirect))
			defer first.Close()
			resp, err := client.Do(context.Background(), Request{
				Method: http.MethodGet, URL: "http://agent.example:" + serverPort(t, first) + "/",
				Headers: map[string]string{"Authorization": "Bearer secret"},
			})
			if tc.wantErr != "" {
				require.ErrorContains(t, err, tc.wantErr)
				return
			}
			require.NoError(t, err)
			assert.Equal(t, "landed", string(resp.Body))
			assert.Empty(t, gotAuth, "a credential never follows a redirect to another origin")
		})
	}
}

func TestClientWordsARefusedConnectionAsPackagesEgressDoes(t *testing.T) {
	srv := httptest.NewServer(http.NotFoundHandler())
	port := serverPort(t, srv)
	srv.Close()
	client := NewClient(ClientOptions{Validator: NewValidator(Policy{}, fakeDNS(map[string]string{"agent.example": "127.0.0.1"}))})

	_, err := client.Do(context.Background(), Request{Method: http.MethodGet, URL: "http://agent.example:" + port + "/"})
	require.ErrorContains(t, err, "Connection refused - is the server running at agent.example:"+port+"?")
}
