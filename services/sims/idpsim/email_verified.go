package idpsim

import "fmt"

// EmailVerifiedSetting is how the tenant's ID tokens state email_verified:
// "default" (the claim as every tenant sends it), "true", "false" or "omit".
func (t *Tenant) EmailVerifiedSetting() string {
	t.mu.Lock()
	defer t.mu.Unlock()
	if t.emailVerified == "" {
		return "default"
	}
	return t.emailVerified
}

// SetEmailVerified takes "default", "true", "false" or "omit".
func (t *Tenant) SetEmailVerified(setting string) error {
	switch setting {
	case "default", "true", "false", "omit":
	default:
		return fmt.Errorf(`emailVerified must be "default", "true", "false" or "omit"`)
	}
	t.mu.Lock()
	defer t.mu.Unlock()
	t.emailVerified = setting
	if setting == "default" {
		t.emailVerified = ""
	}
	return nil
}

// applyEmailVerified overrides the claim on an ID token's claims as configured.
func (t *Tenant) applyEmailVerified(claims map[string]any) {
	switch t.EmailVerifiedSetting() {
	case "true":
		claims["email_verified"] = true
	case "false":
		claims["email_verified"] = false
	case "omit":
		delete(claims, "email_verified")
	}
}
