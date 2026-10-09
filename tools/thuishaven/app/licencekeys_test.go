package app

import (
	"context"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/langwatch/langwatch/tools/thuishaven/domain"
)

func clearLicenceEnv(t *testing.T) {
	t.Helper()
	t.Setenv(domain.LicencePublicKeyVar, "")
	t.Setenv(domain.LicencePrivateKeyVar, "")
}

func TestStackLicenceKeyIsMintedOncePrivately(t *testing.T) {
	o := seedOrchestrator(t, &fakeSupervisor{})
	first, err := o.stackLicenceKey("feat-x")
	if err != nil {
		t.Fatal(err)
	}
	path := filepath.Join(o.cfg.Home, "licence", "feat-x", "private.pem")
	info, err := os.Stat(path)
	if err != nil || info.Mode().Perm() != 0o600 {
		t.Fatalf("key file %s: mode %v err %v, want 0600", path, info, err)
	}
	again, err := o.stackLicenceKey("feat-x")
	if err != nil || string(again) != string(first) {
		t.Fatal("a second read must return the same key, or a restart re-keys the stack's licences")
	}
	o.removeStackCredentials("feat-x")
	if _, err := os.Stat(filepath.Dir(path)); !os.IsNotExist(err) {
		t.Fatal("destroy must forget the stack's licence key")
	}
}

func TestStackEnvCarriesOnlyThePublicLicenceKey(t *testing.T) {
	clearLicenceEnv(t)
	o := seedOrchestrator(t, &fakeSupervisor{})
	env := domain.EnvMap(o.credentialEnv("feat-x", t.TempDir()))
	if !strings.HasPrefix(env[domain.LicencePublicKeyVar], "-----BEGIN PUBLIC KEY-----") {
		t.Fatalf("%s not injected", domain.LicencePublicKeyVar)
	}
	if _, ok := env[domain.LicencePrivateKeyVar]; ok {
		t.Fatal("the private key must never reach the stack's long-running processes")
	}
}

func TestSeedgenChildIsHandedThePrivateLicenceKey(t *testing.T) {
	clearLicenceEnv(t)
	sup := &fakeSupervisor{}
	o := seedOrchestrator(t, sup, seedStack())
	if err := o.Seed(context.Background(), UpParams{ExplicitSlug: "feat-x"}, SeedRequest{Args: []string{"--size", "tiny"}}); err != nil {
		t.Fatalf("Seed: %v", err)
	}
	env := domain.EnvMap(sup.envs[0])
	if !strings.HasPrefix(env[domain.LicencePrivateKeyVar], "-----BEGIN PRIVATE KEY-----") {
		t.Fatal("seedgen signs the stack's licences and needs its private key")
	}
}
