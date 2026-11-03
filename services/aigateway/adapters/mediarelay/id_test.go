package mediarelay

// The sealed relay id: what a worker hands to Twilio and Twilio hands back.
// The id is the only credential on the Twilio leg, so it must be unforgeable,
// unreadable, short enough for a <Stream url>, and expire on its own.
//
// Binds specs/ai-gateway/voice-media-relay.feature.

import (
	"encoding/base64"
	"regexp"
	"strings"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

const idTestSecret = "relay-id-test-secret"

var (
	idEpoch  = time.Unix(1_800_000_000, 0)
	idClaims = IDClaims{
		OwnerPodIP:  "10.255.255.255",
		OwnerBootID: "a1b2c3d4",
		ExpiresAt:   idEpoch.Add(150 * time.Second),
	}
	base64URL = regexp.MustCompile(`^[A-Za-z0-9_-]+$`)
)

func sealOrFail(t *testing.T, codec *IDCodec, claims IDClaims) string {
	t.Helper()
	id, err := codec.Seal(claims)
	require.NoError(t, err)
	return id
}

// @scenario "A sealed relay id carries its owner and expiry"
func TestSealedIDCarriesItsOwnerAndExpiry(t *testing.T) {
	t.Parallel()
	codec := NewIDCodec(idTestSecret)
	id := sealOrFail(t, codec, idClaims)

	got, err := codec.Unseal(id, idEpoch)
	require.NoError(t, err)

	t.Run("the owner address", func(t *testing.T) {
		assert.Equal(t, idClaims.OwnerPodIP, got.OwnerPodIP)
	})
	t.Run("the owner boot id", func(t *testing.T) {
		assert.Equal(t, idClaims.OwnerBootID, got.OwnerBootID)
	})
	t.Run("the expiry, to the second", func(t *testing.T) {
		assert.Equal(t, idClaims.ExpiresAt.Unix(), got.ExpiresAt.Unix())
	})
	t.Run("the format version", func(t *testing.T) {
		assert.Equal(t, IDVersion, got.Version)
	})
	t.Run("128 random bits", func(t *testing.T) {
		assert.NotEqual(t, [16]byte{}, got.Random)
	})
}

// @scenario "A sealed relay id carries its owner and expiry"
func TestSealedIDMayHaveNoOwnerAddress(t *testing.T) {
	t.Parallel()
	codec := NewIDCodec(idTestSecret)
	id := sealOrFail(t, codec, IDClaims{ExpiresAt: idClaims.ExpiresAt})

	got, err := codec.Unseal(id, idEpoch)

	require.NoError(t, err)
	assert.Empty(t, got.OwnerPodIP, "single-pod mode seals an empty owner")
}

// @scenario "A relay id fits in a Twilio stream URL"
func TestSealedIDFitsInAStreamURL(t *testing.T) {
	t.Parallel()
	id := sealOrFail(t, NewIDCodec(idTestSecret), idClaims)

	t.Run("at most 120 characters", func(t *testing.T) {
		assert.LessOrEqual(t, len(id), 120)
	})
	t.Run("base64url, so no slash and no padding", func(t *testing.T) {
		assert.Regexp(t, base64URL, id)
	})
}

// @scenario "Two relay ids for the same claims differ"
func TestSealingTheSameClaimsTwiceGivesDifferentIDs(t *testing.T) {
	t.Parallel()
	codec := NewIDCodec(idTestSecret)

	first := sealOrFail(t, codec, idClaims)
	second := sealOrFail(t, codec, idClaims)

	assert.NotEqual(t, first, second)
}

// @scenario "A relay id does not reveal its owner address"
func TestSealedIDDoesNotRevealItsOwnerAddress(t *testing.T) {
	t.Parallel()
	id := sealOrFail(t, NewIDCodec(idTestSecret), idClaims)

	raw, err := base64.RawURLEncoding.DecodeString(id)
	require.NoError(t, err)

	assert.NotContains(t, string(raw), idClaims.OwnerPodIP)
	assert.NotContains(t, string(raw), idClaims.OwnerBootID)
}

// @scenario "A relay id sealed with another secret is rejected"
func TestIDSealedWithAnotherSecretIsInvalid(t *testing.T) {
	t.Parallel()
	id := sealOrFail(t, NewIDCodec("another-secret"), idClaims)

	_, err := NewIDCodec(idTestSecret).Unseal(id, idEpoch)

	assert.ErrorIs(t, err, ErrIDInvalid)
}

// @scenario "A tampered relay id is rejected"
func TestTamperedIDIsInvalid(t *testing.T) {
	t.Parallel()
	codec := NewIDCodec(idTestSecret)
	id := sealOrFail(t, codec, idClaims)

	for name, position := range map[string]int{"the first character": 0, "a middle character": len(id) / 2} {
		t.Run(name, func(t *testing.T) {
			t.Parallel()
			swapped := "A"
			if id[position] == 'A' {
				swapped = "B"
			}
			tampered := id[:position] + swapped + id[position+1:]

			_, err := codec.Unseal(tampered, idEpoch)

			assert.ErrorIs(t, err, ErrIDInvalid)
		})
	}
}

// @scenario "A malformed relay id is rejected"
func TestMalformedIDIsInvalid(t *testing.T) {
	t.Parallel()
	codec := NewIDCodec(idTestSecret)
	valid := sealOrFail(t, codec, idClaims)

	for name, id := range map[string]string{
		"empty":            "",
		"one character":    "x",
		"a plain word":     "not-a-relay-id",
		"far too long":     strings.Repeat("A", 4096),
		"holding a slash":  "abc/def",
		"padded":           valid + "==",
		"not base64url":    "!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!",
		"non-ASCII":        "ключ-ключ-ключ-ключ-ключ-ключ-ключ-ключ",
		"cut short":        valid[:len(valid)-8],
		"extended":         valid + "AAAAAAAA",
		"a query fragment": valid + "?x=1",
	} {
		t.Run(name, func(t *testing.T) {
			t.Parallel()
			_, err := codec.Unseal(id, idEpoch)

			assert.ErrorIs(t, err, ErrIDInvalid)
		})
	}
}

// @scenario "An expired relay id is reported as expired"
func TestIDIsExpiredAtItsExpiry(t *testing.T) {
	t.Parallel()
	codec := NewIDCodec(idTestSecret)
	id := sealOrFail(t, codec, idClaims)

	t.Run("one second before the expiry it is accepted", func(t *testing.T) {
		_, err := codec.Unseal(id, idClaims.ExpiresAt.Add(-time.Second))

		assert.NoError(t, err)
	})
	t.Run("at the expiry it is expired", func(t *testing.T) {
		_, err := codec.Unseal(id, idClaims.ExpiresAt)

		assert.ErrorIs(t, err, ErrIDExpired)
	})
	t.Run("long after the expiry it is expired", func(t *testing.T) {
		_, err := codec.Unseal(id, idClaims.ExpiresAt.Add(time.Hour))

		assert.ErrorIs(t, err, ErrIDExpired)
	})
}

// @scenario "A codec without a secret refuses to seal"
func TestCodecWithoutASecretFails(t *testing.T) {
	t.Parallel()
	good := sealOrFail(t, NewIDCodec(idTestSecret), idClaims)
	empty := NewIDCodec("")

	t.Run("sealing", func(t *testing.T) {
		_, err := empty.Seal(idClaims)

		assert.Error(t, err)
	})
	t.Run("unsealing", func(t *testing.T) {
		_, err := empty.Unseal(good, idEpoch)

		assert.Error(t, err)
	})
}

// Go's base64 decoder skips \r and \n, so a genuine id with a line break in it
// decodes to the same bytes and would open. The id is a credential and a log
// and path component: any byte outside the alphabet is refused first.
//
// @scenario "A relay id with a byte outside the base64url alphabet is rejected"
func TestIDWithAByteOutsideTheAlphabetIsInvalid(t *testing.T) {
	t.Parallel()
	codec := NewIDCodec(idTestSecret)
	valid := sealOrFail(t, codec, idClaims)
	middle := len(valid) / 2

	for name, id := range map[string]string{
		"a newline in the middle":      valid[:middle] + "\n" + valid[middle:],
		"a carriage return in front":   "\r" + valid,
		"a carriage return and a feed": valid[:middle] + "\r\n" + valid[middle:],
		"a newline at the end":         valid + "\n",
		"a space in the middle":        valid[:middle] + " " + valid[middle:],
		"a tab at the end":             valid + "\t",
		"a NUL in the middle":          valid[:middle] + "\x00" + valid[middle:],
	} {
		t.Run(name, func(t *testing.T) {
			t.Parallel()
			_, err := codec.Unseal(id, idEpoch)

			assert.ErrorIs(t, err, ErrIDInvalid)
		})
	}
}
