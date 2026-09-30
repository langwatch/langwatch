package authresolver

import (
	"context"
	"errors"
	"time"

	"github.com/langwatch/langwatch/pkg/herr"
	"github.com/langwatch/langwatch/services/aigateway/domain"
)

// licenseRefusalLRUSize bounds the memory a flood of distinct bad tokens can
// take. An evicted refusal only costs one more control-plane lookup.
const licenseRefusalLRUSize = 4096

// maxInstanceIDLen matches what the control plane accepts. A longer value is
// refused here, so it never becomes part of a cache key or a request body.
const maxInstanceIDLen = 128

// licenseRefusal is a control-plane refusal of a license token, remembered
// until it lapses.
type licenseRefusal struct {
	code  herr.Code
	until time.Time
}

// licenseRefusalCodes are the refusals that are final for a license token as it
// was presented. Transport failures are not among them: a control plane that
// could not answer has refused nothing.
var licenseRefusalCodes = []herr.Code{
	domain.ErrConnectLicenseNotRegistered,
	domain.ErrConnectLicenseRevoked,
	domain.ErrConnectLicenseExpired,
	domain.ErrConnectWrongInstance,
}

func isLicenseRefusal(err error) bool {
	_, ok := licenseRefusalCode(err)
	return ok
}

func licenseRefusalCode(err error) (herr.Code, bool) {
	for _, code := range licenseRefusalCodes {
		if errors.Is(err, code) {
			return code, true
		}
	}
	return "", false
}

// admitLicenseToken refuses a license token that cannot resolve, without asking
// the control plane: one that is malformed, one that names no install, and one
// the control plane refused a moment ago.
func (s *Service) admitLicenseToken(ctx context.Context, key domain.PresentedKey, h [64]byte) error {
	if !key.WellFormedLicenseToken() {
		return herr.New(ctx, domain.ErrInvalidAPIKey, nil)
	}
	if key.InstanceID == "" || len(key.InstanceID) > maxInstanceIDLen {
		return herr.New(ctx, domain.ErrConnectInstanceRequired, herr.M{
			"message": "A license token must be sent with the X-LangWatch-Instance header.",
		})
	}
	refusal, ok := s.licenseRefusals.Get(h)
	if !ok {
		return nil
	}
	if time.Now().After(refusal.until) {
		s.licenseRefusals.Remove(h)
		return nil
	}
	return herr.New(ctx, refusal.code, nil)
}

// rememberLicenseRefusal records a final refusal of a license token. It is a
// no-op for a virtual key and for any error that is not such a refusal.
func (s *Service) rememberLicenseRefusal(key domain.PresentedKey, h [64]byte, err error) {
	if s.licenseRefusalTTL < 0 || !key.IsLicenseToken() {
		return
	}
	code, ok := licenseRefusalCode(err)
	if !ok {
		return
	}
	s.licenseRefusals.Add(h, licenseRefusal{code: code, until: time.Now().Add(s.licenseRefusalTTL)})
}
