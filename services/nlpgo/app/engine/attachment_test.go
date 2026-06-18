package engine

import (
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/langwatch/langwatch/services/nlpgo/app"
	"github.com/langwatch/langwatch/services/nlpgo/app/engine/blocks/httpblock"
	"github.com/langwatch/langwatch/services/nlpgo/app/engine/dsl"
)

// loopbackFetcher allows the httptest server (127.0.0.1) past the SSRF guard,
// which otherwise refuses loopback addresses.
func loopbackFetcher() *attachmentFetcher {
	return newAttachmentFetcher(httpblock.SSRFOptions{AllowedHosts: []string{"127.0.0.1"}})
}

// Minimal magic-byte prefixes so http.DetectContentType classifies the bodies
// without us shipping real media files.
var (
	pngBytes  = []byte("\x89PNG\r\n\x1a\n............")
	jpegBytes = []byte("\xff\xd8\xff\xe0............")
	pdfBytes  = []byte("%PDF-1.4\n............")
	mp3Bytes  = []byte("ID3............")
)

// attachmentServer serves a handful of fixed routes for the fetch tests.
func attachmentServer(t *testing.T) *httptest.Server {
	t.Helper()
	mux := http.NewServeMux()
	serve := func(ct string, body []byte) http.HandlerFunc {
		return func(w http.ResponseWriter, _ *http.Request) {
			if ct != "" {
				w.Header().Set("Content-Type", ct)
			}
			_, _ = w.Write(body)
		}
	}
	mux.HandleFunc("/cat.png", serve("image/png", pngBytes))
	mux.HandleFunc("/other.png", serve("image/png", pngBytes))
	// No file extension; the JPEG type comes from the response header only.
	mux.HandleFunc("/download", serve("image/jpeg", jpegBytes))
	// No file extension AND no Content-Type; the type is sniffed from bytes.
	mux.HandleFunc("/sniff", serve("", pngBytes))
	mux.HandleFunc("/page", serve("text/html; charset=utf-8", []byte("<html>hi</html>")))
	mux.HandleFunc("/clip.mp3", serve("audio/mpeg", mp3Bytes))
	mux.HandleFunc("/doc.pdf", serve("application/pdf", pdfBytes))
	mux.HandleFunc("/missing", func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusNotFound)
	})
	return httptest.NewServer(mux)
}

func userMessage(text string) []app.ChatMessage {
	return []app.ChatMessage{{Role: "user", Content: text}}
}

// imagePartMessage models an explicit image attachment (an image_url part
// carrying an http URL), the case that hard-fails on a bad fetch.
func imagePartMessage(url string) []app.ChatMessage {
	return []app.ChatMessage{{Role: "user", Content: []any{
		map[string]any{"type": "image_url", "image_url": map[string]any{"url": url}},
	}}}
}

// firstPartOfType returns the first content part of the given type from a
// rewritten message, failing the test if the content is not a parts list.
func firstPartOfType(t *testing.T, m app.ChatMessage, typ string) map[string]any {
	t.Helper()
	parts, ok := m.Content.([]any)
	require.True(t, ok, "content must be a parts list, got %T", m.Content)
	for _, p := range parts {
		block, ok := p.(map[string]any)
		if ok && block["type"] == typ {
			return block
		}
	}
	t.Fatalf("no %q part found in %#v", typ, parts)
	return nil
}

// @scenario "An image referenced by an http URL is fetched and delivered as an image part"
func TestRewriteFetchesHTTPImageIntoImagePart(t *testing.T) {
	srv := attachmentServer(t)
	defer srv.Close()
	f := loopbackFetcher()

	out, ne := f.rewrite(context.Background(), userMessage("What is in "+srv.URL+"/cat.png ?"))
	require.Nil(t, ne)
	require.Len(t, out, 1)

	img := firstPartOfType(t, out[0], "image_url")
	url, _ := img["image_url"].(map[string]any)["url"].(string)
	assert.True(t, strings.HasPrefix(url, "data:image/png;base64,"), "image must be inlined as a data URL, got %q", url)
	assert.NotContains(t, url, srv.URL, "the original link must not survive as the image URL")
}

