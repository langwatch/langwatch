package redact_test

import (
	"os/exec"
	"strings"
	"testing"
	"time"
	"unicode/utf8"

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

// @scenario "A secret is scrubbed from stderr in its JSON-escaped forms"
func TestRedactor_MatchesPythonJSONDumpsForAwkwardCharacters(t *testing.T) {
	if _, err := exec.LookPath("python3"); err != nil {
		t.Skip("python3 not available")
	}
	secret := "a\nb\"c\\d&e<f>g\x7fh\x01i\U0001F600é\b\f"
	out, err := exec.Command("python3", "-I", "-c", "import json,sys; sys.stdout.write(json.dumps(sys.argv[1]))", secret).Output()
	require.NoError(t, err)

	got := redactAll("stderr: "+string(out)+" end", map[string]string{"K": secret})

	assert.Equal(t, "stderr: [redacted] end", strings.Replace(got, "\"[redacted]\"", "[redacted]", 1))
}

func TestRedactor_SafeCutMovesOffASecretThatCrossesTheLimitAndNothingElse(t *testing.T) {
	r := redact.New(map[string]string{"L": "LONGSECRET", "S": "x"})
	raw := "xx.LONGSECRET.xx"
	assert.Equal(t, 3, r.SafeCut(raw, 7))
	assert.Equal(t, 3, r.SafeCut(raw, 4))
	assert.Equal(t, 13, r.SafeCut(raw, 13))
	assert.Equal(t, 2, r.SafeCut(raw, 2))
	assert.Equal(t, len(raw), r.SafeCut(raw, 99))
}

func TestRedactor_SafeCutFollowsAChainOfOverlappingSecrets(t *testing.T) {
	r := redact.New(map[string]string{"a": "abcdef", "b": "cdefgh"})
	assert.Equal(t, 1, r.SafeCut(".abcdefgh.", 7))
}

func TestRedactor_SafeCutStepsBackToARuneBoundary(t *testing.T) {
	raw := strings.Repeat("é", 10)
	got := redact.New(map[string]string{"k": "nomatch"}).SafeCut(raw, 5)
	assert.Equal(t, 4, got)
	assert.True(t, utf8.ValidString(raw[:got]))
}

func TestRedactor_SelfOverlappingSecretOverLargeTextIsLinearEnough(t *testing.T) {
	text := strings.Repeat("a", 64<<10)
	for _, secret := range []string{"aa", "aaa", "0000"} {
		r := redact.New(map[string]string{"k": secret})
		in := strings.ReplaceAll(text, "a", secret[:1])
		start := time.Now()
		cut := r.SafeCut(in, 32<<10)
		got := r.Redact(in)
		assert.Less(t, time.Since(start), 2*time.Second, secret)
		assert.LessOrEqual(t, cut, 32<<10)
		assert.NotContains(t, strings.ReplaceAll(got, "[redacted]", ""), secret[:1], secret)
	}
}

func TestRedactor_OverlappingSecretsLeaveNoFragmentOfEither(t *testing.T) {
	cases := []struct {
		secrets []string
		text    string
	}{
		{[]string{"ZA", "ABCDEF"}, "ZABCDEF"},
		{[]string{"abcdef", "cdefgh"}, "abcdefgh"},
	}
	for _, c := range cases {
		secrets := map[string]string{}
		for i, s := range c.secrets {
			secrets[string(rune('A'+i))] = s
		}
		got := redactAll(c.text, secrets)
		assert.Equal(t, "[redacted]", got)
	}
}
