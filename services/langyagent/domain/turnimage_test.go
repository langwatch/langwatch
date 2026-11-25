package domain

import (
	"encoding/base64"
	"strings"
	"testing"
)

// The leading bytes each supported format starts with.
var imageHeads = map[string][]byte{
	"image/png":  []byte("\x89PNG\r\n\x1a\n"),
	"image/jpeg": {0xFF, 0xD8, 0xFF, 0xE0},
	"image/gif":  []byte("GIF89a"),
	"image/webp": []byte("RIFF\x00\x00\x00\x00WEBPVP8 "),
}

func imageData(mediaType string, size int) string {
	data := make([]byte, size)
	copy(data, imageHeads[mediaType])
	return base64.StdEncoding.EncodeToString(data)
}

func TestValidateTurnImages_AcceptsEverySupportedMediaType(t *testing.T) {
	for mediaType := range imageHeads {
		if msg := ValidateTurnImages([]TurnImage{{MediaType: mediaType, Data: imageData(mediaType, 64)}}); msg != "" {
			t.Errorf("%s: got %q, want valid", mediaType, msg)
		}
	}
	if msg := ValidateTurnImages(nil); msg != "" {
		t.Errorf("no images: got %q, want valid", msg)
	}
}

// @scenario "A turn whose images break the limits is refused before it reaches a worker"
func TestValidateTurnImages_SizeCap(t *testing.T) {
	atCap := imageData("image/webp", MaxTurnImageBytes)
	if msg := ValidateTurnImages([]TurnImage{{MediaType: "image/webp", Data: atCap}}); msg != "" {
		t.Fatalf("an image at MaxTurnImageBytes must pass, got %q", msg)
	}
	over := imageData("image/jpeg", MaxTurnImageBytes+1)
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

func TestValidateTurnImages_RefusesBytesThatAreNotTheDeclaredImage(t *testing.T) {
	hello := base64.StdEncoding.EncodeToString([]byte("hello"))
	if msg := ValidateTurnImages([]TurnImage{{MediaType: "image/png", Data: hello}}); msg != "images[0]: data is not a image/png image" {
		t.Fatalf("text declared as PNG: got %q", msg)
	}
	gif := imageData("image/gif", 64)
	if msg := ValidateTurnImages([]TurnImage{{MediaType: "image/png", Data: gif}}); msg == "" {
		t.Fatal("a GIF declared as PNG must be rejected")
	}
}

func TestValidateTurnImages_ChecksTheHeaderOfAnImageNearTheSizeCap(t *testing.T) {
	data := make([]byte, MaxTurnImageBytes-256)
	for i := range data {
		data[i] = 'a'
	}
	copy(data, imageHeads["image/png"])
	encoded := base64.StdEncoding.EncodeToString(data)
	var wrapped strings.Builder
	for start := 0; start < len(encoded); start += 76 {
		wrapped.WriteString(encoded[start:min(start+76, len(encoded))])
		wrapped.WriteString("\n")
	}
	images := []TurnImage{{MediaType: "image/png", Data: wrapped.String()}}
	if msg := ValidateTurnImages(images); msg != "" {
		t.Fatalf("a PNG just under the size cap was refused: %s", msg)
	}
}
