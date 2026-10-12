package httpapi

// Review round 1 of the Twilio media relay: the drain started by a shutdown
// signal, bodies on relay opens, organization id hygiene, the per-scope cap on
// held relays, and a worker that speaks before Twilio joins.
//
// Binds specs/ai-gateway/voice-media-relay.feature.

import (
	"bytes"
	"context"
	"io"
	"net/http"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"github.com/coder/websocket"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/langwatch/langwatch/services/aigateway/adapters/mediarelay"
)

// ---------------------------------------------------------------------------
// A shutdown signal drains the hub (through the router)
// ---------------------------------------------------------------------------

// @scenario "A shutdown signal starts the drain"
func TestShutdownSignalRefusesNewRelaysWithRetryAfter(t *testing.T) {
	t.Parallel()
	g := newMRGateway(t)
	ctx, cancel := context.WithCancel(context.Background())
	require.NoError(t, g.hub.Start(ctx))
	cancel()

	var refused *http.Response
	require.Eventually(t, func() bool {
		conn, resp, err := g.dialRelay(licensedHeader())
		if err == nil {
			_ = conn.CloseNow()
			return false
		}
		refused = resp
		return resp != nil && resp.StatusCode == http.StatusServiceUnavailable
	}, time.Second, 10*time.Millisecond, "the gateway kept opening relays after its context ended")

	assert.NotEmpty(t, refused.Header.Get("Retry-After"))
}

// ---------------------------------------------------------------------------
// A relay open never carries a body
// ---------------------------------------------------------------------------

type mrCountingBody struct {
	io.ReadCloser
	read *atomic.Int64
}

func (b mrCountingBody) Read(p []byte) (int, error) {
	n, err := b.ReadCloser.Read(p)
	b.read.Add(int64(n))
	return n, err
}

func upgradeHeader(header http.Header) http.Header {
	merged := header.Clone()
	merged.Set("Connection", "Upgrade")
	merged.Set("Upgrade", "websocket")
	merged.Set("Sec-WebSocket-Version", "13")
	merged.Set("Sec-WebSocket-Key", "dGhlIHNhbXBsZSBub25jZQ==")
	return merged
}

// @scenario "A relay open that carries a body is refused before authentication"
func TestRelayOpenWithABodyIsRefusedBeforeAuthentication(t *testing.T) {
	t.Parallel()
	const bodySize = 1 << 20
	cases := []struct {
		name    string
		path    string
		header  http.Header
		chunked bool
	}{
		{"the licensed route", mrRelayPath, licensedHeader(), false},
		{"the signed route", mrRelayPath + "/" + mrOrg, signedOrgHeader(mrOrg), false},
		{"the signed route with a chunked body", mrRelayPath + "/" + mrOrg, signedOrgHeader(mrOrg), true},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()
			var read atomic.Int64
			g := newMRGateway(t, withWrap(func(next http.Handler) http.Handler {
				return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
					r.Body = mrCountingBody{ReadCloser: r.Body, read: &read}
					next.ServeHTTP(w, r)
				})
			}))
			payload := bytes.Repeat([]byte("x"), bodySize)
			var body io.Reader = bytes.NewReader(payload)
			if tc.chunked {
				body = io.NopCloser(body)
			}
			req, err := http.NewRequestWithContext(context.Background(), http.MethodGet, g.server.URL+tc.path, body)
			require.NoError(t, err)
			req.Header = upgradeHeader(tc.header)

			resp, err := http.DefaultClient.Do(req)
			require.NoError(t, err)
			_, _ = io.Copy(io.Discard, resp.Body)
			_ = resp.Body.Close()

			t.Run("the response is 400", func(t *testing.T) {
				assert.Equal(t, http.StatusBadRequest, resp.StatusCode)
			})
			t.Run("the error code is bad_request", func(t *testing.T) {
				assert.Equal(t, "bad_request", resp.Header.Get("X-LangWatch-Handled-Error"))
			})
			t.Run("no part of the body was read", func(t *testing.T) {
				assert.Zero(t, read.Load())
			})
			t.Run("no relay slot is taken", func(t *testing.T) {
				assert.Zero(t, g.hub.Active())
			})
		})
	}
}

