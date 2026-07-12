package frameauth

import (
	"encoding/json"
	"os"
	"path/filepath"
	"testing"
)

// The authenticated frame contract is a security boundary AND a cross-language
// one: this Go package signs, the TS relay verifies. These tests assert the
// exact MACs from specs/langy/langy-frame-auth.vectors.json — the same file the
// TS suite asserts — so Go and TS can never silently diverge.

type vector struct {
	Name           string `json:"name"`
	RunToken       string `json:"runToken"`
	ProjectID      string `json:"projectId"`
	UserID         string `json:"userId"`
	ConversationID string `json:"conversationId"`
	TurnID         string `json:"turnId"`
	FrameNonce     string `json:"frameNonce"`
	Payload        string `json:"payload"`
	MAC            string `json:"mac"`
}

func (v vector) signed() Signed {
	return Signed{
		Identity: Identity{
			ProjectID:      v.ProjectID,
			UserID:         v.UserID,
			ConversationID: v.ConversationID,
			TurnID:         v.TurnID,
		},
		FrameNonce: v.FrameNonce,
		Payload:    v.Payload,
	}
}

type vectorsFile struct {
	Vectors    []vector `json:"vectors"`
	FieldShift struct {
		RunToken string `json:"runToken"`
		A        vector `json:"a"`
		B        vector `json:"b"`
	} `json:"fieldShift"`
}

func loadVectors(t *testing.T) vectorsFile {
	t.Helper()
	// The package dir is services/langyagent/internal/frameauth; the shared vector
	// file lives at repo-root specs/langy — four levels up.
	path := filepath.Join("..", "..", "..", "..", "specs", "langy", "langy-frame-auth.vectors.json")
	raw, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("read vectors: %v", err)
	}
	var vf vectorsFile
	if err := json.Unmarshal(raw, &vf); err != nil {
		t.Fatalf("decode vectors: %v", err)
	}
	if len(vf.Vectors) == 0 {
		t.Fatal("no vectors loaded")
	}
	return vf
}

func TestComputeMAC_MatchesCrossLanguageVectors(t *testing.T) {
	vf := loadVectors(t)
	for _, v := range vf.Vectors {
		v := v
		t.Run(v.Name, func(t *testing.T) {
			got, err := ComputeMAC(v.RunToken, v.signed())
			if err != nil {
				t.Fatalf("ComputeMAC: %v", err)
			}
			if got != v.MAC {
				t.Fatalf("mac mismatch (Go != oracle):\n  got  %s\n  want %s", got, v.MAC)
			}
		})
	}
}

func TestComputeMAC_LengthPrefixingIsUnambiguous(t *testing.T) {
	vf := loadVectors(t)
	rt := vf.FieldShift.RunToken
	// ("ab","c") and ("a","bc") concatenate identically but must not collide.
	aMAC, err := ComputeMAC(rt, vf.FieldShift.A.signed())
	if err != nil {
		t.Fatal(err)
	}
	bMAC, err := ComputeMAC(rt, vf.FieldShift.B.signed())
	if err != nil {
		t.Fatal(err)
	}
	if aMAC != vf.FieldShift.A.MAC {
		t.Fatalf("fieldShift.a mac mismatch:\n  got  %s\n  want %s", aMAC, vf.FieldShift.A.MAC)
	}
	if bMAC != vf.FieldShift.B.MAC {
		t.Fatalf("fieldShift.b mac mismatch:\n  got  %s\n  want %s", bMAC, vf.FieldShift.B.MAC)
	}
	if aMAC == bMAC {
		t.Fatal("length-prefixing failed: shifted-boundary tuples collided")
	}
}

func TestSignVerify_RoundTripsAndRejectsTampering(t *testing.T) {
	vf := loadVectors(t)
	rt := vf.Vectors[0].RunToken
	id := vf.Vectors[0].signed().Identity

	env, err := Sign(rt, id, `{"type":"delta","text":"hi"}`)
	if err != nil {
		t.Fatalf("Sign: %v", err)
	}
	if !Verify(rt, env) {
		t.Fatal("freshly signed frame failed to verify")
	}

	// A fresh nonce per frame ⇒ replay of one frame can't masquerade as another.
	env2, err := Sign(rt, id, `{"type":"delta","text":"hi"}`)
	if err != nil {
		t.Fatal(err)
	}
	if env.FrameNonce == env2.FrameNonce || env.MAC == env2.MAC {
		t.Fatal("expected a unique nonce and mac per frame")
	}

	t.Run("tampered payload fails", func(t *testing.T) {
		bad := env
		bad.Payload = `{"type":"delta","text":"HACKED"}`
		if Verify(rt, bad) {
			t.Fatal("tampered payload verified")
		}
	})

	t.Run("tampered identity fails", func(t *testing.T) {
		bad := env
		bad.ConversationID += "x"
		if Verify(rt, bad) {
			t.Fatal("tampered conversationId verified")
		}
	})

	t.Run("wrong runToken fails", func(t *testing.T) {
		other, err := MintRunToken()
		if err != nil {
			t.Fatal(err)
		}
		if Verify(other, env) {
			t.Fatal("verified under the wrong runToken")
		}
	})

	t.Run("malformed mac returns false, never panics", func(t *testing.T) {
		for _, bad := range []string{"", "abcd", "zz", "a"} {
			e := env
			e.MAC = bad
			if Verify(rt, e) {
				t.Fatalf("malformed mac %q verified", bad)
			}
		}
	})
}

func TestMintRunToken_And_NewFrameNonce(t *testing.T) {
	rt1, err := MintRunToken()
	if err != nil {
		t.Fatal(err)
	}
	rt2, _ := MintRunToken()
	if len(rt1) != 64 || rt1 == rt2 {
		t.Fatalf("runToken want 64 hex chars, unique; got len=%d equal=%v", len(rt1), rt1 == rt2)
	}
	n1, _ := NewFrameNonce()
	n2, _ := NewFrameNonce()
	if len(n1) != 32 || n1 == n2 {
		t.Fatalf("frameNonce want 32 hex chars, unique; got len=%d equal=%v", len(n1), n1 == n2)
	}
}
