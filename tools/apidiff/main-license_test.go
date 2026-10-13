package apidiff

import (
	"crypto"
	"crypto/rand"
	"crypto/rsa"
	"crypto/sha256"
	"crypto/x509"
	"encoding/base64"
	"encoding/json"
	"encoding/pem"
	"strings"
	"testing"
)

// branchLicenseData is the branch seed's data shape: main's keys, then the
// organizationId binding main does not know.
const branchLicenseData = `{"licenseId":"lic-1","version":1,"organizationName":"A & B <x>","email":"a@b.c","issuedAt":"2026-10-12T15:11:49.766Z","expiresAt":"2027-10-12T15:11:49.766Z","plan":{"type":"ENTERPRISE","name":"Enterprise","maxMembers":5,"maxMessagesPerMonth":1e21,"canPublish":true},"organizationId":"local-dev-organization"}`

const mainLicenseData = `{"licenseId":"lic-1","version":1,"organizationName":"A & B <x>","email":"a@b.c","issuedAt":"2026-10-12T15:11:49.766Z","expiresAt":"2027-10-12T15:11:49.766Z","plan":{"type":"ENTERPRISE","name":"Enterprise","maxMembers":5,"maxMessagesPerMonth":1e21,"canPublish":true}}`

// throwawayKeys makes a test-only key pair, PEM-encoded with escaped `\n` as a
// .env holds them.
func throwawayKeys(t *testing.T) (*rsa.PrivateKey, string, string) {
	t.Helper()
	key, err := rsa.GenerateKey(rand.Reader, 2048)
	if err != nil {
		t.Fatal(err)
	}
	der, err := x509.MarshalPKCS8PrivateKey(key)
	if err != nil {
		t.Fatal(err)
	}
	pub, err := x509.MarshalPKIXPublicKey(&key.PublicKey)
	if err != nil {
		t.Fatal(err)
	}
	escape := func(block *pem.Block) string {
		return strings.ReplaceAll(string(pem.EncodeToMemory(block)), "\n", `\n`)
	}
	return key, escape(&pem.Block{Type: "PRIVATE KEY", Bytes: der}), escape(&pem.Block{Type: "PUBLIC KEY", Bytes: pub})
}

func signedLicense(t *testing.T, key *rsa.PrivateKey, data string) string {
	t.Helper()
	digest := sha256.Sum256([]byte(data))
	signature, err := rsa.SignPKCS1v15(rand.Reader, key, crypto.SHA256, digest[:])
	if err != nil {
		t.Fatal(err)
	}
	body := `{"data":` + data + `,"signature":"` + base64.StdEncoding.EncodeToString(signature) + `"}`
	return base64.StdEncoding.EncodeToString([]byte(body))
}

func decodeLicense(t *testing.T, licenseKey string) (string, []byte) {
	t.Helper()
	raw, err := base64.StdEncoding.DecodeString(licenseKey)
	if err != nil {
		t.Fatal(err)
	}
	var signed struct {
		Data      json.RawMessage `json:"data"`
		Signature string          `json:"signature"`
	}
	if err := json.Unmarshal(raw, &signed); err != nil {
		t.Fatal(err)
	}
	signature, err := base64.StdEncoding.DecodeString(signed.Signature)
	if err != nil {
		t.Fatal(err)
	}
	return string(signed.Data), signature
}

func TestLicenseForMain(t *testing.T) {
	key, privatePEM, publicPEM := throwawayKeys(t)

	t.Run("a bound license is re-signed over main's keys, in order, values byte for byte", func(t *testing.T) {
		got, err := licenseForMain(signedLicense(t, key, branchLicenseData), privatePEM, publicPEM)
		if err != nil {
			t.Fatal(err)
		}
		data, signature := decodeLicense(t, got)
		if data != mainLicenseData {
			t.Errorf("data = %s\nwant   %s", data, mainLicenseData)
		}
		digest := sha256.Sum256([]byte(data))
		if rsa.VerifyPKCS1v15(&key.PublicKey, crypto.SHA256, digest[:], signature) != nil {
			t.Error("signature does not verify over main's bytes")
		}
	})

	t.Run("a license main already reads whole is handed back unchanged", func(t *testing.T) {
		license := signedLicense(t, key, mainLicenseData)
		got, err := licenseForMain(license, "", "")
		if err != nil || got != license {
			t.Errorf("got changed license, err %v", err)
		}
	})

	t.Run("a private key that does not pair with the public key is refused, naming neither value", func(t *testing.T) {
		_, otherPrivate, _ := throwawayKeys(t)
		_, err := licenseForMain(signedLicense(t, key, branchLicenseData), otherPrivate, publicPEM)
		if err == nil || !strings.Contains(err.Error(), "does not pair") {
			t.Fatalf("err = %v", err)
		}
		if strings.Contains(err.Error(), "PRIVATE KEY") || strings.Contains(err.Error(), "PUBLIC KEY") {
			t.Error("error quotes key material")
		}
	})

	t.Run("no private key is refused", func(t *testing.T) {
		if _, err := licenseForMain(signedLicense(t, key, branchLicenseData), "", publicPEM); err == nil {
			t.Fatal("want an error")
		}
	})

	t.Run("an unreadable license is refused without echoing it", func(t *testing.T) {
		_, err := licenseForMain("not-base64-!!", privatePEM, publicPEM)
		if err == nil || strings.Contains(err.Error(), "not-base64") {
			t.Fatalf("err = %v", err)
		}
	})
}
