package authcache

import (
	"testing"
	"time"

	"github.com/golang-jwt/jwt/v5"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func signToken(t *testing.T, claims jwt.MapClaims, secret string) string {
	t.Helper()
	token := jwt.NewWithClaims(jwt.SigningMethodHS256, claims)
	signed, err := token.SignedString([]byte(secret))
	require.NoError(t, err)
	return signed
}

func validClaims() jwt.MapClaims {
	return jwt.MapClaims{
		"vk_id":      "vk_123",
		"project_id": "proj_1",
		"team_id":    "team_1",
		"exp":        float64(time.Now().Add(time.Hour).Unix()),
	}
}

func TestVerify_ValidToken(t *testing.T) {
	secret := "current-secret"
	v := NewJWTVerifier(secret, "")

	tokenStr := signToken(t, validClaims(), secret)

	claims, err := v.Verify(tokenStr)
	require.NoError(t, err)
	assert.Equal(t, "vk_123", claims.VirtualKeyID)
	assert.Equal(t, "proj_1", claims.ProjectID)
	assert.Equal(t, "team_1", claims.TeamID)
	assert.Greater(t, claims.ExpiresAt, int64(0))
}

func TestVerify_PreviousSecret(t *testing.T) {
	current := "new-secret"
	previous := "old-secret"
	v := NewJWTVerifier(current, previous)

	// Sign with the previous (rotated-out) secret
	tokenStr := signToken(t, validClaims(), previous)

	claims, err := v.Verify(tokenStr)
	require.NoError(t, err)
	assert.Equal(t, "vk_123", claims.VirtualKeyID)
}

func TestVerify_InvalidSignature(t *testing.T) {
	v := NewJWTVerifier("real-secret", "")

	// Sign with an unknown secret
	tokenStr := signToken(t, validClaims(), "unknown-secret")

	_, err := v.Verify(tokenStr)
	require.Error(t, err)
	assert.Contains(t, err.Error(), "jwt verify")
}

func TestVerify_ExpiredToken(t *testing.T) {
	secret := "test-secret"
	v := NewJWTVerifier(secret, "")

	expiredClaims := jwt.MapClaims{
		"vk_id":      "vk_123",
		"project_id": "proj_1",
		"team_id":    "team_1",
		"exp":        float64(time.Now().Add(-time.Hour).Unix()),
	}
	tokenStr := signToken(t, expiredClaims, secret)

	// golang-jwt/v5 validates exp by default; expired token should fail
	_, err := v.Verify(tokenStr)
	require.Error(t, err)
	assert.Contains(t, err.Error(), "jwt verify")
}

func TestVerify_WrongAlgorithm(t *testing.T) {
	v := NewJWTVerifier("test-secret", "")

	// Create an RS256 token header but try to trick HMAC verification.
	// The keyFunc rejects non-HMAC methods, so this should fail.
	token := jwt.NewWithClaims(jwt.SigningMethodHS256, validClaims())
	// Override the header to claim RS256
	token.Header["alg"] = "RS256"
	// We can't properly sign with RS256 without an RSA key, but we can
	// test that the verifier rejects the algorithm mismatch.
	// Manually sign with HMAC but lie about the algorithm in the header.
	signed, err := token.SignedString([]byte("test-secret"))
	require.NoError(t, err)

	_, err = v.Verify(signed)
	require.Error(t, err)
	assert.Contains(t, err.Error(), "signing method")
}
