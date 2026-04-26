package auth

import (
	"context"
	"errors"
	"time"

	"github.com/langwatch/langwatch/services/cli/internal/config"
)

// RefreshThreshold is the minimum remaining lifetime an access token
// must have before EnsureFresh decides to refresh it. The 5-minute
// floor is what cli-login.feature scenario "CLI refreshes the access
// token before it expires" mandates.
const RefreshThreshold = 5 * time.Minute

// ErrSessionRevoked is returned when EnsureFresh discovers the
// refresh token is no longer valid. Callers (typically
// `langwatch claude`/wrappers) should clear local state and ask the
// user to re-login.
var ErrSessionRevoked = errors.New("session revoked — run `langwatch login` to sign in again")

// EnsureFresh refreshes the access token if it has less than
// RefreshThreshold remaining, persisting the rotated tokens back to
// disk. Idempotent: if the access token is still fresh enough, this
// returns nil without a network round-trip.
//
// On a 401 from the server (refresh-token revocation), EnsureFresh
// clears the local config + returns ErrSessionRevoked so callers can
// surface a single, consistent message and exit.
//
// Now is injected for testing; pass nil in production to use
// time.Now.
func EnsureFresh(ctx context.Context, cfg *config.Config, client *Client, now func() time.Time) error {
	if !cfg.LoggedIn() {
		return nil
	}
	if cfg.RefreshToken == "" {
		// No refresh token, nothing we can do — return ok so the
		// caller proceeds and lets the gateway 401 if needed.
		return nil
	}
	if now == nil {
		now = time.Now
	}

	expiresAt := time.Unix(cfg.ExpiresAt, 0)
	if expiresAt.IsZero() || expiresAt.Sub(now()) > RefreshThreshold {
		return nil
	}

	r, err := client.Refresh(ctx, cfg.RefreshToken)
	if err != nil {
		if errors.Is(err, ErrUnauthorized) {
			// Server revoked the refresh token. Clear local state
			// and tell the caller in a recognisable way.
			_ = config.Clear()
			return ErrSessionRevoked
		}
		return err
	}

	cfg.AccessToken = r.AccessToken
	cfg.RefreshToken = r.RefreshToken
	cfg.ExpiresAt = now().Unix() + int64(r.ExpiresIn)
	return config.Save(cfg)
}
