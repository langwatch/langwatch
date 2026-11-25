package egress

import (
	"context"
	"net/http"
	"net/http/httptest"
	"net/netip"
	"sync/atomic"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// The Go runner runs with the Node child's rights, so these attacks only ask
// that its fence refuse whatever packages/egress refuses.

// metadataAllowlisted names every metadata spelling as allowed: the fence must
// refuse metadata anyway.
var metadataAllowlisted = []string{
	"169.254.169.254", "metadata.google.internal", "metadata.goog", "metadata",
	"fd00:ec2::254", "[fd00:ec2::254]", "169.254.170.2", "2852039166", "0xa9fea9fe",
	"0251.0376.0251.0376", "::ffff:169.254.169.254", "[::ffff:169.254.169.254]",
	"169.254.169.254.", "METADATA.GOOGLE.INTERNAL.",
}

// @scenario "The fence refuses private, loopback, metadata and cloud-internal destinations"
func TestAdversarialPrivateSpellingsAreRefusedWhenLocalIsBlocked(t *testing.T) {
	strict := NewValidator(Policy{BlockLocal: true, AllowedHosts: metadataAllowlisted}, nil)
	urls := []string{
		// loopback, every spelling
		"http://127.0.0.1/", "http://127.0.0.2/", "http://localhost/", "http://LOCALHOST./",
		"http://[::1]/", "http://[0:0:0:0:0:0:0:1]/", "http://0.0.0.0/", "http://[::]/",
		"http://2130706433/", "http://0x7f000001/", "http://0x7F.0.0.1/", "http://0177.0.0.1/",
		"http://127.1/", "http://127.0.1/", "http://017700000001/", "http://0/",
		// RFC1918, CGNAT, link-local
		"http://10.0.0.1/", "http://172.16.0.1/", "http://192.168.1.1/", "http://100.64.0.1/",
		"http://169.254.1.1/", "http://[fe80::1]/", "http://167772161/",
		// IPv6 ULA
		"http://[fd00::1]/", "http://[fc00::1]/",
		// IPv4 inside IPv6
		"http://[::ffff:127.0.0.1]/", "http://[::ffff:7f00:1]/", "http://[::127.0.0.1]/",
		"http://[::ffff:0:7f00:1]/", "http://[::ffff:10.0.0.1]/",
		// zone identifiers
		"http://[fe80::1%25eth0]/", "http://[fd00::1%25lo0]/",
		// userinfo
		"http://public.example@127.0.0.1/", "http://user:pass@[::1]:8080/",
	}
	for _, raw := range urls {
		t.Run(raw, func(t *testing.T) {
			_, err := strict.Validate(context.Background(), raw)
			require.Error(t, err, "%s must be refused", raw)
		})
	}
}

// @scenario "The fence refuses private, loopback, metadata and cloud-internal destinations"
func TestAdversarialMetadataIsRefusedEvenWhenLocalIsAllowedAndAllowlisted(t *testing.T) {
	open := NewValidator(Policy{BlockLocal: false, AllowedHosts: metadataAllowlisted}, nil)
	urls := []string{
		"http://169.254.169.254/latest/meta-data/", "http://169.254.169.254./",
		"http://metadata.google.internal/computeMetadata/v1/", "http://METADATA.GOOGLE.INTERNAL./",
		"http://metadata.goog/", "http://metadata/", "http://169.254.170.2/v2/credentials",
		"http://[fd00:ec2::254]/", "http://[fd00:ec2::254%25eth0]/",
		"http://2852039166/", "http://0xa9fea9fe/", "http://0xA9.0xFE.0xA9.0xFE/",
		"http://0251.0376.0251.0376/", "http://169.254.43518/", "http://169.16689662/",
		"http://[::ffff:169.254.169.254]/", "http://[::ffff:a9fe:a9fe]/", "http://[::169.254.169.254]/",
		"http://[::ffff:0:a9fe:a9fe]/",
		"http://evil@169.254.169.254/", "https://169.254.169.254:443/",
	}
	for _, raw := range urls {
		t.Run(raw, func(t *testing.T) {
			_, err := open.Validate(context.Background(), raw)
			require.Error(t, err, "%s must be refused", raw)
		})
	}
}

// @scenario "The fence refuses private, loopback, metadata and cloud-internal destinations"
func TestAdversarialNamesResolvingToPrivateAreRefused(t *testing.T) {
	dns := func(_ context.Context, host string) []netip.Addr {
		switch host {
		case "mixed.example":
			return []netip.Addr{netip.MustParseAddr("93.184.216.34"), netip.MustParseAddr("10.0.0.1")}
		case "mapped.example":
			return []netip.Addr{netip.MustParseAddr("::ffff:127.0.0.1")}
		case "ula.example":
			return []netip.Addr{netip.MustParseAddr("fd12:3456::1")}
		case "imds6.example":
			return []netip.Addr{netip.MustParseAddr("fd00:ec2::254")}
		case "imds-mapped.example":
			return []netip.Addr{netip.MustParseAddr("::ffff:169.254.169.254")}
		}
		return nil
	}
	strict := NewValidator(Policy{BlockLocal: true}, dns)
	open := NewValidator(Policy{BlockLocal: false, AllowedHosts: []string{"imds6.example"}}, dns)
	for _, raw := range []string{"http://mixed.example/", "http://mapped.example/", "http://ula.example/"} {
		_, err := strict.Validate(context.Background(), raw)
		require.ErrorContains(t, err, msgResolvesPrivate, raw)
	}
	for _, raw := range []string{"http://imds6.example/", "http://imds-mapped.example/"} {
		_, err := open.Validate(context.Background(), raw)
		require.ErrorContains(t, err, msgResolvesMetadata, raw)
	}
}

// @scenario "The judged address is the one connected to and the name is never resolved again"
func TestAdversarialDNSRebindingNeverReachesThePrivateAddress(t *testing.T) {
	var hits atomic.Int32
	private := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		hits.Add(1)
		_, _ = w.Write([]byte("internal"))
	}))
	defer private.Close()
	var lookups atomic.Int32
	rebinding := func(context.Context, string) []netip.Addr {
		if lookups.Add(1) == 1 {
			return []netip.Addr{netip.MustParseAddr("93.184.216.34")}
		}
		return []netip.Addr{netip.MustParseAddr("127.0.0.1")}
	}
	client := NewClient(ClientOptions{Validator: NewValidator(Policy{BlockLocal: true}, rebinding)})
	ctx, cancel := context.WithTimeout(context.Background(), 300*time.Millisecond)
	defer cancel()

	resp, err := client.Do(ctx, Request{Method: http.MethodGet, URL: "http://rebind.example:" + serverPort(t, private) + "/"})

	if err == nil {
		assert.NotEqual(t, "internal", string(resp.Body))
	}
	assert.Zero(t, hits.Load(), "the private server is never reached")
	assert.LessOrEqual(t, lookups.Load(), int32(1), "the name is never resolved a second time")
}

