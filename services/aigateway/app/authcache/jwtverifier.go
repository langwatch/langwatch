package authcache

import (
	"errors"
	"fmt"

	"github.com/golang-jwt/jwt/v5"
)

// Claims are the gateway-relevant fields extracted from a VK JWT.
type Claims struct {
	VirtualKeyID string
	ProjectID    string
	TeamID       string
	ExpiresAt    int64
}

// JWTVerifier verifies and extracts claims from control-plane-issued JWTs.
type JWTVerifier struct {
	current  []byte
	previous []byte // optional rotation key
}

// NewJWTVerifier creates a verifier. previous may be empty (no rotation).
func NewJWTVerifier(currentSecret, previousSecret string) *JWTVerifier {
	return &JWTVerifier{
		current:  []byte(currentSecret),
		previous: []byte(previousSecret),
	}
}

// Verify parses and validates the JWT, returning the extracted claims.
func (v *JWTVerifier) Verify(tokenString string) (*Claims, error) {
	token, err := jwt.Parse(tokenString, v.keyFunc(v.current))
	if err != nil && len(v.previous) > 0 {
		token, err = jwt.Parse(tokenString, v.keyFunc(v.previous))
	}
	if err != nil {
		return nil, fmt.Errorf("jwt verify: %w", err)
	}

	mapClaims, ok := token.Claims.(jwt.MapClaims)
	if !ok || !token.Valid {
		return nil, errors.New("invalid token claims")
	}

	return extractClaims(mapClaims), nil
}

func (v *JWTVerifier) keyFunc(secret []byte) jwt.Keyfunc {
	return func(token *jwt.Token) (any, error) {
		if _, ok := token.Method.(*jwt.SigningMethodHMAC); !ok {
			return nil, fmt.Errorf("unexpected signing method: %v", token.Header["alg"])
		}
		return secret, nil
	}
}

func extractClaims(m jwt.MapClaims) *Claims {
	c := &Claims{}
	if v, ok := m["vk_id"].(string); ok {
		c.VirtualKeyID = v
	}
	if v, ok := m["project_id"].(string); ok {
		c.ProjectID = v
	}
	if v, ok := m["team_id"].(string); ok {
		c.TeamID = v
	}
	if v, ok := m["exp"].(float64); ok {
		c.ExpiresAt = int64(v)
	}
	return c
}
