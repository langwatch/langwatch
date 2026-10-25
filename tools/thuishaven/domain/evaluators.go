package domain

import (
	"crypto/rand"
	"encoding/hex"
)

// NewEvaluatorRuntimeSecret is a fresh random dev secret for one stack's Go
// evaluator runtime; the same value goes to the app lanes and the nlp lane.
func NewEvaluatorRuntimeSecret() string {
	b := make([]byte, 24)
	_, _ = rand.Read(b)
	return hex.EncodeToString(b)
}
