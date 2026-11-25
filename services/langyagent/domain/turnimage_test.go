package domain

import (
	"encoding/base64"
	"strings"
	"testing"
)

func TestValidateTurnImages_AcceptsEverySupportedMediaType(t *testing.T) {
	for _, mediaType := range []string{"image/png", "image/jpeg", "image/gif", "image/webp"} {
		if msg := ValidateTurnImages([]TurnImage{{MediaType: mediaType, Data: "iVBORw0KGgo="}}); msg != "" {
			t.Errorf("%s: got %q, want valid", mediaType, msg)
		}
	}
	if msg := ValidateTurnImages(nil); msg != "" {
		t.Errorf("no images: got %q, want valid", msg)
	}
}

// @scenario "A turn whose images break the limits is refused before it reaches a worker"
func TestValidateTurnImages_SizeCap(t *testing.T) {
	atCap := base64.StdEncoding.EncodeToString(make([]byte, MaxTurnImageBytes))
	if msg := ValidateTurnImages([]TurnImage{{MediaType: "image/webp", Data: atCap}}); msg != "" {
		t.Fatalf("an image at MaxTurnImageBytes must pass, got %q", msg)
	}
	over := base64.StdEncoding.EncodeToString(make([]byte, MaxTurnImageBytes+1))
	if msg := ValidateTurnImages([]TurnImage{{MediaType: "image/jpeg", Data: over}}); msg == "" {
		t.Fatal("an image over MaxTurnImageBytes must be rejected")
	}
}

func TestValidateTurnImages_MessageNeverEchoesData(t *testing.T) {
	data := "secret-looking-payload!"
	msg := ValidateTurnImages([]TurnImage{{MediaType: "image/png", Data: data}})
	if msg == "" || strings.Contains(msg, data) {
		t.Fatalf("message = %q, want a rejection that does not echo the data", msg)
	}
}
