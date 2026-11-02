package redact_test

import (
	"os/exec"
	"strconv"
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

	assert.LessOrEqual(t, strings.Count(got, "[redacted]"), matches)
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

func TestRedactor_SelfOverlappingSecretOverLargeTextIsLinearEnough(t *testing.T) {
	text := strings.Repeat("a", 64<<10)
	for _, secret := range []string{"aa", "aaa", "0000"} {
		r := redact.New(map[string]string{"k": secret})
		in := strings.ReplaceAll(text, "a", secret[:1])
		start := time.Now()
		cutAt := r.SafeStart(in, 32<<10)
		got := r.Redact(in)
		assert.Less(t, time.Since(start), 2*time.Second, secret)
		assert.GreaterOrEqual(t, cutAt, 32<<10)
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
			secrets[strconv.Itoa(i)] = s
		}
		got := redactAll(c.text, secrets)
		assert.Equal(t, "[redacted]", got)
	}
}

func TestRedactor_TenMiBOfOneCharSecretMatchesRedactsToOneMarker(t *testing.T) {
	r := redact.New(map[string]string{"k": "a"})
	assert.Equal(t, "[redacted]", r.Redact(strings.Repeat("a", 10<<20)))
}

func TestRedactor_ManyFormsMatchingTheWholeTextRedactToOneMarker(t *testing.T) {
	secrets := map[string]string{}
	for i := 0; i < 50; i++ {
		secrets[strconv.Itoa(i)] = strings.Repeat("a", i+1)
	}
	r := redact.New(secrets)
	assert.Equal(t, "[redacted]", r.Redact(strings.Repeat("a", 1<<20)))
}

func TestRedactor_SafeStartMovesPastASecretThatContainsTheStartAndNothingElse(t *testing.T) {
	r := redact.New(map[string]string{"L": "LONGSECRET", "S": "x"})
	raw := "xx.LONGSECRET.xx"
	assert.Equal(t, 13, r.SafeStart(raw, 7))
	assert.Equal(t, 13, r.SafeStart(raw, 4))
	assert.Equal(t, 3, r.SafeStart(raw, 3))
	assert.Equal(t, 13, r.SafeStart(raw, 13))
	assert.Equal(t, 0, r.SafeStart(raw, 0))
	assert.Equal(t, len(raw), r.SafeStart(raw, 99))
}

func TestRedactor_SafeStartFollowsAChainOfOverlappingSecrets(t *testing.T) {
	r := redact.New(map[string]string{"a": "abcdef", "b": "cdefgh"})
	assert.Equal(t, 9, r.SafeStart(".abcdefgh.", 3))
	assert.Equal(t, 9, r.SafeStart(".abcdefgh.", 7))
}

func TestRedactor_SafeStartSkipsPastSecretsThatTouchAtTheStart(t *testing.T) {
	r := redact.New(map[string]string{"a": "AAAA", "b": "BBBB"})
	assert.Equal(t, 9, r.SafeStart(".AAAABBBB.", 5))
	assert.Equal(t, 5, r.SafeStart(".AAAA.BBBB", 5))
}

func TestRedactor_SafeStartMovesForwardToARuneStart(t *testing.T) {
	raw := strings.Repeat("é", 10)
	got := redact.New(map[string]string{"k": "nomatch"}).SafeStart(raw, 5)
	assert.Equal(t, 6, got)
	assert.True(t, utf8.ValidString(raw[got:]))
}

func TestRedactor_SafeStartWithoutSecretsStillAlignsAndKeepsStrayBytes(t *testing.T) {
	r := redact.New(nil)
	assert.Equal(t, 5, r.SafeStart("a\x80\x80\x80\x80b", 2))
	assert.Equal(t, 5, r.SafeStart("a\x80\x80\x80\x80b", 1), "a longer run takes more than one pass")
	assert.Equal(t, 5, r.SafeStart("a\x80\x80\x80\x80", 1), "a run to the end leaves nothing")
	assert.Equal(t, 1, r.SafeStart("a\xc3tail", 1), "a lone lead byte is a start")
}

func TestRedactor_SafeStartStaysOutOfASecretWhenRuneAlignmentWouldStepIntoIt(t *testing.T) {
	r := redact.New(map[string]string{"k": "\x80SECRET12"})
	raw := strings.Repeat(".", 11) + "\x80SECRET12" + "tail"
	assert.Equal(t, 20, r.SafeStart(raw, 11))
}

func TestRedactor_SafeStartWithAStartingContinuationByteInsideASecretLeavesNoPart(t *testing.T) {
	r := redact.New(map[string]string{"k": "SECRET\xc3"})
	raw := strings.Repeat(".", 12) + "SECRET\xc3\xa9tail"
	start := r.SafeStart(raw, 15)
	assert.NotContains(t, strings.ReplaceAll(strings.ToValidUTF8(r.Redact(raw[start:]), ""), "[redacted]", ""), "ECRET")
}

func TestRedactor_MaxFormLenCoversTheMarkerAndIsZeroWithoutSecrets(t *testing.T) {
	assert.Equal(t, 0, redact.New(nil).MaxFormLen())
	assert.Equal(t, len("[redacted]"), redact.New(map[string]string{"k": "a"}).MaxFormLen())
}

func TestRedactor_TrimPartialTailRemovesAnyProperPrefixOfASecretAtTheEnd(t *testing.T) {
	secret := "pa\"ss\nwo\u00e9rd-SECRET"
	r := redact.New(map[string]string{"K": secret})
	forms := []string{secret, `pa\"ss\nwoérd-SECRET`, `pa\"ss\nwo\u00e9rd-SECRET`}
	for _, form := range forms {
		for n := 1; n < len(form); n++ {
			got := r.Redact(r.TrimPartialTail("trace\n" + form[:n]))
			for i := 0; i+4 <= n; i++ {
				require.NotContains(t, got, form[i:i+4], "prefix length %d", n)
			}
		}
	}
}

func TestRedactor_TrimPartialTailKeepsWholeSecretsAndOrdinaryText(t *testing.T) {
	r := redact.New(map[string]string{"K": "SECRETVALUE"})
	assert.Equal(t, "ok SECRETVALUE", r.TrimPartialTail("ok SECRETVALUE"))
	assert.Equal(t, "plain text\n", r.TrimPartialTail("plain text\n"))
	assert.Equal(t, "ok ", r.TrimPartialTail("ok SECR"))
	assert.Equal(t, "", r.TrimPartialTail("SECR"))
}

func TestRedactor_TrimPartialTailFollowsAChainOfPrefixes(t *testing.T) {
	r := redact.New(map[string]string{"a": "XYZW123", "b": "ABCDXYZW"})
	assert.Equal(t, "", r.TrimPartialTail("ABCDXYZW"[:8]))
}

func TestRedactor_TrimPartialTailLeavesTextWithoutSecretsAlone(t *testing.T) {
	assert.Equal(t, "abc", redact.New(nil).TrimPartialTail("abc"))
}
