package domain

import (
	"crypto/ecdsa"
	"crypto/elliptic"
	"crypto/rand"
	"crypto/rsa"
	"crypto/x509"
	"crypto/x509/pkix"
	"encoding/pem"
	"math/big"
	"testing"
	"time"
)

// testCA is a self-signed CA in the two key shapes the portless CA may use.
func testCA(t *testing.T, rsaKey bool) (certPEM, keyPEM []byte) {
	t.Helper()
	var signer any
	var public any
	var keyBlock *pem.Block
	if rsaKey {
		key, err := rsa.GenerateKey(rand.Reader, 2048)
		if err != nil {
			t.Fatal(err)
		}
		signer, public = key, &key.PublicKey
		keyBlock = &pem.Block{Type: "RSA PRIVATE KEY", Bytes: x509.MarshalPKCS1PrivateKey(key)}
	} else {
		key, err := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
		if err != nil {
			t.Fatal(err)
		}
		der, _ := x509.MarshalECPrivateKey(key)
		signer, public = key, &key.PublicKey
		keyBlock = &pem.Block{Type: "EC PRIVATE KEY", Bytes: der}
	}
	template := &x509.Certificate{
		SerialNumber: big.NewInt(1), Subject: pkix.Name{CommonName: "test CA"}, IsCA: true, BasicConstraintsValid: true,
		NotBefore: time.Now().Add(-time.Hour), NotAfter: time.Now().Add(24 * time.Hour), KeyUsage: x509.KeyUsageCertSign,
	}
	der, err := x509.CreateCertificate(rand.Reader, template, template, public, signer)
	if err != nil {
		t.Fatal(err)
	}
	return pem.EncodeToMemory(&pem.Block{Type: "CERTIFICATE", Bytes: der}), pem.EncodeToMemory(keyBlock)
}

// @scenario "haven gives outboundsim an https listener on 127.0.0.1 for the push stand-in"
func TestMintLoopbackCertificateIsTrustedForTheLoopbackIP(t *testing.T) {
	for _, rsaKey := range []bool{true, false} {
		caPEM, caKey := testCA(t, rsaKey)
		certPEM, keyPEM, err := MintLoopbackCertificate(caPEM, caKey, time.Now())
		if err != nil || len(keyPEM) == 0 {
			t.Fatalf("mint (rsa=%v): %v", rsaKey, err)
		}
		roots := x509.NewCertPool()
		roots.AppendCertsFromPEM(caPEM)
		block, _ := pem.Decode(certPEM)
		leaf, err := x509.ParseCertificate(block.Bytes)
		if err != nil {
			t.Fatal(err)
		}
		if _, err := leaf.Verify(x509.VerifyOptions{Roots: roots, DNSName: "127.0.0.1"}); err != nil {
			t.Fatalf("leaf does not verify for 127.0.0.1 (rsa=%v): %v", rsaKey, err)
		}
	}
	if _, _, err := MintLoopbackCertificate([]byte("nope"), nil, time.Now()); err == nil {
		t.Fatal("a CA that is not PEM should refuse")
	}
}

// @scenario "haven gives outboundsim an https listener on 127.0.0.1 for the push stand-in"
func TestWebPushProviderEnvNamesTheHTTPSListenerUnlessChosen(t *testing.T) {
	if got := WebPushProviderEnv(map[string]string{}, 6971); len(got) != 1 || got[0] != "WEB_PUSH_SERVICE_BASE=https://127.0.0.1:6971/push" {
		t.Fatalf("env = %v", got)
	}
	if got := WebPushProviderEnv(map[string]string{"WEB_PUSH_SERVICE_BASE": "https://push.example/x"}, 6971); got != nil {
		t.Fatalf("a chosen base was overridden: %v", got)
	}
	if got := WebPushProviderEnv(map[string]string{}, 0); got != nil {
		t.Fatalf("no listener, no base: %v", got)
	}
}