// ---------------------------------------------------------------------------
// The organization id is validated
// ---------------------------------------------------------------------------

// @scenario "An organization id outside the allowed set is refused before upgrade"
func TestSignedRelayRefusesAnOrganisationIDOutsideTheAllowedSet(t *testing.T) {
	t.Parallel()
	cases := []struct{ name, raw, decoded string }{
		{"a percent-encoded letter", "%41", "A"},
		{"a percent-encoded underscore", "%5F", "_"},
		{"an encoded slash", "a%2Fb", "a/b"},
		{"an encoded space", "org%201", "org 1"},
		{"a dot", "org.1", "org.1"},
		{"65 characters", strings.Repeat("a", 65), strings.Repeat("a", 65)},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()
			g := newMRGateway(t)
			// The signature covers the decoded path, as the door verifies it.
			header := signedHeader(mrSecret, mrRelayPath+"/"+tc.decoded, 0)

			conn, resp, err := g.dial(mrRelayPath+"/"+tc.raw, &websocket.DialOptions{HTTPHeader: header})

			t.Run("no WebSocket is opened", func(t *testing.T) {
				assert.Nil(t, conn)
				require.Error(t, err)
			})
			t.Run("the response is 400 or 401", func(t *testing.T) {
				require.NotNil(t, resp)
				assert.Contains(t, []int{http.StatusBadRequest, http.StatusUnauthorized}, resp.StatusCode)
			})
			t.Run("no relay slot is taken", func(t *testing.T) {
				assert.Zero(t, g.hub.Active())
			})
		})
	}
}

// @scenario "An organization id of 64 allowed characters still opens a relay"
func TestSignedRelayOpensForAnOrganisationIDOfTheAllowedSet(t *testing.T) {
	t.Parallel()
	for name, org := range map[string]string{
		"64 characters":               strings.Repeat("a", 64),
		"letters, hyphen, underscore": "Org_1-x",
	} {
		t.Run(name, func(t *testing.T) {
			t.Parallel()
			g := newMRGateway(t)

			_, ready := g.openSigned(org)

			assert.NotEmpty(t, ready.RelayID)
		})
	}
}

// ---------------------------------------------------------------------------
// A scope's total relays are capped
// ---------------------------------------------------------------------------

func (g *mrGateway) pairSigned(org string) (relay, twilio *websocket.Conn) {
	g.t.Helper()
	relay, ready := g.openSigned(org)
	return relay, g.join(ready.RelayID)
}

func (g *mrGateway) refuseNextLicensedOpen() *http.Response {
	g.t.Helper()
	conn, resp, err := g.dialRelay(licensedHeader())
	refusedWith(g.t, resp, err, http.StatusServiceUnavailable, mrUnavailableCode)
	assert.Nil(g.t, conn)
	return resp
}

// @scenario "One scope cannot hold more relays in total than its cap"
func TestRelaysHeldPerScopeAreCapped(t *testing.T) {
	t.Parallel()
	capOfTwo := withHub(func(o *mediarelay.Options) {
		o.MaxRelaysPerScope = 2
		o.MaxPendingPerScope = 20
	})

	t.Run("per instance", func(t *testing.T) {
		t.Parallel()
		g := newMRGateway(t, capOfTwo)
		g.pair()
		g.pair()

		resp := g.refuseNextLicensedOpen()

		t.Run("the refusal carries Retry-After", func(t *testing.T) {
			assert.NotEmpty(t, resp.Header.Get("Retry-After"))
		})
		t.Run("another instance can still open one", func(t *testing.T) {
			_, other, err := g.dialRelay(licensedHeaderFor("instance-b"))

			require.NoError(t, err)
			assert.Equal(t, http.StatusSwitchingProtocols, other.StatusCode)
		})
		t.Run("an organization is a different scope", func(t *testing.T) {
			_, other, err := g.dialSigned(mrOrg, signedOrgHeader(mrOrg))

			require.NoError(t, err)
			assert.Equal(t, http.StatusSwitchingProtocols, other.StatusCode)
		})
	})
	t.Run("per organization", func(t *testing.T) {
		t.Parallel()
		g := newMRGateway(t, capOfTwo)
		g.pairSigned(mrOrg)
		g.pairSigned(mrOrg)

		_, resp, err := g.dialSigned(mrOrg, signedOrgHeader(mrOrg))

		t.Run("the third is refused", func(t *testing.T) {
			refusedWith(t, resp, err, http.StatusServiceUnavailable, mrUnavailableCode)
		})
		t.Run("another organization can still open one", func(t *testing.T) {
			_, other, err := g.dialSigned("org-2", signedOrgHeader("org-2"))

			require.NoError(t, err)
			assert.Equal(t, http.StatusSwitchingProtocols, other.StatusCode)
		})
	})
}