// @scenario "The attachment type is detected from the response, not the file extension"
func TestRewriteDetectsTypeFromResponseNotExtension(t *testing.T) {
	srv := attachmentServer(t)
	defer srv.Close()
	f := loopbackFetcher()

	// Header-declared JPEG on an extension-less URL.
	out, ne := f.rewrite(context.Background(), userMessage(srv.URL+"/download"))
	require.Nil(t, ne)
	img := firstPartOfType(t, out[0], "image_url")
	url, _ := img["image_url"].(map[string]any)["url"].(string)
	assert.True(t, strings.HasPrefix(url, "data:image/jpeg;base64,"), "type must come from the response header, got %q", url)

	// No header at all: type sniffed from the bytes.
	out, ne = f.rewrite(context.Background(), userMessage(srv.URL+"/sniff"))
	require.Nil(t, ne)
	img = firstPartOfType(t, out[0], "image_url")
	url, _ = img["image_url"].(map[string]any)["url"].(string)
	assert.True(t, strings.HasPrefix(url, "data:image/png;base64,"), "type must be sniffed from the bytes, got %q", url)
}

// @scenario "An image already given as a base64 data URL is delivered without fetching"
func TestRewriteLeavesDataURLImagesWithoutFetching(t *testing.T) {
	// A data URL is not an http(s) URL, so it is never matched for fetching and
	// passes through untouched regardless of the SSRF policy.
	f := newAttachmentFetcher(httpblock.SSRFOptions{})
	dataURL := "data:image/png;base64,iVBORw0KGgo="

	// As a string (no http URL, so nothing to fetch).
	out, ne := f.rewrite(context.Background(), userMessage("Look at "+dataURL))
	require.Nil(t, ne)
	assert.Equal(t, "Look at "+dataURL, out[0].Content, "data-URL string must stay a string")

	// As an already-split image_url part.
	parts := []any{map[string]any{"type": "image_url", "image_url": map[string]any{"url": dataURL}}}
	out, ne = f.rewrite(context.Background(), []app.ChatMessage{{Role: "user", Content: parts}})
	require.Nil(t, ne)
	img := firstPartOfType(t, out[0], "image_url")
	assert.Equal(t, dataURL, img["image_url"].(map[string]any)["url"], "data-URL part must survive untouched")
}

// @scenario "Several attachment URLs in one message each become their own part"
func TestRewriteHandlesMultipleAttachmentURLs(t *testing.T) {
	srv := attachmentServer(t)
	defer srv.Close()
	f := loopbackFetcher()

	out, ne := f.rewrite(context.Background(), userMessage("First "+srv.URL+"/cat.png then "+srv.URL+"/other.png done"))
	require.Nil(t, ne)
	parts, ok := out[0].Content.([]any)
	require.True(t, ok)
	images := 0
	for _, p := range parts {
		if block, ok := p.(map[string]any); ok && block["type"] == "image_url" {
			images++
		}
	}
	assert.Equal(t, 2, images, "each URL must become its own image part")
}

// @scenario "An attachment URL in the system prompt is re-homed to a user message"
func TestRewriteRehomesSystemAttachmentToUser(t *testing.T) {
	srv := attachmentServer(t)
	defer srv.Close()
	f := loopbackFetcher()

	out, ne := f.rewrite(context.Background(), []app.ChatMessage{
		{Role: "system", Content: "You are a vision grader. Image: " + srv.URL + "/cat.png"},
	})
	require.Nil(t, ne)
	require.Len(t, out, 2, "the system message must split into system text + a user message")
	assert.Equal(t, "system", out[0].Role)
	assert.IsType(t, "", out[0].Content, "the system message keeps only the leading text")
	assert.Equal(t, "user", out[1].Role)
	firstPartOfType(t, out[1], "image_url") // the image rode into the user message
}

// @scenario "An unreachable attachment URL fails the run with a clear message naming the URL"
func TestRewriteFailsClearlyOnUnreachableURL(t *testing.T) {
	srv := attachmentServer(t)
	deadURL := srv.URL + "/cat.png"
	srv.Close() // nothing is listening now
	f := loopbackFetcher()

	out, ne := f.rewrite(context.Background(), imagePartMessage(deadURL))
	require.Nil(t, out)
	require.NotNil(t, ne)
	assert.Equal(t, "attachment_fetch_error", ne.Type)
	assert.Contains(t, ne.Message, deadURL, "the error must name the URL")
}

