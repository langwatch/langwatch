package domain

import (
	"crypto/rand"
	"crypto/rsa"
	"crypto/x509"
	"encoding/pem"
	"errors"
	"strings"
)

// A stack verifies licences signed by its own dev key pair, so a seed can
// license an org without the production key. The licence carries the devStack
// claim, which a release build refuses whatever key signed it
// (specs/licensing/license-signing-key.feature).

const (
	LicencePublicKeyVar  = "LANGWATCH_LICENSE_PUBLIC_KEY"
	LicencePrivateKeyVar = "LANGWATCH_LICENSE_PRIVATE_KEY"
)

// MintLicenceKey returns a fresh RSA 2048 private key as PKCS#8 PEM.
func MintLicenceKey() ([]byte, error) {
	key, err := rsa.GenerateKey(rand.Reader, 2048)
	if err != nil {
		return nil, err
	}
	der, err := x509.MarshalPKCS8PrivateKey(key)
	if err != nil {
		return nil, err
	}
	return pem.EncodeToMemory(&pem.Block{Type: "PRIVATE KEY", Bytes: der}), nil
}

// LicencePublicKey derives the SPKI PEM public half of a MintLicenceKey key.
func LicencePublicKey(privatePEM []byte) ([]byte, error) {
	block, _ := pem.Decode(privatePEM)
	if block == nil {
		return nil, errors.New("licence key is not PEM")
	}
	key, err := x509.ParsePKCS8PrivateKey(block.Bytes)
	if err != nil {
		return nil, err
	}
	signer, ok := key.(*rsa.PrivateKey)
	if !ok {
		return nil, errors.New("licence key is not RSA")
	}
	der, err := x509.MarshalPKIXPublicKey(&signer.PublicKey)
	if err != nil {
		return nil, err
	}
	return pem.EncodeToMemory(&pem.Block{Type: "PUBLIC KEY", Bytes: der}), nil
}

// StackLicenceEnv injects one half of the stack's pair as key=PEM (newlines
// escaped, which the verifier expands), unless the developer's resolved env
// names either half: their own pair wins whole, never half-replaced.
func StackLicenceEnv(key string, keyPEM []byte, resolved map[string]string) []string {
	if len(keyPEM) == 0 || resolved[LicencePublicKeyVar] != "" || resolved[LicencePrivateKeyVar] != "" {
		return nil
	}
	return []string{key + "=" + strings.ReplaceAll(strings.TrimSpace(string(keyPEM)), "\n", `\n`)}
}