// @scenario "A scope's slot is reusable once one of its relays ends"
func TestScopeSlotIsReusableOnceItsRelayEnds(t *testing.T) {
	t.Parallel()
	g := newMRGateway(t, withHub(func(o *mediarelay.Options) {
		o.MaxRelaysPerScope = 1
		o.MaxPendingPerScope = 20
	}))
	relay, _, _ := g.pair()
	g.refuseNextLicensedOpen()

	require.NoError(t, relay.Close(websocket.StatusNormalClosure, ""))
	g.waitForNoRelays()
	reopened, resp, err := g.dialRelay(licensedHeader())

	require.NoError(t, err, "%v", resp)
	assert.NotNil(t, reopened)
}

// @scenario "The total cap per scope defaults to 50"
func TestRelaysHeldPerScopeDefaultToFifty(t *testing.T) {
	t.Parallel()
	g := newMRGateway(t)
	for range 50 {
		g.pair()
	}

	g.refuseNextLicensedOpen()

	assert.Equal(t, 50, g.hub.Active())
}

// ---------------------------------------------------------------------------
// A worker that speaks before Twilio joins
// ---------------------------------------------------------------------------

// outcomesBesides sums every counted outcome except one, whatever the label.
func (g *mrGateway) outcomesBesides(excluded string) float64 {
	g.t.Helper()
	families, err := g.metrics.Registry().Gather()
	require.NoError(g.t, err)
	var total float64
	for _, family := range families {
		if family.GetName() != "gateway_voice_media_relay_total" {
			continue
		}
		for _, metric := range family.GetMetric() {
			for _, label := range metric.GetLabel() {
				if label.GetName() == "outcome" && label.GetValue() != excluded {
					total += metric.GetCounter().GetValue()
				}
			}
		}
	}
	return total
}

// @scenario "A worker that speaks before Twilio joins is closed with 1008"
func TestWorkerSpeakingBeforeTwilioJoinsIsClosedWith1008(t *testing.T) {
	t.Parallel()
	g := newMRGateway(t)
	relay, ready := g.open()
	fromRelay := inbox(relay)

	send(t, relay, websocket.MessageText, []byte("too-early"))
	code, reason := fromRelay.ended(t, 2*time.Second)

	t.Run("the worker is closed with 1008", func(t *testing.T) {
		assert.Equal(t, websocket.StatusPolicyViolation, code)
	})
	t.Run("the reason is relay_not_paired", func(t *testing.T) {
		assert.Equal(t, "relay_not_paired", reason)
	})
	t.Run("its slot is free", func(t *testing.T) {
		g.waitForNoRelays()
	})
	t.Run("one outcome is counted besides opened", func(t *testing.T) {
		require.Eventually(t, func() bool { return g.outcomesBesides("opened") == 1 }, 2*time.Second, 10*time.Millisecond)
	})
	t.Run("a later Twilio connect with that id gets 403", func(t *testing.T) {
		_, resp, err := g.dialTwilio(ready.RelayID)

		refusedWith(t, resp, err, http.StatusForbidden, mrForbiddenCode)
	})
}

// A worker frame sent the instant Twilio's dial returns races the pairing and
// must be delivered, not refused as unpaired.
func TestWorkerFrameRightAfterTwilioJoinIsDelivered(t *testing.T) {
	t.Parallel()
	for range 20 {
		g := newMRGateway(t)
		relay, ready := g.open()
		twilio := g.join(ready.RelayID)
		fromTwilio := inbox(twilio)

		send(t, relay, websocket.MessageText, []byte("early-bird"))

		got := fromTwilio.next(t, 2*time.Second)
		assert.Equal(t, "early-bird", string(got.data))
	}
}
