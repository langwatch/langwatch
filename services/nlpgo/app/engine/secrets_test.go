package engine

import (
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/langwatch/langwatch/services/nlpgo/app/engine/blocks/httpblock"
)

func TestResolveSecretRefs(t *testing.T) {
	secrets := map[string]string{"UPSTREAM_TOKEN": "rotated-value", "API_KEY": "k-123"}

	t.Run("when the reference exists it substitutes the value", func(t *testing.T) {
		assert.Equal(t, "rotated-value", resolveSecretRefs("{{ secrets.UPSTREAM_TOKEN }}", secrets))
	})

	t.Run("when whitespace varies it still matches", func(t *testing.T) {
		assert.Equal(t, "k-123", resolveSecretRefs("{{secrets.API_KEY}}", secrets))
	})

	t.Run("when embedded in a larger string it substitutes in place", func(t *testing.T) {
		assert.Equal(t, "Bearer rotated-value", resolveSecretRefs("Bearer {{ secrets.UPSTREAM_TOKEN }}", secrets))
	})

	t.Run("when the name is unknown it leaves the reference verbatim", func(t *testing.T) {
		assert.Equal(t, "{{ secrets.MISSING }}", resolveSecretRefs("{{ secrets.MISSING }}", secrets))
	})

	t.Run("when the secrets map is empty it is a no-op", func(t *testing.T) {
		assert.Equal(t, "{{ secrets.UPSTREAM_TOKEN }}", resolveSecretRefs("{{ secrets.UPSTREAM_TOKEN }}", nil))
	})

	t.Run("when there is no reference the string is unchanged", func(t *testing.T) {
		assert.Equal(t, "plain-token", resolveSecretRefs("plain-token", secrets))
	})
}

func TestResolveAuthSecrets(t *testing.T) {
	secrets := map[string]string{"TOK": "rotated-value", "USER": "alice", "PASS": "s3cr3t"}

	t.Run("when bearer token references a secret it resolves the token", func(t *testing.T) {
		got := resolveAuthSecrets(&httpblock.Auth{Type: "bearer", Token: "{{ secrets.TOK }}"}, secrets)
		assert.Equal(t, "rotated-value", got.Token)
	})

	t.Run("when basic auth references secrets it resolves username and password", func(t *testing.T) {
		got := resolveAuthSecrets(&httpblock.Auth{
			Type:     "basic",
			Username: "{{ secrets.USER }}",
			Password: "{{ secrets.PASS }}",
		}, secrets)
		assert.Equal(t, "alice", got.Username)
		assert.Equal(t, "s3cr3t", got.Password)
	})

	t.Run("when auth is nil it returns nil", func(t *testing.T) {
		assert.Nil(t, resolveAuthSecrets(nil, secrets))
	})
}

// A project with two secrets where one value contains the other is the shape
// that breaks a naive replace loop: Go randomizes map iteration, so roughly
// nine runs in ten the SHORTER value was substituted first, chopping the longer
// one into "[redacted]" + a surviving tail. The pass for the longer value then
// found no intact match left to replace.
//
// That failure is worse than no redaction at all — the "[redacted]" tag reads
// as proof the value was scrubbed while a fragment of the other secret sits in
// the clear right beside it. Versioned and paired keys (live/test, v1/v2) are
// exactly the shape that produces the substring relationship, so this is an
// ordinary configuration, not a contrived one.
//
// Iterated because the defect is nondeterministic: one pass would pass by luck
// about 12% of the time.
func TestRedactSecrets_DoesNotFragmentASecretThatContainsAnother(t *testing.T) {
	const shortVal = "sk-abc123"
	const longVal = "sk-abc123456"
	secrets := map[string]string{"API_KEY": shortVal, "API_KEY_V2": longVal}

	for i := 0; i < 200; i++ {
		got := redactSecrets("upstream rejected key "+longVal+" for project", secrets)

		require.NotContains(t, got, "456",
			"iteration %d: the tail of the longer secret survived — %q", i, got)
		require.NotContains(t, got, shortVal, "iteration %d: %q", i, got)
		require.NotContains(t, got, longVal, "iteration %d: %q", i, got)
		// Anti-vacuity: the surrounding message must still be there, so this
		// cannot pass by the whole string having been blanked.
		require.Contains(t, got, "upstream rejected key ")
		require.Contains(t, got, " for project")
	}
}
