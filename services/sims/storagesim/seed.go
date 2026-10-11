package storagesim

import (
	"crypto/md5" //nolint:gosec // S3 defines the ETag as the body's MD5
	"encoding/hex"
	"encoding/json"
	"os"
)

// bucketLangwatch is the bucket the product writes to.
const bucketLangwatch = "langwatch"

// seedObjects are the demo objects written when STORAGESIM_SEED=1.
var seedObjects = []struct{ key, contentType, body string }{
	{"seed/hello.txt", "text/plain", "Hello from storagesim.\n"},
	{"seed/sample.json", "application/json", `{"sample":true,"source":"storagesim seed"}` + "\n"},
}

// seed stores the demo objects, leaving any that already exist untouched.
func (s *Server) seed() error {
	for _, o := range seedObjects {
		obj := object{bucket: bucketLangwatch, key: o.key}
		target := s.path(obj)
		if _, err := os.Lstat(target); err == nil {
			continue
		}
		sum := md5.Sum([]byte(o.body)) //nolint:gosec // S3's ETag is the body's MD5
		raw, _ := json.Marshal(meta{Bucket: obj.bucket, Key: obj.key, ContentType: o.contentType, ETag: `"` + hex.EncodeToString(sum[:]) + `"`})
		if err := os.WriteFile(target, []byte(o.body), 0o600); err != nil {
			return err
		}
		if err := s.writeSidecar(target+".json", raw); err != nil {
			return err
		}
	}
	return nil
}
