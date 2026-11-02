package redact_test

import (
	"os/exec"
	"strings"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/langwatch/langwatch/services/nlpgo/app/engine/redact"
)

func redactAll(text string, secrets map[string]string, extra ...string) string {
	return redact.New(secrets, extra...).Redact(text)
}

func TestRedactor_ManyOneCharSecretsDoNotGrowTheTextBeyondOneMarkerPerMatch(t *testing.T) {
	secrets := map[string]string{"1": "a", "2": "e", "3": "d", "4": "r"}
	input := strings.Repeat("a line of ordinary stderr text\n", 600)
	matches := strings.Count(input, "a") + strings.Count(input, "e") + strings.Count(input, "d") + strings.Count(input, "r")

	got := redactAll(input, secrets)

	assert.Equal(t, matches, strings.Count(got, "[redacted]"))
	assert.LessOrEqual(t, len(got), len(input)+matches*len("[redacted]"))
	for _, c := range []string{"a", "e", "d", "r"} {
		assert.NotContains(t, strings.ReplaceAll(got, "[redacted]", ""), c)
	}
}

func TestRedactor_NestedSecretsLeaveNoTailInAnyMapOrder(t *testing.T) {
	secrets := map[string]string{"short": "abc", "long": "abcdef-TAILSECRET"}
	for i := 0; i < 200; i++ {
		got := redactAll("x abcdef-TAILSECRET y", secrets)
		require.NotContains(t, got, "TAILSECRET")
		require.NotContains(t, got, "def")
	}
}

func TestRedactor_ExtraValuesAreRedactedToo(t *testing.T) {
	assert.Equal(t, "k=[redacted]", redactAll("k=sandbox-key", nil, "sandbox-key"))
}

func TestRedactor_IsIdempotentWithOneCharSecrets(t *testing.T) {
	secrets := map[string]string{"a": "e", "b": "d", "c": "r"}
	text := redactAll("x e d r y", secrets)
	again := redactAll(text, secrets)
	assert.Equal(t, text, again)
	assert.Equal(t, "x [redacted] [redacted] [redacted] y", text)
}

func TestRedactor_MatchesPythonJSONDumpsForAwkwardCharacters(t *testing.T) {
	if _, err := exec.LookPath("python3"); err != nil {
		t.Skip("python3 not available")
	}
	secret := "a\nb\"c\\d&e<f>g\x7fh\x01i\U0001F600é"
	out, err := exec.Command("python3", "-I", "-c", "import json,sys; sys.stdout.write(json.dumps(sys.argv[1]))", secret).Output()
	require.NoError(t, err)

	got := redactAll("stderr: "+string(out)+" end", map[string]string{"K": secret})

	assert.Equal(t, "stderr: [redacted] end", strings.Replace(got, "\"[redacted]\"", "[redacted]", 1))
}
