package fuzz

import "testing"

func TestGroupFindingsCollapsesBySignatureAndSortsByCount(t *testing.T) {
	findings := []Finding{
		{Signature: "5xx :: GET /a :: 500", Message: "a"},
		{Signature: "5xx :: GET /a :: 500", Message: "a"},
		{Signature: "latency :: GET /b :: 200", Message: "b"},
	}
	groups := GroupFindings(findings)
	if len(groups) != 2 {
		t.Fatalf("want 2 groups, got %d", len(groups))
	}
	if groups[0].Signature != "5xx :: GET /a :: 500" || groups[0].Count != 2 {
		t.Fatalf("worst-first grouping wrong: %+v", groups[0])
	}
	if groups[1].Count != 1 {
		t.Fatalf("second group count wrong: %+v", groups[1])
	}
}

func TestSignatureOfIsStable(t *testing.T) {
	if signatureOf("5xx", "POST", "/api/x", 500) != signatureOf("5xx", "POST", "/api/x", 500) {
		t.Fatal("signatureOf not stable")
	}
	if signatureOf("5xx", "POST", "/api/x", 500) == signatureOf("5xx", "POST", "/api/y", 500) {
		t.Fatal("different routes share a signature")
	}
}
