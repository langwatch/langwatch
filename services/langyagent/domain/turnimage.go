package domain

import (
	"bufio"
	"encoding/base64"
	"errors"
	"fmt"
	"io"
	"net/http"
	"strings"
)

// TurnImage is one image the user attached to a chat turn. Data is the raw
// base64 payload with no data: URL prefix. It is never logged.
type TurnImage struct {
	Name      string `json:"name,omitempty"`
	MediaType string `json:"mediaType"`
	Data      string `json:"data"`
}

// Limits on the images one turn may carry. The turn body cap
// (config.go defaultMaxBodyBytes) is sized so a turn at these limits fits.
const (
	MaxTurnImages     = 4
	MaxTurnImageBytes = 5 << 20
)

var turnImageMediaTypes = map[string]bool{
	"image/png":  true,
	"image/jpeg": true,
	"image/gif":  true,
	"image/webp": true,
}

// sniffBytes is how much of an image http.DetectContentType reads.
const sniffBytes = 512

// ValidateTurnImages checks the count, media type and payload of each image,
// and that the decoded bytes are an image of the declared media type.
// It returns a message safe to show the caller, or "" when every image is
// valid. The message names an image by position, never by its data.
func ValidateTurnImages(images []TurnImage) string {
	if len(images) > MaxTurnImages {
		return fmt.Sprintf("at most %d images per turn", MaxTurnImages)
	}
	for i, img := range images {
		if !turnImageMediaTypes[img.MediaType] {
			return fmt.Sprintf("images[%d]: unsupported mediaType", i)
		}
		if img.Data == "" {
			return fmt.Sprintf("images[%d]: data is empty", i)
		}
		if msg := validateTurnImageData(i, img); msg != "" {
			return msg
		}
	}
	return ""
}

func validateTurnImageData(i int, img TurnImage) string {
	decoded := bufio.NewReaderSize(
		base64.NewDecoder(base64.StdEncoding, strings.NewReader(img.Data)), sniffBytes)
	head, err := decoded.Peek(sniffBytes)
	if err != nil && !errors.Is(err, io.EOF) {
		return fmt.Sprintf("images[%d]: data is not valid base64", i)
	}
	// Peek's slice is the reader's buffer, which the drain below can refill.
	head = append([]byte(nil), head...)
	n, err := io.Copy(io.Discard, io.LimitReader(decoded, MaxTurnImageBytes+1))
	if err != nil {
		return fmt.Sprintf("images[%d]: data is not valid base64", i)
	}
	if n > MaxTurnImageBytes {
		return fmt.Sprintf("images[%d]: larger than %d bytes", i, MaxTurnImageBytes)
	}
	if http.DetectContentType(head) != img.MediaType {
		return fmt.Sprintf("images[%d]: data is not a %s image", i, img.MediaType)
	}
	return ""
}
