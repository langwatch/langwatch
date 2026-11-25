package domain

import (
	"encoding/base64"
	"fmt"
	"io"
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

// ValidateTurnImages checks the count, media type and payload of each image.
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
		decoder := base64.NewDecoder(base64.StdEncoding, strings.NewReader(img.Data))
		n, err := io.Copy(io.Discard, io.LimitReader(decoder, MaxTurnImageBytes+1))
		if err != nil {
			return fmt.Sprintf("images[%d]: data is not valid base64", i)
		}
		if n > MaxTurnImageBytes {
			return fmt.Sprintf("images[%d]: larger than %d bytes", i, MaxTurnImageBytes)
		}
	}
	return ""
}
