// Package cmd exposes the aigateway service entrypoint for the mono-binary.
package cmd

import (
	"context"

	aigateway "github.com/langwatch/langwatch/services/aigateway"
)

// Root is the service entrypoint called by cmd/service.
func Root(ctx context.Context, _ []string) error {
	return aigateway.Run(ctx)
}
