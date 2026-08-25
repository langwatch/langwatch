package idpsim

import (
	"net/http"
	"net/url"
	"strings"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// publish posts the registry form the way the tenant page's button does.
func publish(s *Server, domain, value string) *http.Response {
	form := url.Values{"domain": {domain}, "value": {value}}
	r, _ := http.NewRequest(http.MethodPost, testBase+"/t/1/dns",
		strings.NewReader(form.Encode()))
	r.Header.Set("content-type", "application/x-www-form-urlencoded")
	return do(s, r).Result()
}

// @scenario "A domain proof can be published from the simulator's own page"
func TestDNSRegistryPublishesBothChannels(t *testing.T) {
	s := newTestServer(t, 1)

	t.Run("given a value LangWatch minted for a domain with no real DNS", func(t *testing.T) {
		res := publish(s, "acme1.test", "lw-verify-abc123")
		require.Equal(t, http.StatusSeeOther, res.StatusCode,
			"the form redirects back to the tenant page")

		// The verifier asks for the label, not the bare domain, so publishing
		// at the domain alone would answer a question nobody asks.
		t.Run("answers the name the verifier actually asks for", func(t *testing.T) {
			values, ok := s.verification.TXT("_langwatch-verification.acme1.test")
			require.True(t, ok, "no TXT record was published")
			assert.Equal(t, []string{"lw-verify-abc123"}, values)
		})

		// Both channels, because the product offers both and somebody pasting
		// a value cannot know which one the check will use.
		t.Run("serves the same value as the well-known token", func(t *testing.T) {
			token, ok := s.verification.Token("acme1.test")
			require.True(t, ok, "no well-known token was published")
			assert.Equal(t, "lw-verify-abc123", token)
		})
	})

	// @scenario "A published record can be taken back out again"
	t.Run("given the record is taken back out", func(t *testing.T) {
		form := url.Values{"name": {"_langwatch-verification.acme1.test"}}
		r, _ := http.NewRequest(http.MethodPost, testBase+"/t/1/dns/delete",
			strings.NewReader(form.Encode()))
		r.Header.Set("content-type", "application/x-www-form-urlencoded")
		require.Equal(t, http.StatusSeeOther, do(s, r).Result().StatusCode)

		t.Run("stops answering the TXT lookup", func(t *testing.T) {
			_, ok := s.verification.TXT("_langwatch-verification.acme1.test")
			assert.False(t, ok, "the record outlived its removal")
		})

		// Leaving it behind would let a proof the page reports as gone keep
		// succeeding down the other channel.
		t.Run("stops serving the well-known token too", func(t *testing.T) {
			_, ok := s.verification.Token("acme1.test")
			assert.False(t, ok, "the well-known half outlived its removal")
		})
	})
}

// @scenario "A domain proof can be published from the simulator's own page"
func TestDNSRegistryRefusesAnIncompleteRecord(t *testing.T) {
	s := newTestServer(t, 1)

	t.Run("given a domain with no value", func(t *testing.T) {
		res := publish(s, "acme1.test", "")

		// Not a redirect: a form that silently bounced back would look like
		// it had published something.
		t.Run("refuses it and says what is missing", func(t *testing.T) {
			assert.Equal(t, http.StatusBadRequest, res.StatusCode)
		})

		t.Run("publishes nothing", func(t *testing.T) {
			_, ok := s.verification.TXT("_langwatch-verification.acme1.test")
			assert.False(t, ok)
		})
	})
}

// @scenario "A domain proof can be published from the simulator's own page"
func TestDNSRegistryNormalizesTheDomain(t *testing.T) {
	s := newTestServer(t, 1)

	// A domain typed with different case or a trailing dot is the same domain,
	// and the lookup will ask for the normalized one.
	t.Run("given a domain typed with capitals and a trailing dot", func(t *testing.T) {
		require.Equal(t, http.StatusSeeOther, publish(s, "ACME1.Test.", "v1").StatusCode)

		t.Run("publishes under the name the lookup will ask for", func(t *testing.T) {
			values, ok := s.verification.TXT("_langwatch-verification.acme1.test")
			require.True(t, ok)
			assert.Equal(t, []string{"v1"}, values)
		})
	})
}
