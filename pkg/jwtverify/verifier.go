// Package jwtverify verifies HMAC-SHA256 signed JWTs with key rotation support.
package jwtverify

import (
	"fmt"

	"github.com/golang-jwt/jwt/v5"
)

// JWTVerifier verifies HMAC-signed JWTs, returning raw map claims
// for the caller to extract domain-specific fields.
type JWTVerifier struct {
	current   []byte
	previous  []byte // optional rotation key
	parseOpts []jwt.ParserOption
}

// Option configures the verifier.
type Option func(*JWTVerifier)

// WithIssuer requires the JWT to have the given issuer.
func WithIssuer(iss string) Option {
	return func(v *JWTVerifier) {
		v.parseOpts = append(v.parseOpts, jwt.WithIssuer(iss))
	}
}

// WithAudience requires the JWT to have the given audience.
func WithAudience(aud string) Option {
	return func(v *JWTVerifier) {
		v.parseOpts = append(v.parseOpts, jwt.WithAudience(aud))
	}
}

// NewJWTVerifier creates a verifier. previousSecret may be empty (no rotation).
func NewJWTVerifier(currentSecret, previousSecret string, opts ...Option) *JWTVerifier {
	v := &JWTVerifier{
		current:  []byte(currentSecret),
		previous: []byte(previousSecret),
	}
	for _, opt := range opts {
		opt(v)
	}
	return v
}

// Verify parses and validates the JWT, returning raw map claims.
func (v *JWTVerifier) Verify(tokenString string) (jwt.MapClaims, error) {
	token, err := jwt.Parse(tokenString, v.keyFunc(v.current), v.parseOpts...)
	if err != nil && len(v.previous) > 0 {
		token, err = jwt.Parse(tokenString, v.keyFunc(v.previous), v.parseOpts...)
	}
	if err != nil {
		return nil, fmt.Errorf("jwt verify: %w", err)
	}

	mapClaims, ok := token.Claims.(jwt.MapClaims)
	if !ok || !token.Valid {
		return nil, fmt.Errorf("invalid token claims")
	}

	return mapClaims, nil
}

func (v *JWTVerifier) keyFunc(secret []byte) jwt.Keyfunc {
	return func(token *jwt.Token) (any, error) {
		if _, ok := token.Method.(*jwt.SigningMethodHMAC); !ok {
			return nil, fmt.Errorf("unexpected signing method: %v", token.Header["alg"])
		}
		return secret, nil
	}
}
