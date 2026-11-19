package domain

import (
	"crypto/ed25519"
	"encoding/base64"
	"errors"
	"net/netip"
	"strings"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func testSigningKey(t *testing.T) (ed25519.PublicKey, ed25519.PrivateKey) {
	t.Helper()
	pub, priv, err := ed25519.GenerateKey(nil)
	require.NoError(t, err)
	return pub, priv
}

func acmeEnvelope(expiresAt time.Time) PrivateEndpointsEnvelope {
	return PrivateEndpointsEnvelope{
		OrganizationID: "org_acme",
		ProjectID:      "acme-prod",
		Bindings: []PrivateEndpoint{{
			Hostname:  "llm.internal.acme.test",
			Addresses: []netip.Addr{netip.MustParseAddr("10.20.1.21"), netip.MustParseAddr("10.20.2.34")},
			Port:      443,
		}},
		ExpiresAt: expiresAt,
	}
}

func TestVerifyPrivateEndpointsHeader(t *testing.T) {
	now := time.Unix(1_800_000_000, 0)
	pub, priv := testSigningKey(t)

	t.Run("a valid envelope verifies", func(t *testing.T) {
		want := acmeEnvelope(now.Add(15 * time.Minute))
		got, err := VerifyPrivateEndpointsHeader(SignPrivateEndpointsHeader(want, priv), pub, now)
		require.NoError(t, err)
		assert.Equal(t, want, got)
	})

	t.Run("a forged signature is refused", func(t *testing.T) {
		_, other := testSigningKey(t)
		_, err := VerifyPrivateEndpointsHeader(SignPrivateEndpointsHeader(acmeEnvelope(now.Add(time.Minute)), other), pub, now)
		assert.ErrorIs(t, err, ErrPrivateEndpointsSignature)
	})

	t.Run("an envelope changed after signing is refused", func(t *testing.T) {
		value := SignPrivateEndpointsHeader(acmeEnvelope(now.Add(time.Minute)), priv)
		payload, sig, _ := strings.Cut(value, ".")
		raw, err := base64.RawURLEncoding.DecodeString(payload)
		require.NoError(t, err)
		tampered := base64.RawURLEncoding.EncodeToString([]byte(strings.Replace(string(raw), "10.20.1.21", "10.20.9.99", 1)))
		_, err = VerifyPrivateEndpointsHeader(tampered+"."+sig, pub, now)
		assert.ErrorIs(t, err, ErrPrivateEndpointsSignature)
	})

	t.Run("an expired envelope is refused", func(t *testing.T) {
		_, err := VerifyPrivateEndpointsHeader(SignPrivateEndpointsHeader(acmeEnvelope(now), priv), pub, now)
		assert.ErrorIs(t, err, ErrPrivateEndpointsExpired)
	})

	for name, value := range map[string]string{
		"an unsigned binding list": base64.RawURLEncoding.EncodeToString([]byte(acmeBindings)),
		"an empty signature":       "e30.",
		"a padded signature":       "e30.AAAA=",
	} {
		t.Run("refuses "+name, func(t *testing.T) {
			_, err := VerifyPrivateEndpointsHeader(value, pub, now)
			require.Error(t, err)
			assert.True(t, errors.Is(err, ErrPrivateEndpointsMalformed) || errors.Is(err, ErrPrivateEndpointsSignature))
		})
	}

	t.Run("an error never names an address", func(t *testing.T) {
		_, other := testSigningKey(t)
		for _, value := range []string{
			SignPrivateEndpointsHeader(acmeEnvelope(now.Add(time.Minute)), other),
			SignPrivateEndpointsHeader(acmeEnvelope(now), priv),
		} {
			_, err := VerifyPrivateEndpointsHeader(value, pub, now)
			require.Error(t, err)
			assert.NotContains(t, err.Error(), "10.20.")
		}
	})
}

func TestParsePrivateEndpointsVerifyKey(t *testing.T) {
	pub, _ := testSigningKey(t)

	for name, raw := range map[string]string{
		"standard base64": base64.StdEncoding.EncodeToString(pub),
		"base64url":       base64.RawURLEncoding.EncodeToString(pub),
	} {
		t.Run("reads "+name, func(t *testing.T) {
			key, err := ParsePrivateEndpointsVerifyKey(" " + raw + " ")
			require.NoError(t, err)
			assert.Equal(t, pub, key)
		})
	}

	t.Run("blank means no key", func(t *testing.T) {
		key, err := ParsePrivateEndpointsVerifyKey("  ")
		require.NoError(t, err)
		assert.Nil(t, key)
	})

	t.Run("refuses a value that is not a 32-byte key", func(t *testing.T) {
		_, err := ParsePrivateEndpointsVerifyKey(base64.StdEncoding.EncodeToString([]byte("short")))
		assert.Error(t, err)
	})
}

// The vector the TS signer is held to as well
// (modules/model-provider/contract/src/__tests__/private-model-endpoint.wire.unit.test.ts):
// seed 0x01..0x20, acme-prod, expiring at 1800000900. The key is derived from that
// seed at run time, so the source carries no key material.
const (
	sharedVectorHeader = "eyJ2IjoxLCJvcmdhbml6YXRpb25JZCI6Im9yZ19hY21lIiwicHJvamVjdElkIjoiYWNtZS1wcm9kIiwiYmluZGluZ3MiOlt7Imhvc3RuYW1lIjoibGxtLmludGVybmFsLmFjbWUudGVzdCIsImFkZHJlc3NlcyI6WyIxMC4yMC4xLjIxIiwiMTAuMjAuMi4zNCJdLCJwb3J0Ijo0NDN9XSwiZXhwaXJlc0F0IjoxODAwMDAwOTAwfQ.oyQyB4gk0jXh3oyefY_wDJ4rK1h1zu6ZKDwOTXbtNi3KFSIRCAJpo5WqzvoY79_eppAlLxm4e1dD7iaGwKB4CQ"
)

func TestVerifyPrivateEndpointsHeader_SharedVector(t *testing.T) {
	seed := make([]byte, ed25519.SeedSize)
	for i := range seed {
		seed[i] = byte(i + 1)
	}
	pub, ok := ed25519.NewKeyFromSeed(seed).Public().(ed25519.PublicKey)
	require.True(t, ok)
	key, err := ParsePrivateEndpointsVerifyKey(base64.StdEncoding.EncodeToString(pub))
	require.NoError(t, err)
	env, err := VerifyPrivateEndpointsHeader(sharedVectorHeader, key, time.Unix(1_800_000_000, 0))
	require.NoError(t, err)
	assert.Equal(t, acmeEnvelope(time.Unix(1_800_000_900, 0)), env)
}
