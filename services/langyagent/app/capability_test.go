package app

import (
	"reflect"
	"testing"
)

type stubCap struct {
	key string
	env []string
}

func (stubCap) Name() string           { return "stub" }
func (c stubCap) Contribute() []string { return c.env }
func (c stubCap) SignatureKey() string { return c.key }

// SignatureKeys is the capability set's signature contribution: the ACTIVE keys,
// sorted, with inert ("") capabilities dropped — so two capability sets that
// differ only in order or in an inert member fingerprint identically.
func TestSignatureKeys(t *testing.T) {
	caps := []Capability{
		stubCap{key: "b"},
		stubCap{key: ""}, // inert — dropped
		stubCap{key: "a"},
	}
	if got := SignatureKeys(caps); !reflect.DeepEqual(got, []string{"a", "b"}) {
		t.Errorf("SignatureKeys = %v, want [a b] (sorted, inert dropped)", got)
	}
	if got := SignatureKeys(nil); len(got) != 0 {
		t.Errorf("SignatureKeys(nil) = %v, want empty", got)
	}
}
