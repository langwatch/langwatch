package jwtverify

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
		"sub": "user_123",
		"exp": float64(time.Now().Add(time.Hour).Unix()),
	}
}

func TestVerify_ValidToken(t *testing.T) {
	secret := "current-secret"
	v := NewJWTVerifier(secret, "")

	tokenStr := signToken(t, validClaims(), secret)

	claims, err := v.Verify(tokenStr)
	require.NoError(t, err)
	assert.Equal(t, "user_123", claims["sub"])
}

func TestVerify_PreviousSecret(t *testing.T) {
	current := "new-secret"
	previous := "old-secret"
	v := NewJWTVerifier(current, previous)

	tokenStr := signToken(t, validClaims(), previous)

	claims, err := v.Verify(tokenStr)
	require.NoError(t, err)
	assert.Equal(t, "user_123", claims["sub"])
}

func TestVerify_InvalidSignature(t *testing.T) {
	v := NewJWTVerifier("real-secret", "")

	tokenStr := signToken(t, validClaims(), "unknown-secret")

	_, err := v.Verify(tokenStr)
	require.Error(t, err)
	assert.Contains(t, err.Error(), "jwt verify")
}

func TestVerify_ExpiredToken(t *testing.T) {
	secret := "test-secret"
	v := NewJWTVerifier(secret, "")

	expiredClaims := jwt.MapClaims{
		"sub": "user_123",
		"exp": float64(time.Now().Add(-time.Hour).Unix()),
	}
	tokenStr := signToken(t, expiredClaims, secret)

	_, err := v.Verify(tokenStr)
	require.Error(t, err)
	assert.Contains(t, err.Error(), "jwt verify")
}

func TestVerify_WrongAlgorithm(t *testing.T) {
	v := NewJWTVerifier("test-secret", "")

	token := jwt.NewWithClaims(jwt.SigningMethodHS256, validClaims())
	token.Header["alg"] = "RS256"
	signed, err := token.SignedString([]byte("test-secret"))
	require.NoError(t, err)

	_, err = v.Verify(signed)
	require.Error(t, err)
	assert.Contains(t, err.Error(), "signing method")
}

func TestVerify_WithIssuerAndAudience(t *testing.T) {
	secret := "test-secret"
	v := NewJWTVerifier(secret, "",
		WithIssuer("my-issuer"),
		WithAudience("my-audience"),
	)

	t.Run("when claims match", func(t *testing.T) {
		claims := jwt.MapClaims{
			"sub": "user_123",
			"iss": "my-issuer",
			"aud": "my-audience",
			"exp": float64(time.Now().Add(time.Hour).Unix()),
		}
		tokenStr := signToken(t, claims, secret)

		result, err := v.Verify(tokenStr)
		require.NoError(t, err)
		assert.Equal(t, "user_123", result["sub"])
	})

	t.Run("when issuer mismatches", func(t *testing.T) {
		claims := jwt.MapClaims{
			"sub": "user_123",
			"iss": "wrong-issuer",
			"aud": "my-audience",
			"exp": float64(time.Now().Add(time.Hour).Unix()),
		}
		tokenStr := signToken(t, claims, secret)

		_, err := v.Verify(tokenStr)
		require.Error(t, err)
	})

	t.Run("when audience mismatches", func(t *testing.T) {
		claims := jwt.MapClaims{
			"sub": "user_123",
			"iss": "my-issuer",
			"aud": "wrong-audience",
			"exp": float64(time.Now().Add(time.Hour).Unix()),
		}
		tokenStr := signToken(t, claims, secret)

		_, err := v.Verify(tokenStr)
		require.Error(t, err)
	})
}
