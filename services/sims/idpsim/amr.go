package idpsim

// Amr is the authentication methods the tenant's ID tokens assert (RFC 8176:
// "pwd", "mfa", "otp", "hwk"); empty asserts none, as most tenants do.
func (t *Tenant) Amr() []string {
	t.mu.Lock()
	defer t.mu.Unlock()
	return append([]string{}, t.amr...)
}

// SetAmr sets what the tenant's ID tokens assert; an empty list stops asserting.
func (t *Tenant) SetAmr(methods []string) {
	t.mu.Lock()
	defer t.mu.Unlock()
	t.amr = append([]string(nil), methods...)
}
