package apidiff

import (
	"bytes"
	"crypto"
	"crypto/rand"
	"crypto/rsa"
	"crypto/sha256"
	"crypto/x509"
	"encoding/base64"
	"encoding/json"
	"encoding/pem"
	"errors"
	"fmt"
	"strings"
)

// Main before the architecture merge parses license data with a schema that
// strips keys it does not know (platform/app/ee/licensing/types.ts at
// 73787aa2a7), then verifies the re-serialized bytes. The branch seed signs
// organizationId in, so main reads its license as unsigned and free. Main gets
// the same license re-signed with only the keys it knows, in signed order.

// licensePrivateKeyEnv is the key the branch seed signs licenses with.
const licensePrivateKeyEnv = "LANGWATCH_LICENSE_PRIVATE_KEY"

// mainLicenseDataKeys are the data keys main's LicenseDataSchema keeps.
var mainLicenseDataKeys = map[string]bool{
	"licenseId": true, "version": true, "organizationName": true, "email": true,
	"issuedAt": true, "expiresAt": true, "plan": true, "connectServices": true,
}

// errLicenseUnreadable never carries the license or a key, only that it failed.
var errLicenseUnreadable = errors.New("the branch license is not a base64 JSON {data, signature}")

// licenseForMain returns licenseKey with its data cut to the keys main knows and
// re-signed with privatePEM; unchanged when nothing needed cutting. A public key,
// when given, must verify the new signature. Errors never quote either key.
func licenseForMain(licenseKey, privatePEM, publicPEM string) (string, error) {
	decoded, err := base64.StdEncoding.DecodeString(strings.TrimSpace(licenseKey))
	if err != nil {
		return "", errLicenseUnreadable
	}
	var signed struct {
		Data json.RawMessage `json:"data"`
	}
	if err := json.Unmarshal(decoded, &signed); err != nil || len(signed.Data) == 0 {
		return "", errLicenseUnreadable
	}
	data, cut, err := keepMainLicenseKeys(signed.Data)
	if err != nil {
		return "", err
	}
	if !cut {
		return licenseKey, nil
	}
	if strings.TrimSpace(privatePEM) == "" {
		return "", fmt.Errorf("no %s in the shell or the root .env", licensePrivateKeyEnv)
	}
	signature, err := signLicenseData(data, privatePEM, publicPEM)
	if err != nil {
		return "", err
	}
	var out bytes.Buffer
	out.WriteString(`{"data":`)
	out.Write(data)
	out.WriteString(`,"signature":`)
	if err := writeJSONString(&out, signature); err != nil {
		return "", err
	}
	out.WriteString(`}`)
	return base64.StdEncoding.EncodeToString(out.Bytes()), nil
}

// keepMainLicenseKeys rewrites a data object keeping main's keys in their
// order, values byte for byte; cut says whether any key was dropped.
func keepMainLicenseKeys(data json.RawMessage) ([]byte, bool, error) {
	decoder := json.NewDecoder(bytes.NewReader(data))
	if token, err := decoder.Token(); err != nil || token != json.Delim('{') {
		return nil, false, errLicenseUnreadable
	}
	var members [][]byte
	cut := false
	for decoder.More() {
		key, value, err := nextLicenseMember(decoder)
		if err != nil {
			return nil, false, err
		}
		if !mainLicenseDataKeys[key] {
			cut = true
			continue
		}
		var member bytes.Buffer
		if err := writeJSONString(&member, key); err != nil {
			return nil, false, err
		}
		member.WriteString(":")
		member.Write(value)
		members = append(members, member.Bytes())
	}
	return append(append([]byte("{"), bytes.Join(members, []byte(","))...), '}'), cut, nil
}

// nextLicenseMember reads one key and its raw value from an object.
func nextLicenseMember(decoder *json.Decoder) (string, json.RawMessage, error) {
	token, err := decoder.Token()
	key, isKey := token.(string)
	if err != nil || !isKey {
		return "", nil, errLicenseUnreadable
	}
	var value json.RawMessage
	if err := decoder.Decode(&value); err != nil {
		return "", nil, errLicenseUnreadable
	}
	return key, value, nil
}

// writeJSONString writes value as a JSON string without Go's HTML escaping,
// as JavaScript's JSON.stringify writes it.
func writeJSONString(out *bytes.Buffer, value string) error {
	var encoded bytes.Buffer
	encoder := json.NewEncoder(&encoded)
	encoder.SetEscapeHTML(false)
	if err := encoder.Encode(value); err != nil {
		return err
	}
	out.Write(bytes.TrimSuffix(encoded.Bytes(), []byte("\n")))
	return nil
}

// signLicenseData signs data RSA-SHA256 (PKCS#1 v1.5, as node's createVerify
// checks it), base64, and checks it against publicPEM when one is given.
func signLicenseData(data []byte, privatePEM, publicPEM string) (string, error) {
	block, _ := pem.Decode([]byte(unescapePEM(privatePEM)))
	if block == nil {
		return "", fmt.Errorf("%s is not PEM", licensePrivateKeyEnv)
	}
	key, err := parseRSAPrivateKey(block.Bytes)
	if err != nil {
		return "", err
	}
	digest := sha256.Sum256(data)
	signature, err := rsa.SignPKCS1v15(rand.Reader, key, crypto.SHA256, digest[:])
	if err != nil {
		return "", fmt.Errorf("sign the main license: %w", err)
	}
	if strings.TrimSpace(publicPEM) != "" {
		if err := verifyLicenseData(data, signature, publicPEM); err != nil {
			return "", err
		}
	}
	return base64.StdEncoding.EncodeToString(signature), nil
}

// parseRSAPrivateKey reads a PKCS#8 or PKCS#1 RSA private key.
func parseRSAPrivateKey(der []byte) (*rsa.PrivateKey, error) {
	if parsed, err := x509.ParsePKCS8PrivateKey(der); err == nil {
		if key, ok := parsed.(*rsa.PrivateKey); ok {
			return key, nil
		}
		return nil, fmt.Errorf("%s is not an RSA key", licensePrivateKeyEnv)
	}
	key, err := x509.ParsePKCS1PrivateKey(der)
	if err != nil {
		return nil, fmt.Errorf("%s is neither PKCS#8 nor PKCS#1", licensePrivateKeyEnv)
	}
	return key, nil
}

// verifyLicenseData checks signature over data with publicPEM.
func verifyLicenseData(data, signature []byte, publicPEM string) error {
	block, _ := pem.Decode([]byte(unescapePEM(publicPEM)))
	if block == nil {
		return fmt.Errorf("%s is not PEM", licensePublicKeyEnv)
	}
	parsed, err := x509.ParsePKIXPublicKey(block.Bytes)
	key, ok := parsed.(*rsa.PublicKey)
	if err != nil || !ok {
		return fmt.Errorf("%s is not an RSA public key", licensePublicKeyEnv)
	}
	digest := sha256.Sum256(data)
	if rsa.VerifyPKCS1v15(key, crypto.SHA256, digest[:], signature) != nil {
		return fmt.Errorf("%s does not pair with %s", licensePrivateKeyEnv, licensePublicKeyEnv)
	}
	return nil
}

// unescapePEM turns a .env's escaped `\n` back into line breaks.
func unescapePEM(value string) string {
	return strings.ReplaceAll(strings.ReplaceAll(value, `\r\n`, "\n"), `\n`, "\n")
}
