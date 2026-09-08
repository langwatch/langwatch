package engine

import (
	"strings"
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
func TestSplitMessagesWithAttachmentsSplitsTextImageText(t *testing.T) {
	msgs := splitMessagesWithAttachments([]app.ChatMessage{
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
func TestSplitMessagesWithAttachmentsMatchesUppercaseBase64(t *testing.T) {
	upper := "DATA:IMAGE/PNG;BASE64,iVBORw0KGgo="
	msgs := splitMessagesWithAttachments([]app.ChatMessage{
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
func TestSplitMessagesWithAttachmentsHandlesMultipleImages(t *testing.T) {
	msgs := splitMessagesWithAttachments([]app.ChatMessage{
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
func TestSplitMessagesWithAttachmentsLeavesPlainTextAlone(t *testing.T) {
	in := []app.ChatMessage{
		{Role: "system", Content: "You count products."},
		{Role: "user", Content: "How many?"},
	}
	out := splitMessagesWithAttachments(in)
	require.Len(t, out, 2)
	assert.Equal(t, "You count products.", out[0].Content)
	assert.Equal(t, "How many?", out[1].Content)
}

// @scenario "An image interpolated into the system prompt moves to a user message"
func TestSplitMessagesWithAttachmentsRehomesSystemImageIntoUserMessage(t *testing.T) {
	msgs := splitMessagesWithAttachments([]app.ChatMessage{
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
func TestSplitMessagesWithAttachmentsDropsEmptyTextBetweenImages(t *testing.T) {
	msgs := splitMessagesWithAttachments([]app.ChatMessage{
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

const (
	pdfPayload = "JVBERi0xLjQKaGVsbG8="
	wavPayload = "UklGRi4uLi5XQVZFZm10IA=="
	csvPayload = "bmFtZSxhbW91bnQKYWNtZSwxMAo="
	// Bytes that are not valid UTF-8, used to check the text guard.
	nonUTF8Payload = "//76+w=="
	binaryPayload  = "AAECAw=="
)

// contentParts asserts a message became a parts list and returns it.
func contentParts(t *testing.T, m app.ChatMessage) []any {
	t.Helper()
	parts, ok := m.Content.([]any)
	require.True(t, ok, "content must become a parts list, got %T", m.Content)
	return parts
}

// onlyPartOfType returns the single part of the given type in a parts list.
func onlyPartOfType(t *testing.T, parts []any, want string) map[string]any {
	t.Helper()
	var found map[string]any
	for _, p := range parts {
		if typ, block := partType(t, p); typ == want {
			require.Nil(t, found, "expected exactly one %q part", want)
			found = block
		}
	}
	require.NotNil(t, found, "no %q part in %v", want, parts)
	return found
}

// @scenario "A PDF data URL in a message becomes a file part with its file name"
func TestSplitMessagesWithAttachmentsBuildsFilePartForPDF(t *testing.T) {
	url := "data:application/pdf;name=quarterly-report.pdf;base64," + pdfPayload
	msgs := splitMessagesWithAttachments([]app.ChatMessage{
		{Role: "user", Content: "Read this: " + url + " and summarize it."},
	})
	require.Len(t, msgs, 1)
	parts := contentParts(t, msgs[0])
	require.Len(t, parts, 3)

	block := onlyPartOfType(t, parts, "file")
	file, _ := block["file"].(map[string]any)
	assert.Equal(t, "quarterly-report.pdf", file["filename"])
	assert.Equal(t, "data:application/pdf;base64,"+pdfPayload, file["file_data"],
		"the name travels in the filename field, so the data URL drops the parameter")
}

// @scenario "An audio data URL becomes an input_audio part"
func TestSplitMessagesWithAttachmentsBuildsAudioPart(t *testing.T) {
	msgs := splitMessagesWithAttachments([]app.ChatMessage{
		{Role: "user", Content: "Listen: data:audio/wav;name=call.wav;base64," + wavPayload},
	})
	block := onlyPartOfType(t, contentParts(t, msgs[0]), "input_audio")
	audio, _ := block["input_audio"].(map[string]any)
	assert.Equal(t, wavPayload, audio["data"], "the audio part carries the bare base64 payload")
	assert.Equal(t, "wav", audio["format"])
}

// @scenario "A text file data URL is delivered as text with its file name"
func TestSplitMessagesWithAttachmentsInlinesTextFile(t *testing.T) {
	msgs := splitMessagesWithAttachments([]app.ChatMessage{
		{Role: "user", Content: "Totals: data:text/csv;name=sales.csv;base64," + csvPayload},
	})
	parts := contentParts(t, msgs[0])
	for _, p := range parts {
		typ, _ := partType(t, p)
		assert.Equal(t, "text", typ, "a text document needs no attachment part")
	}
	_, block := partType(t, parts[len(parts)-1])
	text, _ := block["text"].(string)
	assert.True(t, strings.HasPrefix(text, "sales.csv\n\n"), "the file name heads the text, got %q", text)
	assert.Contains(t, text, "acme,10", "the decoded file content must reach the model")
}

// @scenario "A text file with bytes that are not valid text is delivered as a file part"
func TestSplitMessagesWithAttachmentsFallsBackToFileForInvalidText(t *testing.T) {
	msgs := splitMessagesWithAttachments([]app.ChatMessage{
		{Role: "user", Content: "data:text/plain;name=broken.txt;base64," + nonUTF8Payload},
	})
	block := onlyPartOfType(t, contentParts(t, msgs[0]), "file")
	file, _ := block["file"].(map[string]any)
	assert.Equal(t, "broken.txt", file["filename"])
}

// @scenario "An unknown binary type is delivered as a file part"
func TestSplitMessagesWithAttachmentsBuildsFilePartForUnknownType(t *testing.T) {
	msgs := splitMessagesWithAttachments([]app.ChatMessage{
		{Role: "user", Content: "data:application/octet-stream;name=raw%20dump.bin;base64," + binaryPayload},
	})
	block := onlyPartOfType(t, contentParts(t, msgs[0]), "file")
	file, _ := block["file"].(map[string]any)
	assert.Equal(t, "raw dump.bin", file["filename"], "the name parameter is url-encoded")
	assert.Equal(t, "data:application/octet-stream;base64,"+binaryPayload, file["file_data"])
}

// @scenario "A data URL with no name gets a name from its media type"
func TestSplitMessagesWithAttachmentsNamesUnnamedAttachments(t *testing.T) {
	tests := []struct {
		name     string
		dataURL  string
		wantName string
	}{
		{"pdf", "data:application/pdf;base64," + pdfPayload, "attachment.pdf"},
		{"unknown type", "data:application/x-thing;base64," + binaryPayload, "attachment.bin"},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			msgs := splitMessagesWithAttachments([]app.ChatMessage{{Role: "user", Content: tt.dataURL}})
			block := onlyPartOfType(t, contentParts(t, msgs[0]), "file")
			file, _ := block["file"].(map[string]any)
			assert.Equal(t, tt.wantName, file["filename"])
		})
	}
}

// @scenario "An image data URL still becomes an image part"
func TestSplitMessagesWithAttachmentsDropsNameParameterFromImages(t *testing.T) {
	msgs := splitMessagesWithAttachments([]app.ChatMessage{
		{Role: "user", Content: "data:image/png;name=cat.png;base64,iVBORw0KGgoAAAANSUhEUg=="},
	})
	block := onlyPartOfType(t, contentParts(t, msgs[0]), "image_url")
	img, _ := block["image_url"].(map[string]any)
	assert.Equal(t, "data:image/png;base64,iVBORw0KGgoAAAANSUhEUg==", img["url"],
		"providers parse the data URL themselves, so only the plain form is portable")
}

// @scenario "A system message carrying a file is split so the file rides in a user message"
func TestSplitMessagesWithAttachmentsRehomesSystemFileIntoUserMessage(t *testing.T) {
	msgs := splitMessagesWithAttachments([]app.ChatMessage{
		{Role: "system", Content: "You read reports.\n\nReport: data:application/pdf;name=q3.pdf;base64," + pdfPayload},
	})
	require.Len(t, msgs, 2, "system text + re-homed user message")

	assert.Equal(t, "system", msgs[0].Role)
	sys, ok := msgs[0].Content.(string)
	require.True(t, ok, "the system prompt stays a plain string")
	assert.Contains(t, sys, "You read reports.")
	assert.NotContains(t, sys, "base64", "no attachment bytes left in the system prompt")

	assert.Equal(t, "user", msgs[1].Role)
	block := onlyPartOfType(t, contentParts(t, msgs[1]), "file")
	file, _ := block["file"].(map[string]any)
	assert.Equal(t, "q3.pdf", file["filename"])
}

func TestSplitMessagesWithAttachmentsKeepsSystemTextFileInTheInstructions(t *testing.T) {
	// Every part is text, so there is nothing a provider refuses in a system
	// message and the instructions stay one plain string.
	msgs := splitMessagesWithAttachments([]app.ChatMessage{
		{Role: "system", Content: "Use this table: data:text/csv;name=sales.csv;base64," + csvPayload},
	})
	require.Len(t, msgs, 1)
	assert.Equal(t, "system", msgs[0].Role)
	sys, ok := msgs[0].Content.(string)
	require.True(t, ok)
	assert.Contains(t, sys, "acme,10")
}
