package otelsetup

import (
	"crypto/rand"
	"os"

	"go.uber.org/zap"
)

// ResolveNodeID names this process for telemetry: the hostname, or a random
// id (logged) when the hostname is unavailable.
func ResolveNodeID(logger *zap.Logger) string {
	hostname, err := os.Hostname()
	if err != nil {
		id := rand.Text()
		logger.Warn("hostname_unavailable", zap.Error(err), zap.String("fallback_node_id", id))
		return id
	}
	return hostname
}
