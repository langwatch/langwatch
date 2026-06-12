package engine

import (
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/langwatch/langwatch/services/nlpgo/app"
)

const (
	jpegURL = "data:image/jpeg;base64,/9j/4AAQSkZJRg=="
	pngURL  = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUg=="
)

func partType(t *testing.T, p any) (string, map[string]any) {
	t.Helper()
	block, ok := p.(map[string]any)
	require.True(t, ok, "part must be a map, got %T", p)
	typ, _ := block["type"].(string)
	return typ, block
}

// @scenario "A message with an image in the middle becomes text and image parts"
func TestSplitMessagesWithImagesSplitsTextImageText(t *testing.T) {
	msgs := splitMessagesWithImages([]app.ChatMessage{
		{Role: "user", Content: "How many products?\n\nTote image: " + jpegURL + "\n\nAnswer with one integer."},
	})
	require.Len(t, msgs, 1)
	parts, ok := msgs[0].Content.([]any)
	require.True(t, ok, "content must become a parts list")
	require.Len(t, parts, 3)

	typ, block := partType(t, parts[0])
	assert.Equal(t, "text", typ)
	assert.Contains(t, block["text"], "How many products?")

	typ, block = partType(t, parts[1])
	assert.Equal(t, "image_url", typ)
	img, _ := block["image_url"].(map[string]any)
	assert.Equal(t, jpegURL, img["url"], "the data URL must survive untouched")

	typ, block = partType(t, parts[2])
	assert.Equal(t, "text", typ)
	assert.Contains(t, block["text"], "Answer with one integer.")
}

// @scenario "An uppercase BASE64 data URL is split into image parts"
// Fully uppercase, scheme included: RFC 2397 is case-insensitive end to
// end, and the pass-through gate must not filter these out before the
// case-insensitive regex sees them.
func TestSplitMessagesWithImagesMatchesUppercaseBase64(t *testing.T) {
	upper := "DATA:IMAGE/PNG;BASE64,iVBORw0KGgo="
	msgs := splitMessagesWithImages([]app.ChatMessage{
		{Role: "user", Content: "Before " + upper + " after."},
	})
	parts, ok := msgs[0].Content.([]any)
	require.True(t, ok, "uppercase data URL must still split into parts")
	require.Len(t, parts, 3)
	typ, block := partType(t, parts[1])
	require.Equal(t, "image_url", typ)
	img, _ := block["image_url"].(map[string]any)
	assert.Equal(t, upper, img["url"])
}

// @scenario "Multiple images in one message each become their own image part"
func TestSplitMessagesWithImagesHandlesMultipleImages(t *testing.T) {
	msgs := splitMessagesWithImages([]app.ChatMessage{
		{Role: "user", Content: "Tote: " + jpegURL + " Reference: " + pngURL + " Count them."},
	})
	parts, ok := msgs[0].Content.([]any)
	require.True(t, ok)
	require.Len(t, parts, 5)
	var urls []string
	for _, p := range parts {
		if typ, block := partType(t, p); typ == "image_url" {
			img, _ := block["image_url"].(map[string]any)
			urls = append(urls, img["url"].(string))
		}
	}
	assert.Equal(t, []string{jpegURL, pngURL}, urls, "both images, original order")
}

// @scenario "Messages without images are left untouched"
func TestSplitMessagesWithImagesLeavesPlainTextAlone(t *testing.T) {
	in := []app.ChatMessage{
		{Role: "system", Content: "You count products."},
		{Role: "user", Content: "How many?"},
	}
	out := splitMessagesWithImages(in)
	require.Len(t, out, 2)
	assert.Equal(t, "You count products.", out[0].Content)
	assert.Equal(t, "How many?", out[1].Content)
}

// @scenario "An image interpolated into the system prompt moves to a user message"
func TestSplitMessagesWithImagesRehomesSystemImageIntoUserMessage(t *testing.T) {
	msgs := splitMessagesWithImages([]app.ChatMessage{
		{Role: "system", Content: "You are a counting system.\n\nTote image: " + jpegURL + "\n\nRespond with one integer."},
	})
	require.Len(t, msgs, 2, "system text + re-homed user message")

	assert.Equal(t, "system", msgs[0].Role)
	sys, ok := msgs[0].Content.(string)
	require.True(t, ok, "system prompt stays a plain string")
	assert.Contains(t, sys, "You are a counting system.")
	assert.NotContains(t, sys, "data:image/", "no image bytes left in the system prompt")

	assert.Equal(t, "user", msgs[1].Role)
	parts, ok := msgs[1].Content.([]any)
	require.True(t, ok)
	typ, block := partType(t, parts[0])
	require.Equal(t, "image_url", typ)
	img, _ := block["image_url"].(map[string]any)
	assert.Equal(t, jpegURL, img["url"])
	typ, block = partType(t, parts[1])
	assert.Equal(t, "text", typ)
	assert.Contains(t, block["text"], "Respond with one integer.")
}

// @scenario "Adjacent images produce no empty text parts"
func TestSplitMessagesWithImagesDropsEmptyTextBetweenImages(t *testing.T) {
	msgs := splitMessagesWithImages([]app.ChatMessage{
		{Role: "user", Content: jpegURL + "\n" + pngURL},
	})
	parts, ok := msgs[0].Content.([]any)
	require.True(t, ok)
	require.Len(t, parts, 2, "exactly the two image parts, no whitespace text parts")
	for _, p := range parts {
		typ, _ := partType(t, p)
		assert.Equal(t, "image_url", typ)
	}
}
