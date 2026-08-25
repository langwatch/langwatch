package idpsim

import (
	"maps"
	"net"
	"net/http"
	"strconv"
	"strings"
	"sync"
)

// verificationStore holds what the two domain-verification surfaces serve: TXT
// records for DNS verification and per-domain tokens for HTTP (well-known)
// verification. Domains are stored lowercased without a trailing dot.
type verificationStore struct {
	mu     sync.RWMutex
	txt    map[string][]string
	tokens map[string]string
}

func newVerificationStore(tenants []*Tenant) *verificationStore {
	v := &verificationStore{txt: map[string][]string{}, tokens: map[string]string{}}
	// Every tenant's fake domain arrives pre-verifiable, so the golden path
	// needs no control-API call at all.
	for _, t := range tenants {
		id := strconv.Itoa(t.ID)
		v.SetTXT(t.Domain, []string{"langwatch-domain-verification=idpsim-t" + id})
		v.SetToken(t.Domain, "idpsim-verification-t"+id)
	}
	return v
}

func normalizeDomain(domain string) string {
	return strings.TrimSuffix(strings.ToLower(strings.TrimSpace(domain)), ".")
}

// SetTXT configures the TXT answer for a domain.
func (v *verificationStore) SetTXT(domain string, values []string) {
	v.mu.Lock()
	defer v.mu.Unlock()
	v.txt[normalizeDomain(domain)] = values
}

// RemoveTXT drops a domain's TXT answer.
func (v *verificationStore) RemoveTXT(domain string) {
	v.mu.Lock()
	defer v.mu.Unlock()
	delete(v.txt, normalizeDomain(domain))
}

// TXT looks up a domain's TXT values.
func (v *verificationStore) TXT(domain string) ([]string, bool) {
	v.mu.RLock()
	defer v.mu.RUnlock()
	values, ok := v.txt[normalizeDomain(domain)]
	return values, ok
}

// SetToken configures the HTTP verification token for a domain.
func (v *verificationStore) SetToken(domain, token string) {
	v.mu.Lock()
	defer v.mu.Unlock()
	v.tokens[normalizeDomain(domain)] = token
}

// RemoveToken drops a domain's HTTP verification token.
func (v *verificationStore) RemoveToken(domain string) {
	v.mu.Lock()
	defer v.mu.Unlock()
	delete(v.tokens, normalizeDomain(domain))
}

// Token looks up a domain's HTTP verification token.
func (v *verificationStore) Token(domain string) (string, bool) {
	v.mu.RLock()
	defer v.mu.RUnlock()
	token, ok := v.tokens[normalizeDomain(domain)]
	return token, ok
}

// Snapshot dumps both maps for the control API's state view.
func (v *verificationStore) Snapshot() (txt map[string][]string, tokens map[string]string) {
	v.mu.RLock()
	defer v.mu.RUnlock()
	txt = make(map[string][]string, len(v.txt))
	for k, vals := range v.txt {
		txt[k] = append([]string{}, vals...)
	}
	tokens = make(map[string]string, len(v.tokens))
	maps.Copy(tokens, v.tokens)
	return txt, tokens
}

// handleWellKnownVerification serves the HTTP (non-DNS) verification token.
// The domain being verified is the request's Host by default — the shape a
// real verifier fetches — with a ?domain= override so a test (or a verifier
// that cannot route the customer hostname here) can name the domain
// explicitly.
func (s *Server) handleWellKnownVerification(w http.ResponseWriter, r *http.Request) {
	domain := r.URL.Query().Get("domain")
	if domain == "" {
		domain = r.Host
		if host, _, err := net.SplitHostPort(r.Host); err == nil {
			domain = host
		}
	}
	token, ok := s.verification.Token(domain)
	if !ok {
		http.NotFound(w, r)
		return
	}
	w.Header().Set("Content-Type", "text/plain; charset=utf-8")
	_, _ = w.Write([]byte(token))
}
