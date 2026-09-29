package domain

import "strings"

// LicenseTokenPrefix marks a bearer token derived from a self-hosted license.
// The rest of the token is the SHA-256 of the license, as 64 lowercase hex
// characters. The license itself never travels.
const LicenseTokenPrefix = "lwl_"

const licenseTokenHexLen = 64

// PresentedKey is the credential a caller put on a request.
//
// A virtual key is the token alone. A license token also carries the id of the
// install that presented it, and the pair is what gets resolved and cached: the
// same token from another install is a different credential, so an entry cached
// for one install is never served to another.
type PresentedKey struct {
	Token string
	// InstanceID is set only for a license token. It stays empty for a
	// virtual key, whatever headers the request carried.
	InstanceID string
}

// IsLicenseToken reports whether the token claims to be a license token. A
// token that claims it and is malformed is refused, never tried as a virtual
// key.
func (k PresentedKey) IsLicenseToken() bool {
	return strings.HasPrefix(k.Token, LicenseTokenPrefix)
}

// WellFormedLicenseToken reports whether the token is the prefix followed by
// exactly 64 lowercase hex characters. Anything else cannot be in the registry,
// so it is refused without asking the control plane.
func (k PresentedKey) WellFormedLicenseToken() bool {
	body, ok := strings.CutPrefix(k.Token, LicenseTokenPrefix)
	if !ok || len(body) != licenseTokenHexLen {
		return false
	}
	for _, c := range body {
		isDigit := c >= '0' && c <= '9'
		isLowerHex := c >= 'a' && c <= 'f'
		if !isDigit && !isLowerHex {
			return false
		}
	}
	return true
}
