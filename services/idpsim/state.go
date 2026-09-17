package idpsim

import (
	"crypto/rsa"
	"crypto/x509"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"sync"
)

type savedState struct {
	Version int                 `json:"version"`
	Tenants []json.RawMessage   `json:"tenants"`
	TXT     map[string][]string `json:"txt"`
	Tokens  map[string]string   `json:"tokens"`
}

type savedTenant struct {
	ID               int                  `json:"id"`
	Domain           string               `json:"domain"`
	Key              []byte               `json:"key"`
	Certificate      []byte               `json:"certificate"`
	SCIMToken        string               `json:"scimToken"`
	Users            []*User              `json:"users"`
	Groups           []*Group             `json:"groups"`
	Applications     []*Application       `json:"applications"`
	Provisioning     ProvisioningTarget   `json:"provisioning"`
	LastProvisioning *ProvisioningOutcome `json:"lastProvisioning,omitempty"`
	SamlpSubjects    bool                 `json:"samlpSubjects"`
	Events           []Event              `json:"events,omitempty"`
}

type stateStore struct {
	mu   sync.Mutex
	path string
	savedState
}

func openState(dir string) (*stateStore, error) {
	if dir == "" {
		return nil, nil
	}
	if err := os.MkdirAll(dir, 0o700); err != nil {
		return nil, fmt.Errorf("creating idpsim data directory: %w", err)
	}
	store := &stateStore{path: filepath.Join(dir, "state.json")}
	raw, err := os.ReadFile(store.path)
	if errors.Is(err, os.ErrNotExist) {
		return store, nil
	}
	if err != nil {
		return nil, fmt.Errorf("reading idpsim state: %w", err)
	}
	if err := json.Unmarshal(raw, &store.savedState); err != nil {
		return nil, fmt.Errorf("decoding idpsim state %s: %w", store.path, err)
	}
	if store.Version != 1 || len(store.Tenants) == 0 || store.TXT == nil || store.Tokens == nil {
		return nil, fmt.Errorf("invalid or unsupported idpsim state in %s", store.path)
	}
	return store, nil
}

func (st *stateStore) restore(cfg Config) ([]*Tenant, *verificationStore, error) {
	if st == nil || st.Version == 0 {
		tenants, err := newTenants(cfg.Tenants, cfg.BaseURL)
		return tenants, newVerificationStore(tenants), err
	}
	tenants := make([]*Tenant, cfg.Tenants)
	verification := &verificationStore{txt: st.TXT, tokens: st.Tokens}
	// Keep tenants outside the selected range on disk so temporarily shrinking
	// IDPSIM_TENANTS cannot erase their registrations or rotate their keys.
	for i, raw := range st.Tenants {
		tenant, err := restoreTenant(raw, i+1, cfg.BaseURL)
		if err != nil {
			return nil, nil, fmt.Errorf("restoring idpsim tenant %d: %w", i+1, err)
		}
		if i < len(tenants) {
			tenants[i] = tenant
		}
	}
	for i := len(st.Tenants); i < len(tenants); i++ {
		tenant, err := newTenant(i+1, cfg.BaseURL)
		if err != nil {
			return nil, nil, err
		}
		tenants[i] = tenant
		verification.SetTXT(tenant.Domain, []string{fmt.Sprintf("langwatch-domain-verification=idpsim-t%d", tenant.ID)})
		verification.SetToken(tenant.Domain, fmt.Sprintf("idpsim-verification-t%d", tenant.ID))
	}
	return tenants, verification, nil
}

func restoreTenant(raw json.RawMessage, id int, baseURL string) (*Tenant, error) {
	var saved savedTenant
	if err := json.Unmarshal(raw, &saved); err != nil {
		return nil, err
	}
	if saved.ID != id || saved.Domain == "" || saved.SCIMToken == "" {
		return nil, fmt.Errorf("invalid tenant identity")
	}
	key, err := x509.ParsePKCS1PrivateKey(saved.Key)
	if err != nil {
		return nil, fmt.Errorf("parsing signing key: %w", err)
	}
	cert, err := x509.ParseCertificate(saved.Certificate)
	if err != nil {
		return nil, fmt.Errorf("parsing signing certificate: %w", err)
	}
	publicKey, ok := cert.PublicKey.(*rsa.PublicKey)
	if !ok || !publicKey.Equal(&key.PublicKey) {
		return nil, fmt.Errorf("signing certificate does not match key")
	}
	return &Tenant{
		ID: id, BaseURL: fmt.Sprintf("%s/t/%d", strings.TrimSuffix(baseURL, "/"), id),
		Domain: saved.Domain, SCIMToken: saved.SCIMToken, Key: key, Cert: cert,
		users: saved.Users, groups: saved.Groups, apps: saved.Applications,
		provisioning: saved.Provisioning, lastProvisioning: saved.LastProvisioning,
		samlpSubjects: saved.SamlpSubjects, events: saved.Events,
		codes: map[string]*authCode{}, grants: map[string]*accessGrant{},
	}, nil
}

func (t *Tenant) snapshotState() (json.RawMessage, error) {
	t.mu.Lock()
	defer t.mu.Unlock()
	return json.Marshal(savedTenant{
		ID: t.ID, Domain: t.Domain, SCIMToken: t.SCIMToken,
		Key: x509.MarshalPKCS1PrivateKey(t.Key), Certificate: t.Cert.Raw,
		Users: t.users, Groups: t.groups, Applications: t.apps,
		Provisioning: t.provisioning, LastProvisioning: t.lastProvisioning,
		SamlpSubjects: t.samlpSubjects, Events: t.events,
	})
}

func (s *Server) saveState() error {
	st := s.persistence
	if st == nil {
		return nil
	}
	st.mu.Lock()
	defer st.mu.Unlock()
	state := savedState{Version: 1, Tenants: append([]json.RawMessage{}, st.Tenants...)}
	for i, tenant := range s.tenants {
		raw, err := tenant.snapshotState()
		if err != nil {
			return fmt.Errorf("encoding idpsim tenant: %w", err)
		}
		if i < len(state.Tenants) {
			state.Tenants[i] = raw
		} else {
			state.Tenants = append(state.Tenants, raw)
		}
	}
	state.TXT, state.Tokens = s.verification.Snapshot()
	raw, err := json.Marshal(state)
	if err != nil {
		return fmt.Errorf("encoding idpsim state: %w", err)
	}
	if err := writeState(st.path, raw); err != nil {
		return fmt.Errorf("saving idpsim state: %w", err)
	}
	st.savedState = state
	return nil
}

func writeState(path string, raw []byte) error {
	file, err := os.CreateTemp(filepath.Dir(path), ".state-*")
	if err != nil {
		return err
	}
	defer os.Remove(file.Name())
	defer file.Close()
	if _, err := file.Write(raw); err != nil {
		return err
	}
	if err := file.Sync(); err != nil {
		return err
	}
	if err := file.Close(); err != nil {
		return err
	}
	return os.Rename(file.Name(), path)
}
