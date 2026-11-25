package storagesim

import (
	"fmt"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	v4 "github.com/aws/aws-sdk-go-v2/aws/signer/v4"
)

// BenchmarkParallelPutGetDistinctKeys is the load shape the striped locks are for:
// many writers each working their own key at once.
func BenchmarkParallelPutGetDistinctKeys(b *testing.B) {
	s, err := NewServer(Config{DataDir: filepath.Join(b.TempDir(), "data")})
	if err != nil {
		b.Fatal(err)
	}
	h := s.Handler()
	var n atomic.Int64
	call := func(method, key, body string) int {
		req := httptest.NewRequest(method, "/langwatch/"+key, strings.NewReader(body))
		req.Header.Set("X-Amz-Content-Sha256", unsignedPayload)
		if err := v4.NewSigner().SignHTTP(b.Context(), devKey, req, unsignedPayload, "s3", "auto", time.Now()); err != nil {
			b.Error(err)
		}
		rec := httptest.NewRecorder()
		h.ServeHTTP(rec, req)
		return rec.Code
	}
	b.ReportAllocs()
	b.SetParallelism(8)
	b.RunParallel(func(pb *testing.PB) {
		key := fmt.Sprintf("load/%d", n.Add(1))
		for pb.Next() {
			if call(http.MethodPut, key, "hello world") != 200 || call(http.MethodGet, key, "") != 200 {
				b.Error("put/get failed")
				return
			}
		}
	})
}
