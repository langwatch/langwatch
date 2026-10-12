package idpsim

import (
	"encoding/json"
	"net/http"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// publish sends the registry's two fields the way the tenant page's button does.
func publish(s *Server, name, value string) *http.Response {
	body, _ := json.Marshal(map[string]string{"name": name, "value": value})
	return apiRequest(s, http.MethodPost, "/api/t/1/dns", string(body)).Result()
}

// @scenario "A domain proof can be published from the simulator's own page"
func TestDNSRegistryPublishesBothChannels(t *testing.T) {
	s := newTestServer(t, 1)

	t.Run("given a value LangWatch minted for a domain with no real DNS", func(t *testing.T) {
		res := publish(s, "acme1.test", "lw-verify-abc123")
		require.Equal(t, http.StatusOK, res.StatusCode)

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
		rec := apiRequest(s, http.MethodDelete, "/api/t/1/dns/_langwatch-verification.acme1.test", "")
		require.Equal(t, http.StatusNoContent, rec.Code)

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

		// A refusal, not a quiet success that would look like it had
		// published something.
		t.Run("refuses it and says what is missing", func(t *testing.T) {
			assert.Equal(t, http.StatusBadRequest, res.StatusCode)
			var notice refusalNotice
			require.NoError(t, json.NewDecoder(res.Body).Decode(&notice))
			assert.Equal(t, "A record needs a name and a value", notice.Title)
		})

		t.Run("publishes nothing", func(t *testing.T) {
			_, ok := s.verification.TXT("_langwatch-verification.acme1.test")
			assert.False(t, ok)
		})
	})
}

// @scenario "A domain proof can be published from the simulator's own page"
func TestDNSRegistryTakesTheNameLangWatchShows(t *testing.T) {
	s := newTestServer(t, 1)

	// LangWatch's panel shows the NAME, and a person filling this in copies
	// that row. Refusing it would make the form reject its own instructions.
	t.Run("given the full record name is pasted", func(t *testing.T) {
		res := publish(s, "_langwatch-verification.acme1.test", "lw-verify-xyz")
		require.Equal(t, http.StatusOK, res.StatusCode)

		t.Run("does not label an already-labeled name twice", func(t *testing.T) {
			_, doubled := s.verification.TXT(
				"_langwatch-verification._langwatch-verification.acme1.test")
			assert.False(t, doubled, "the label was applied to a name that had it")
			values, ok := s.verification.TXT("_langwatch-verification.acme1.test")
			require.True(t, ok)
			assert.Equal(t, []string{"lw-verify-xyz"}, values)
		})

		t.Run("still serves the well-known token at the bare domain", func(t *testing.T) {
			token, ok := s.verification.Token("acme1.test")
			require.True(t, ok, "the label was not stripped for the token")
			assert.Equal(t, "lw-verify-xyz", token)
		})
	})

	// The one thing a reader can do by accident, having two similar strings
	// in front of them, is paste the same one into both boxes.
	t.Run("given the name is pasted into the value as well", func(t *testing.T) {
		res := publish(s, "acme2.test", "_langwatch-verification.acme2.test")

		t.Run("says which of the two it is rather than publishing it", func(t *testing.T) {
			assert.Equal(t, http.StatusBadRequest, res.StatusCode)
			_, ok := s.verification.TXT("_langwatch-verification.acme2.test")
			assert.False(t, ok, "a record that proves itself was published")
		})
	})
}

// @scenario "A domain proof can be published from the simulator's own page"
func TestDNSRegistryNormalizesTheDomain(t *testing.T) {
	s := newTestServer(t, 1)

	// A domain typed with different case or a trailing dot is the same domain,
	// and the lookup will ask for the normalized one.
	t.Run("given a domain typed with capitals and a trailing dot", func(t *testing.T) {
		require.Equal(t, http.StatusOK, publish(s, "ACME1.Test.", "v1").StatusCode)

		t.Run("publishes under the name the lookup will ask for", func(t *testing.T) {
			values, ok := s.verification.TXT("_langwatch-verification.acme1.test")
			require.True(t, ok)
			assert.Equal(t, []string{"v1"}, values)
		})
	})
}
