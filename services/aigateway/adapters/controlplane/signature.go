package controlplane

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
)

// Canonical is what a request signature covers.
type Canonical struct {
	Method, Path, Timestamp string
	Body                    []byte
}

// Signature returns hex(hmac_sha256(secret, METHOD\nPATH\nTS\nhex(sha256(body)))),
// the canonical string every internal HMAC channel signs and verifies. The
// body hash is hex-encoded inside it to match the TS verifier byte for byte.
func Signature(secret string, c Canonical) string {
	bodyHash := sha256.Sum256(c.Body)
	mac := hmac.New(sha256.New, []byte(secret))
	mac.Write([]byte(c.Method + "\n" + c.Path + "\n" + c.Timestamp + "\n" + hex.EncodeToString(bodyHash[:])))
	return hex.EncodeToString(mac.Sum(nil))
}