// @scenario "A redirect is refused as the Node child refuses it"
func TestAdversarialRedirectToAPrivateAddressIsRefused(t *testing.T) {
	var hits atomic.Int32
	internal := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		hits.Add(1)
		_, _ = w.Write([]byte("internal"))
	}))
	defer internal.Close()
	dns := fakeDNS(map[string]string{"agent.example": "127.0.0.1"})
	client := NewClient(ClientOptions{Validator: NewValidator(Policy{BlockLocal: true, AllowedHosts: []string{"agent.example"}}, dns)})
	for _, status := range []int{http.StatusMovedPermanently, http.StatusFound, http.StatusSeeOther, http.StatusTemporaryRedirect, http.StatusPermanentRedirect} {
		for _, location := range []string{internal.URL + "/", "http://169.254.169.254/latest", "//127.0.0.1:" + serverPort(t, internal) + "/"} {
			first := httptest.NewServer(http.RedirectHandler(location, status))
			_, err := client.Do(context.Background(), Request{Method: http.MethodGet, URL: "http://agent.example:" + serverPort(t, first) + "/"})
			first.Close()
			var refused *RedirectRefusedError
			require.ErrorAs(t, err, &refused, "%d to %s", status, location)
		}
	}
	assert.Zero(t, hits.Load())
}

// @scenario "A host is read as the Node child's URL parser reads it"
func TestAdversarialHostSpellingsAreReadAsTheNodeChildReadsThem(t *testing.T) {
	strict := NewValidator(Policy{BlockLocal: true}, fakeDNS(nil))
	open := NewValidator(Policy{BlockLocal: false}, fakeDNS(nil))
	refusedStrict := []string{
		"http://0x7f.1/", "http://127.0.0.1.:80/", "http://0x/", "http://0xffffffff/",
		"http://0x7f.0x0.0x0.0x1/", "http://00000177.0.0.1/", "http://127.000.000.001/",
		"http://１２７.0.0.1/", "http://ⓛocalhost/", "http://127。0。0。1/", "http://[::ffff:127.1]/",
	}
	for _, raw := range refusedStrict {
		t.Run("strict "+raw, func(t *testing.T) {
			_, err := strict.Validate(context.Background(), raw)
			require.Error(t, err)
		})
	}
	refusedOpen := []string{
		"http://１６９.２５４.１６９.２５４/", "http://169。254。169。254/", "http://0xa9.254.0xa9fe/",
		"http://metadata.google.internal%2e/", "http://ｍｅｔａｄａｔａ.google.internal/",
		"http://1.2.3.4.5/", "http://256.0.0.1/", "http://4294967296/", "http://0x1.0x2.0x3.0x4.0x5/",
	}
	for _, raw := range refusedOpen {
		t.Run("open "+raw, func(t *testing.T) {
			_, err := open.Validate(context.Background(), raw)
			require.Error(t, err)
		})
	}
	canonical := map[string]string{
		"http://0x5d.0xb8.0xd8.0x22/": "93.184.216.34", "http://1572395042/": "93.184.216.34",
		"http://0135.0270.0330.042/": "93.184.216.34", "http://93.184.55330/": "93.184.216.34",
	}
	for raw, want := range canonical {
		t.Run("canonical "+raw, func(t *testing.T) {
			dest, err := strict.Validate(context.Background(), raw)
			require.NoError(t, err)
			assert.Equal(t, want, dest.Hostname)
			assert.Equal(t, netip.MustParseAddr(want), dest.Pinned)
		})
	}
}

// @scenario "A host is read as the Node child's URL parser reads it"
func TestAdversarialOrdinaryHostsStillPass(t *testing.T) {
	dns := fakeDNS(map[string]string{
		"agent_one.example": "93.184.216.34", "xn--bcher-kva.example": "93.184.216.34", "a-.example": "93.184.216.34",
	})
	strict := NewValidator(Policy{BlockLocal: true}, dns)
	for raw, host := range map[string]string{
		"https://agent_one.example/": "agent_one.example", "https://Bücher.example/": "xn--bcher-kva.example",
		"https://a-.example/": "a-.example",
	} {
		dest, err := strict.Validate(context.Background(), raw)
		require.NoError(t, err, raw)
		assert.Equal(t, host, dest.Hostname)
	}
}
