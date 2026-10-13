package domain

import (
	"crypto/ecdsa"
	"crypto/elliptic"
	"crypto/rand"
	"crypto/x509"
	"crypto/x509/pkix"
	"encoding/pem"
	"errors"
	"math/big"
	"net"
	"strconv"
	"time"
)

// MintLoopbackCertificate issues a 30-day server certificate for the IP 127.0.0.1, signed by
// the portless Local CA (caCertPEM, caKeyPEM), so a stand-in reached over https on a bare IP
// is trusted by every runtime that already trusts that CA (NODE_EXTRA_CA_CERTS).
func MintLoopbackCertificate(caCertPEM, caKeyPEM []byte, now time.Time) (certPEM, keyPEM []byte, err error) {
	caBlock, _ := pem.Decode(caCertPEM)
	if caBlock == nil {
		return nil, nil, errors.New("the CA certificate is not PEM")
	}
	ca, err := x509.ParseCertificate(caBlock.Bytes)
	if err != nil {
		return nil, nil, err
	}
	caKey, err := parseSigningKey(caKeyPEM)
	if err != nil {
		return nil, nil, err
	}
	key, err := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	if err != nil {
		return nil, nil, err
	}
	serial, err := rand.Int(rand.Reader, new(big.Int).Lsh(big.NewInt(1), 120))
	if err != nil {
		return nil, nil, err
	}
	template := &x509.Certificate{
		SerialNumber: serial, Subject: pkix.Name{CommonName: "127.0.0.1"},
		IPAddresses: []net.IP{net.IPv4(127, 0, 0, 1)},
		NotBefore:   now.Add(-time.Hour), NotAfter: now.Add(30 * 24 * time.Hour),
		KeyUsage: x509.KeyUsageDigitalSignature, ExtKeyUsage: []x509.ExtKeyUsage{x509.ExtKeyUsageServerAuth},
	}
	der, err := x509.CreateCertificate(rand.Reader, template, ca, &key.PublicKey, caKey)
	if err != nil {
		return nil, nil, err
	}
	keyDER, err := x509.MarshalPKCS8PrivateKey(key)
	if err != nil {
		return nil, nil, err
	}
	return pem.EncodeToMemory(&pem.Block{Type: "CERTIFICATE", Bytes: der}),
		pem.EncodeToMemory(&pem.Block{Type: "PRIVATE KEY", Bytes: keyDER}), nil
}

// parseSigningKey reads a PKCS#8, PKCS#1 (RSA) or SEC 1 (EC) private key.
func parseSigningKey(keyPEM []byte) (any, error) {
	block, _ := pem.Decode(keyPEM)
	if block == nil {
		return nil, errors.New("the CA key is not PEM")
	}
	if key, err := x509.ParsePKCS8PrivateKey(block.Bytes); err == nil {
		return key, nil
	}
	if key, err := x509.ParsePKCS1PrivateKey(block.Bytes); err == nil {
		return key, nil
	}
	return x509.ParseECPrivateKey(block.Bytes)
}

// WebPushProviderEnv names outboundsim's https listener as the notification module's one
// extra push service, unless the resolved environment already names one.
func WebPushProviderEnv(resolved map[string]string, tlsPort int) []string {
	if tlsPort == 0 || resolved["WEB_PUSH_SERVICE_BASE"] != "" {
		return nil
	}
	return []string{"WEB_PUSH_SERVICE_BASE=https://127.0.0.1:" + strconv.Itoa(tlsPort) + "/push"}
}
