package app

import (
	"crypto/ecdsa"
	"crypto/elliptic"
	"crypto/rand"
	"crypto/x509"
	"crypto/x509/pkix"
	"encoding/pem"
	"math/big"
	"os"
	"path/filepath"
	"slices"
	"strings"
	"testing"
	"time"

	"github.com/langwatch/langwatch/tools/thuishaven/domain"
)

// @scenario "haven gives outboundsim an https listener on 127.0.0.1 for the push stand-in"
func TestOutboundEnvMintsAnHTTPSListenerFromThePortlessCA(t *testing.T) {
	caDir := t.TempDir()
	key, _ := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	template := &x509.Certificate{SerialNumber: big.NewInt(1), Subject: pkix.Name{CommonName: "ca"}, IsCA: true,
		BasicConstraintsValid: true, KeyUsage: x509.KeyUsageCertSign, NotBefore: time.Now().Add(-time.Hour), NotAfter: time.Now().Add(time.Hour)}
	der, _ := x509.CreateCertificate(rand.Reader, template, template, &key.PublicKey, key)
	keyDER, _ := x509.MarshalECPrivateKey(key)
	caPath := filepath.Join(caDir, "ca.pem")
	_ = os.WriteFile(caPath, pem.EncodeToMemory(&pem.Block{Type: "CERTIFICATE", Bytes: der}), 0o600)
	_ = os.WriteFile(filepath.Join(caDir, "ca-key.pem"), pem.EncodeToMemory(&pem.Block{Type: "EC PRIVATE KEY", Bytes: keyDER}), 0o600)

	st := domain.Stack{Slug: "tls-test", WorktreeDir: t.TempDir(), OutboundTLSPort: 6971,
		Services: []domain.Service{{Name: domain.OutboundService, Port: 6970}}}
	env := outboundEnv(st, caPath)
	if !slices.Contains(env, "OUTBOUNDSIM_TLS_ADDR=127.0.0.1:6971") {
		t.Fatalf("env %v has no https listener", env)
	}
	for _, line := range env {
		if path, ok := strings.CutPrefix(line, "OUTBOUNDSIM_TLS_CERT="); ok {
			if info, err := os.Stat(path); err != nil || info.Mode().Perm() != 0o600 {
				t.Fatalf("certificate file %s: %v", path, err)
			}
		}
	}
	if got := outboundEnv(st, ""); slices.ContainsFunc(got, func(l string) bool { return strings.HasPrefix(l, "OUTBOUNDSIM_TLS_") }) {
		t.Fatalf("without a CA there is no https listener: %v", got)
	}
}