// @scenario "An attachment URL that responds with an error status fails the run clearly"
func TestRewriteFailsClearlyOnErrorStatus(t *testing.T) {
	srv := attachmentServer(t)
	defer srv.Close()
	f := loopbackFetcher()

	out, ne := f.rewrite(context.Background(), imagePartMessage(srv.URL+"/missing"))
	require.Nil(t, out)
	require.NotNil(t, ne)
	assert.Equal(t, "attachment_fetch_error", ne.Type)
	assert.Equal(t, http.StatusNotFound, ne.Status)
	assert.Contains(t, ne.Message, srv.URL+"/missing")
	assert.Contains(t, ne.Message, "404")
}

// @scenario "An attachment larger than the allowed size is rejected with a clear message"
func TestRewriteRejectsOversizedAttachment(t *testing.T) {
	big := strings.Repeat("x", 4096)
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "image/png")
		_, _ = w.Write([]byte(big))
	}))
	defer srv.Close()
	f := loopbackFetcher()
	f.maxBytes = 1024 // smaller than the body

	out, ne := f.rewrite(context.Background(), imagePartMessage(srv.URL+"/big.png"))
	require.Nil(t, out)
	require.NotNil(t, ne)
	assert.Equal(t, "attachment_fetch_error", ne.Type)
	assert.Contains(t, ne.Message, "larger than")
}

// @scenario "A link to a normal web page is left as text, not turned into an attachment"
func TestRewriteLeavesHTMLLinkAsText(t *testing.T) {
	srv := attachmentServer(t)
	defer srv.Close()
	f := loopbackFetcher()
	original := "See " + srv.URL + "/page for details"

	out, ne := f.rewrite(context.Background(), userMessage(original))
	require.Nil(t, ne)
	assert.Equal(t, original, out[0].Content, "a web page link must stay as text, not become an attachment")
}

// @scenario "A broken link in prose does not fail the run"
func TestRewriteLeavesBrokenBareLinkAsText(t *testing.T) {
	srv := attachmentServer(t)
	deadURL := srv.URL + "/cat.png"
	srv.Close() // nothing is listening now
	f := loopbackFetcher()
	original := "See " + deadURL + " for the chart"

	out, ne := f.rewrite(context.Background(), userMessage(original))
	require.Nil(t, ne, "a broken bare link in prose must not fail the run")
	assert.Equal(t, original, out[0].Content, "the broken link stays as text")
}

// @scenario "An attachment URL that redirects to a private address is refused"
func TestRewriteRefusesRedirectToPrivateAddress(t *testing.T) {
	// SafeDialer re-checks the SSRF policy at dial time, so a redirect from an
	// allowed host to a metadata/private address must still be blocked.
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		http.Redirect(w, r, "http://169.254.169.254/latest/meta-data", http.StatusFound)
	}))
	defer srv.Close()
	f := loopbackFetcher()

	out, ne := f.rewrite(context.Background(), imagePartMessage(srv.URL+"/redir.png"))
	require.Nil(t, out)
	require.NotNil(t, ne, "a redirect to a metadata address must be refused")
	assert.Equal(t, "attachment_fetch_error", ne.Type)
}

// @scenario "An audio attachment referenced by URL reaches the model as audio"
func TestRewriteFetchesAudioIntoAudioPart(t *testing.T) {
	srv := attachmentServer(t)
	defer srv.Close()
	f := loopbackFetcher()

	out, ne := f.rewrite(context.Background(), userMessage(srv.URL+"/clip.mp3"))
	require.Nil(t, ne)
	audio := firstPartOfType(t, out[0], "input_audio")
	data, _ := audio["input_audio"].(map[string]any)
	assert.Equal(t, "mp3", data["format"], "audio/mpeg must map to the mp3 format token providers expect")
	assert.NotEmpty(t, data["data"], "audio bytes must be base64-encoded")
}

// @scenario "A PDF attachment referenced by URL reaches the model as a document"
func TestRewriteFetchesPDFIntoFilePart(t *testing.T) {
	srv := attachmentServer(t)
	defer srv.Close()
	f := loopbackFetcher()

	out, ne := f.rewrite(context.Background(), userMessage(srv.URL+"/doc.pdf"))
	require.Nil(t, ne)
	file := firstPartOfType(t, out[0], "file")
	data, _ := file["file"].(map[string]any)
	fileData, _ := data["file_data"].(string)
	assert.True(t, strings.HasPrefix(fileData, "data:application/pdf;base64,"), "pdf must inline as a data URL, got %q", fileData)
}

// imageTypedNode builds a signature node declaring the given inputs, used to
// exercise the image-typed-input resolution that runs before message templating.
func imageTypedNode(fields ...dsl.Field) *dsl.Node {
	return &dsl.Node{ID: "sig", Type: dsl.ComponentSignature, Data: dsl.Component{Inputs: fields}}
}

