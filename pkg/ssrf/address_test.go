package ssrf

import (
	"encoding/json"
	"net/netip"
	"os"
	"path/filepath"
	"testing"
)

// addressVector mirrors one entry of testdata/address_vectors.json — the corpus
// shared with the @langwatch/ssrf TypeScript package. Keeping the two languages
// bound to the same file is the whole point: a rule added to one implementation
// but not the other fails here or in the TS suite.
type addressVector struct {
	Addr     string `json:"addr"`
	Category string `json:"category"`
	Note     string `json:"note"`
}

type addressCorpus struct {
	Vectors []addressVector `json:"vectors"`
}

func loadVectors(t *testing.T) []addressVector {
	t.Helper()
	raw, err := os.ReadFile(filepath.Join("testdata", "address_vectors.json"))
	if err != nil {
		t.Fatalf("read corpus: %v", err)
	}
	var corpus addressCorpus
	if err := json.Unmarshal(raw, &corpus); err != nil {
		t.Fatalf("parse corpus: %v", err)
	}
	if len(corpus.Vectors) == 0 {
		t.Fatal("corpus is empty")
	}
	return corpus.Vectors
}

func TestClassifyMatchesSharedCorpus(t *testing.T) {
	for _, v := range loadVectors(t) {
		addr, err := netip.ParseAddr(v.Addr)
		if err != nil {
			t.Errorf("vector %q (%s): unparseable: %v", v.Addr, v.Note, err)
			continue
		}
		if got := Classify(addr).String(); got != v.Category {
			t.Errorf("Classify(%s) = %q, want %q (%s)", v.Addr, got, v.Category, v.Note)
		}
	}
}

func TestIsPublicAddressMatchesCorpus(t *testing.T) {
	for _, v := range loadVectors(t) {
		addr := netip.MustParseAddr(v.Addr)
		wantPublic := v.Category == "global"
		if got := IsPublicAddress(addr); got != wantPublic {
			t.Errorf("IsPublicAddress(%s) = %v, want %v (%s)", v.Addr, got, wantPublic, v.Note)
		}
	}
}

func TestBlockedHonoursBlockLocal(t *testing.T) {
	for _, v := range loadVectors(t) {
		addr := netip.MustParseAddr(v.Addr)

		// Metadata is refused whether or not local egress is permitted.
		if v.Category == "metadata" {
			if !Blocked(addr, false) || !Blocked(addr, true) {
				t.Errorf("Blocked(%s): metadata must be refused under both blockLocal values (%s)", v.Addr, v.Note)
			}
			continue
		}

		// Special ranges are refused only when local egress is disallowed.
		if v.Category == "special" {
			if Blocked(addr, false) {
				t.Errorf("Blocked(%s, blockLocal=false) = true, want false — special ranges are permitted when local egress is allowed (%s)", v.Addr, v.Note)
			}
			if !Blocked(addr, true) {
				t.Errorf("Blocked(%s, blockLocal=true) = false, want true (%s)", v.Addr, v.Note)
			}
			continue
		}

		// Global addresses are never refused.
		if Blocked(addr, false) || Blocked(addr, true) {
			t.Errorf("Blocked(%s): global address must never be refused (%s)", v.Addr, v.Note)
		}
	}
}

func TestInvalidAddressFailsClosed(t *testing.T) {
	var zero netip.Addr // invalid
	if Classify(zero) != CategorySpecial {
		t.Fatalf("Classify(invalid) = %v, want special — must fail closed", Classify(zero))
	}
	if IsPublicAddress(zero) {
		t.Fatal("IsPublicAddress(invalid) = true, want false — must fail closed")
	}
}
