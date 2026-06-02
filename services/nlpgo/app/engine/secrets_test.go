package engine

import (
	"testing"

	"github.com/langwatch/langwatch/services/nlpgo/app/engine/blocks/httpblock"
	"github.com/stretchr/testify/assert"
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