// @scenario "An image-typed field whose URL is an image is fetched and inlined"
func TestInlineImageInputsResolvesRemoteImageToDataURL(t *testing.T) {
	srv := attachmentServer(t)
	defer srv.Close()
	f := loopbackFetcher()
	node := imageTypedNode(dsl.Field{Identifier: "picture", Type: dsl.FieldTypeImage})
	inputs := map[string]any{"picture": srv.URL + "/cat.png"}

	out, ne := f.inlineImageInputs(context.Background(), node, inputs)
	require.Nil(t, ne)
	got, _ := out["picture"].(string)
	assert.True(t, strings.HasPrefix(got, "data:image/png;base64,"),
		"the image-typed URL must inline as a data URL, got %q", got)
	assert.Equal(t, srv.URL+"/cat.png", inputs["picture"],
		"the original inputs map must keep the readable URL, not a base64 blob")
}

// @scenario "An image-typed field whose URL cannot be fetched fails the run with a clear error"
func TestInlineImageInputsFailsClearlyOnUnreachableImageURL(t *testing.T) {
	srv := attachmentServer(t)
	deadURL := srv.URL + "/cat.png"
	srv.Close() // nothing is listening now
	f := loopbackFetcher()
	node := imageTypedNode(dsl.Field{Identifier: "picture", Type: dsl.FieldTypeImage})

	out, ne := f.inlineImageInputs(context.Background(), node, map[string]any{"picture": deadURL})
	require.Nil(t, out)
	require.NotNil(t, ne, "an explicit image field with an unfetchable URL must fail the run")
	assert.Equal(t, "attachment_fetch_error", ne.Type)
	assert.Contains(t, ne.Message, deadURL, "the error must name the URL")
}

// @scenario "An image-typed field whose URL is not an image fails the run with a clear error"
func TestInlineImageInputsFailsClearlyWhenNotAnImage(t *testing.T) {
	srv := attachmentServer(t)
	defer srv.Close()
	f := loopbackFetcher()
	node := imageTypedNode(dsl.Field{Identifier: "picture", Type: dsl.FieldTypeImage})

	out, ne := f.inlineImageInputs(context.Background(), node, map[string]any{"picture": srv.URL + "/page"})
	require.Nil(t, out)
	require.NotNil(t, ne, "an image field pointing at a web page must fail the run")
	assert.Equal(t, "attachment_fetch_error", ne.Type)
	assert.Contains(t, ne.Message, "image", "the error must explain it could not be loaded as an image")
}

func TestInlineImageInputsLeavesDataURLAndTextInputsUntouched(t *testing.T) {
	f := loopbackFetcher()
	// picture is image-typed but already an inline data URL (no fetch needed);
	// link is str-typed and must not be eagerly fetched even though it is a URL.
	node := imageTypedNode(
		dsl.Field{Identifier: "picture", Type: dsl.FieldTypeImage},
		dsl.Field{Identifier: "link", Type: dsl.FieldTypeStr},
	)
	inputs := map[string]any{
		"picture": "data:image/png;base64,AAAA",
		"link":    "http://127.0.0.1:1/skip.png",
	}
	out, ne := f.inlineImageInputs(context.Background(), node, inputs)
	require.Nil(t, ne)
	assert.Equal(t, "data:image/png;base64,AAAA", out["picture"], "an inline data URL must pass through untouched")
	assert.Equal(t, "http://127.0.0.1:1/skip.png", out["link"], "a str-typed URL must not be eagerly fetched")
}

func TestNormalizeMediaType(t *testing.T) {
	assert.Equal(t, "image/png", normalizeMediaType("image/png"))
	assert.Equal(t, "image/jpeg", normalizeMediaType("IMAGE/JPEG; charset=binary"))
	assert.Equal(t, "text/html", normalizeMediaType("text/html;charset=utf-8"))
	assert.Empty(t, normalizeMediaType(""))
}

func TestTrimTrailingPunct(t *testing.T) {
	url, trailing := trimTrailingPunct("https://x/cat.png.")
	assert.Equal(t, "https://x/cat.png", url)
	assert.Equal(t, ".", trailing)

	url, trailing = trimTrailingPunct("https://x/cat.png")
	assert.Equal(t, "https://x/cat.png", url)
	assert.Empty(t, trailing)
}
