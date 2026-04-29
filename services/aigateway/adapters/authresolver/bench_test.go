package authresolver

import "testing"

// BenchmarkHashKey is the hot-path cache lookup hash. Fires on every
// inbound request BEFORE we can serve from L1.
func BenchmarkHashKey(b *testing.B) {
	raw := "lw_vk_live_01HZX0123456789ABCDEFGHIJ"
	b.ReportAllocs()
	for i := 0; i < b.N; i++ {
		_ = hashKey(raw)
	}
}
