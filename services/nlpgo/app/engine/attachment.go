package engine

import (
	"context"
	"encoding/base64"
	"errors"
	"fmt"
	"io"
	"mime"
	"net/http"
	"net/url"
	"path"
	"regexp"
	"strings"
	"time"

	"github.com/langwatch/langwatch/services/nlpgo/app"
	"github.com/langwatch/langwatch/services/nlpgo/app/engine/blocks/httpblock"
	"github.com/langwatch/langwatch/services/nlpgo/app/engine/dsl"
)

// Attachment fetching turns a remote URL referenced in a prompt message into
// content the model can actually see/hear/read. The data-URL image splitter in
// multimodal.go only handles inline data:image/...;base64 values; a plain
// http(s) URL is interpolated as text and the model never opens it. This pass
// fetches such URLs, detects the type from the response (not the file
// extension, so extension-less S3/CDN URLs work), and re-homes them into
// multimodal content parts. Images become base64 data-URL image parts so they
// work across every provider regardless of whether the provider fetches URLs
// itself; audio and documents get their own part shapes. A reachable response
// that is not an attachment (an HTML page) is left as text — the author was
// referencing a link, not attaching a file. A URL that cannot be fetched fails
// the run with a clear, user-facing error rather than a broken request.

const (
	// defaultMaxAttachmentBytes caps a single fetched attachment. Large enough
	// for real photos/audio/PDFs, small enough to refuse a runaway download.
	defaultMaxAttachmentBytes int64 = 20 * 1024 * 1024
	// defaultAttachmentTimeout bounds the whole fetch (connect + read).
	defaultAttachmentTimeout = 30 * time.Second
)

// httpURLRe matches an http(s) URL token: the scheme followed by a run of
// non-space characters that are not URL-hostile delimiters. Trailing
// sentence punctuation is trimmed separately so "see https://x/cat.png." does
// not carry the period into the request.
var httpURLRe = regexp.MustCompile("https?://[^\\s<>\"'`]+")

// attachmentFetcher fetches remote attachment URLs and rewrites them into
// content parts. It applies the same SSRF policy as the HTTP block (private,
// loopback, and cloud-metadata addresses are refused, with DNS-rebinding
// protection via SafeDialer), a wall-clock timeout, and a size cap.
type attachmentFetcher struct {
	client   *http.Client
	ssrf     httpblock.SSRFOptions
	maxBytes int64
}

func newAttachmentFetcher(ssrf httpblock.SSRFOptions) *attachmentFetcher {
	// Clone the default transport so standard settings (notably
	// Proxy: http.ProxyFromEnvironment) are inherited, then only override the
	// dialer to re-apply the SSRF policy at dial time — the same construction the
	// HTTP block uses, so attachment fetches work in restricted-egress
	// deployments that require an outbound proxy.
	transport := http.DefaultTransport.(*http.Transport).Clone()
	transport.DialContext = httpblock.SafeDialer(ssrf)
	return &attachmentFetcher{
		client: &http.Client{
			Timeout:   defaultAttachmentTimeout,
			Transport: transport,
		},
		ssrf:     ssrf,
		maxBytes: defaultMaxAttachmentBytes,
	}
}

// fetchedAttachment is the validated result of fetching a URL.
type fetchedAttachment struct {
	mediaType string // normalized, lowercase, e.g. "image/png"
	data      []byte
	sourceURL string // the URL it came from, used to name file attachments
}

// fetch retrieves rawURL under the SSRF, timeout, and size guards. It returns a
// *NodeError describing a user-facing failure when the URL cannot be fetched.
func (f *attachmentFetcher) fetch(ctx context.Context, rawURL string) (*fetchedAttachment, *NodeError) {
	if err := httpblock.CheckURL(rawURL, f.ssrf); err != nil {
		return nil, attachmentError(rawURL, "is blocked for security (it resolves to a private or metadata address)", 0)
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, rawURL, nil)
	if err != nil {
		return nil, attachmentError(rawURL, "is not a valid URL", 0)
	}
	resp, err := f.client.Do(req)
	if err != nil {
		if errors.Is(err, httpblock.ErrSSRFBlocked) {
			return nil, attachmentError(rawURL, "is blocked for security (it resolves to a private or metadata address)", 0)
		}
		return nil, attachmentError(rawURL, "could not be reached", 0)
	}
	defer func() { _ = resp.Body.Close() }()
	if resp.StatusCode >= 400 {
		return nil, attachmentError(rawURL, fmt.Sprintf("returned an error status (%d)", resp.StatusCode), resp.StatusCode)
	}
	// Read one byte past the cap so an oversized body is detectable.
	body, err := io.ReadAll(io.LimitReader(resp.Body, f.maxBytes+1))
	if err != nil {
		return nil, attachmentError(rawURL, "could not be read ("+err.Error()+")", 0)
	}
	if int64(len(body)) > f.maxBytes {
		return nil, attachmentError(rawURL, fmt.Sprintf("is larger than the %d MB attachment limit", f.maxBytes/(1024*1024)), 0)
	}
	mt := normalizeMediaType(resp.Header.Get("Content-Type"))
	// Sniff from the bytes when the server omits or generalizes the type, so
	// extension-less and octet-stream responses still classify correctly.
	if mt == "" || mt == "application/octet-stream" {
		mt = normalizeMediaType(http.DetectContentType(body))
	}
	return &fetchedAttachment{mediaType: mt, data: body, sourceURL: rawURL}, nil
}

// rewrite fetches remote attachment URLs in every message and re-homes them
// into content parts. It runs after splitMessagesWithImages, so inline data:
// URLs are already parts; this pass handles http(s) URLs in string content, in
// text parts, and carried by existing image_url parts.
func (f *attachmentFetcher) rewrite(ctx context.Context, messages []app.ChatMessage) ([]app.ChatMessage, *NodeError) {
	out := make([]app.ChatMessage, 0, len(messages))
	for _, m := range messages {
		newContent := m.Content
		switch content := m.Content.(type) {
		case string:
			if parts, replaced := f.splitStringAttachments(ctx, content); replaced {
				newContent = parts
			}
		case []any:
			parts, ne := f.rewriteParts(ctx, content)
			if ne != nil {
				return nil, ne
			}
			newContent = parts
		}
		// A system message that gained an attachment part must be re-homed:
		// providers reject non-text parts in system role. Mirrors the same
		// re-homing splitMessagesWithImages does for inline data-URL images.
		if m.Role == "system" {
			if parts, ok := newContent.([]any); ok && hasNonTextPart(parts) {
				systemText, rest := splitLeadingText(parts)
				if systemText != "" {
					out = append(out, app.ChatMessage{Role: "system", Content: systemText})
				}
				if len(rest) > 0 {
					out = append(out, app.ChatMessage{Role: "user", Content: rest})
				}
				continue
			}
		}
		m.Content = newContent
		out = append(out, m)
	}
	return out, nil
}

// inlineImageInputs resolves image-typed inputs that carry a remote http(s)
// URL into inline base64 data URLs before message templating, so the existing
// data-URL image splitter delivers them as image parts. An image-typed input
// is an explicit attachment: the author declared the field an image, so a URL
// it carries that cannot be fetched as an image fails the run with a clear,
// user-facing error rather than being left as text for the model to guess from
// (e.g. from a filename). Inputs that are not image-typed, not http(s) URLs, or
// already inline data URLs are left untouched. The returned map is a copy only
// when a value was replaced, so the caller's original inputs (surfaced verbatim
// in execution events) keep the readable URL rather than a base64 blob.
func (f *attachmentFetcher) inlineImageInputs(ctx context.Context, node *dsl.Node, inputs map[string]any) (map[string]any, *NodeError) {
	out := inputs
	copied := false
	for _, field := range node.Data.Inputs {
		if field.Type != dsl.FieldTypeImage {
			continue
		}
		raw, ok := inputs[field.Identifier].(string)
		if !ok {
			continue
		}
		rawURL := strings.TrimSpace(raw)
		if !isHTTPURL(rawURL) {
			continue // already a data URL or not a remote reference
		}
		att, ne := f.fetch(ctx, rawURL)
		if ne != nil {
			return nil, ne
		}
		if !strings.HasPrefix(att.mediaType, "image/") {
			return nil, attachmentError(rawURL, "could not be loaded as an image (its content type is "+att.mediaType+")", 0)
		}
		if !copied {
			out = make(map[string]any, len(inputs))
			for k, v := range inputs {
				out[k] = v
			}
			copied = true
		}
		out[field.Identifier] = dataURL(att)
	}
	return out, nil
}

// hasNonTextPart reports whether a content-part list contains any part that is
// not a plain text block (an attachment that must not sit in a system message).
func hasNonTextPart(parts []any) bool {
	for _, p := range parts {
		if block, ok := p.(map[string]any); ok && block["type"] != "text" {
			return true
		}
	}
	return false
}

// splitStringAttachments scans text for http(s) URLs and, when any resolve to a
// real attachment, returns the text rewritten as a content-part list. A bare
// URL in text is best-effort: a reachable non-attachment (an HTML page) and a
// failed fetch both leave the URL as text, so an incidental link in prose never
// fails the run. Explicit image_url parts (handled in rewriteParts) do hard-fail
// on a bad fetch. The second return is false (parts nil) when there is nothing
// to attach, so the caller keeps the original string.
func (f *attachmentFetcher) splitStringAttachments(ctx context.Context, text string) ([]any, bool) {
	locs := httpURLRe.FindAllStringIndex(text, -1)
	if len(locs) == 0 {
		return nil, false
	}
	parts := make([]any, 0, len(locs)*2+1)
	addText := func(seg string) {
		if strings.TrimSpace(seg) == "" {
			return
		}
		parts = append(parts, map[string]any{"type": "text", "text": seg})
	}
	last := 0
	attached := false
	for _, loc := range locs {
		rawURL, trailing := trimTrailingPunct(text[loc[0]:loc[1]])
		addText(text[last:loc[0]])
		last = loc[1]
		att, ne := f.fetch(ctx, rawURL)
		if ne != nil {
			// Best-effort: a broken bare link stays as text rather than failing
			// the whole run; only explicit image_url parts hard-fail.
			addText(rawURL + trailing)
			continue
		}
		if part, ok := contentPartForAttachment(att); ok {
			parts = append(parts, part)
			addText(trailing)
			attached = true
		} else {
			// Reachable but not an attachment (e.g. an HTML page): the author
			// is referencing a link, so keep the URL verbatim as text.
			addText(rawURL + trailing)
		}
	}
	addText(text[last:])
	if !attached {
		return nil, false
	}
	return parts, true
}

// rewriteParts walks an existing content-part list, fetching http(s) URLs found
// in text parts and in image_url parts.
func (f *attachmentFetcher) rewriteParts(ctx context.Context, in []any) ([]any, *NodeError) {
	out := make([]any, 0, len(in))
	for _, p := range in {
		block, ok := p.(map[string]any)
		if !ok {
			out = append(out, p)
			continue
		}
		switch block["type"] {
		case "text":
			t, _ := block["text"].(string)
			if sub, replaced := f.splitStringAttachments(ctx, t); replaced {
				out = append(out, sub...)
			} else {
				out = append(out, block)
			}
		case "image_url":
			img, _ := block["image_url"].(map[string]any)
			url, _ := img["url"].(string)
			if !isHTTPURL(url) {
				out = append(out, block) // already a data URL, leave as-is
				continue
			}
			att, ne := f.fetch(ctx, url)
			if ne != nil {
				return nil, ne
			}
			part, ok := contentPartForAttachment(att)
			if !ok {
				// An image_url part is explicit attachment intent: a reachable
				// response that is not a deliverable attachment must fail clearly
				// rather than fall back to sending the raw URL to the provider and
				// bypassing the server-side fetch entirely.
				return nil, attachmentError(url, "could not be loaded as an image (its content type is "+att.mediaType+")", 0)
			}
			out = append(out, part)
		default:
			out = append(out, block)
		}
	}
	return out, nil
}

// contentPartForAttachment turns a fetched attachment into the content part its
// media type calls for. The second return is false when the response is not an
// attachment we deliver to the model (e.g. text/html), so the caller leaves the
// URL as text.
func contentPartForAttachment(att *fetchedAttachment) (map[string]any, bool) {
	switch {
	case strings.HasPrefix(att.mediaType, "image/"):
		return map[string]any{
			"type":      "image_url",
			"image_url": map[string]any{"url": dataURL(att)},
		}, true
	case strings.HasPrefix(att.mediaType, "audio/"):
		return map[string]any{
			"type": "input_audio",
			"input_audio": map[string]any{
				"data":   base64.StdEncoding.EncodeToString(att.data),
				"format": audioFormat(att.mediaType),
			},
		}, true
	case att.mediaType == "application/pdf":
		return map[string]any{
			"type": "file",
			"file": map[string]any{
				"filename":  fileNameFromURL(att.sourceURL, "attachment.pdf"),
				"file_data": dataURL(att),
			},
		}, true
	default:
		return nil, false
	}
}

func dataURL(att *fetchedAttachment) string {
	return "data:" + att.mediaType + ";base64," + base64.StdEncoding.EncodeToString(att.data)
}

// redactAttachmentsForTracing returns a copy of messages with heavy inline
// attachment bytes (base64 data URLs in image_url / file parts and raw base64 in
// input_audio parts) replaced by a short "[media-type, N bytes]" summary. The
// model still receives the full bytes — only the copy handed to tracing is
// shrunk — so a fetched 20 MB image/PDF/audio is not JSON-serialized into the
// span's langwatch.input (which would blow OTLP/ClickHouse size limits and store
// the private payload). Text and plain (non-data) URLs are left untouched.
func redactAttachmentsForTracing(messages []app.ChatMessage) []app.ChatMessage {
	out := make([]app.ChatMessage, len(messages))
	for i, m := range messages {
		out[i] = m
		parts, ok := m.Content.([]any)
		if !ok {
			continue
		}
		redacted := make([]any, len(parts))
		for j, p := range parts {
			redacted[j] = redactPartForTracing(p)
		}
		out[i].Content = redacted
	}
	return out
}

// redactPartForTracing replaces the inline bytes of a single content part with a
// summary, leaving every other part shape untouched.
func redactPartForTracing(p any) any {
	block, ok := p.(map[string]any)
	if !ok {
		return p
	}
	switch block["type"] {
	case "image_url":
		if img, ok := block["image_url"].(map[string]any); ok {
			if u, _ := img["url"].(string); strings.HasPrefix(u, "data:") {
				return map[string]any{"type": "image_url", "image_url": map[string]any{"url": summarizeDataURL(u)}}
			}
		}
	case "file":
		if file, ok := block["file"].(map[string]any); ok {
			if fd, _ := file["file_data"].(string); strings.HasPrefix(fd, "data:") {
				return map[string]any{"type": "file", "file": map[string]any{
					"filename": file["filename"], "file_data": summarizeDataURL(fd),
				}}
			}
		}
	case "input_audio":
		if audio, ok := block["input_audio"].(map[string]any); ok {
			if data, _ := audio["data"].(string); data != "" {
				format, _ := audio["format"].(string)
				return map[string]any{"type": "input_audio", "input_audio": map[string]any{
					"data": fmt.Sprintf("[audio, %d bytes]", approxBase64Bytes(data)), "format": format,
				}}
			}
		}
	}
	return p
}

// summarizeDataURL turns "data:image/png;base64,AAAA..." into a short
// "[image/png, 12345 bytes]" so the trace records the shape, not the payload.
func summarizeDataURL(s string) string {
	mediaType := "attachment"
	if strings.HasPrefix(s, "data:") {
		rest := s[len("data:"):]
		if i := strings.IndexAny(rest, ";,"); i >= 0 {
			mediaType = rest[:i]
		}
	}
	n := 0
	if comma := strings.IndexByte(s, ','); comma >= 0 {
		n = approxBase64Bytes(s[comma+1:])
	}
	return fmt.Sprintf("[%s, %d bytes]", mediaType, n)
}

// approxBase64Bytes estimates the decoded byte length of a base64 string
// without allocating the decoded buffer.
func approxBase64Bytes(b64 string) int {
	return len(strings.TrimRight(b64, "=")) * 3 / 4
}

// fileNameFromURL derives a file name from a URL's last path segment, falling
// back to the given default when the path has no usable segment.
func fileNameFromURL(rawURL, fallback string) string {
	if u, err := url.Parse(rawURL); err == nil {
		if base := path.Base(u.Path); base != "" && base != "." && base != "/" {
			return base
		}
	}
	return fallback
}

// audioFormat maps an audio media type to the short format token providers
// expect in an input_audio part (OpenAI accepts "mp3" and "wav"). audio/mpeg
// is "mp3", not "mpeg".
func audioFormat(mediaType string) string {
	switch mediaType {
	case "audio/mpeg", "audio/mp3":
		return "mp3"
	case "audio/wav", "audio/wave", "audio/x-wav":
		return "wav"
	default:
		return strings.TrimPrefix(mediaType, "audio/")
	}
}

// isHTTPURL reports whether s is an http(s) URL — the schemes the attachment
// fetcher handles. A bare "http" prefix check would also match non-fetchable
// look-alikes like "httpfoo://", so the scheme separator is required.
func isHTTPURL(s string) bool {
	lower := strings.ToLower(s)
	return strings.HasPrefix(lower, "http://") || strings.HasPrefix(lower, "https://")
}

// normalizeMediaType strips parameters (charset, boundary) and lowercases a
// Content-Type so callers can prefix-match on the bare media type.
func normalizeMediaType(ct string) string {
	if ct == "" {
		return ""
	}
	if mt, _, err := mime.ParseMediaType(ct); err == nil {
		return strings.ToLower(mt)
	}
	return strings.ToLower(strings.TrimSpace(strings.SplitN(ct, ";", 2)[0]))
}

// trimTrailingPunct splits sentence punctuation that a URL regex greedily
// captured off the end of a match, returning the cleaned URL and the trailing
// run so the caller can re-home the punctuation as text.
func trimTrailingPunct(token string) (url, trailing string) {
	i := len(token)
	for i > 0 && strings.ContainsRune(".,;:!?)]}'\"", rune(token[i-1])) {
		i--
	}
	return token[:i], token[i:]
}

// attachmentError builds the user-facing NodeError for a failed attachment
// fetch. Status threads the upstream HTTP status when there was one (for fault
// attribution), mirroring the llm_error path.
func attachmentError(rawURL, reason string, status int) *NodeError {
	return &NodeError{
		Type:    "attachment_fetch_error",
		Message: fmt.Sprintf("Could not load the attachment %s: it %s.", redactURLForError(rawURL), reason),
		Status:  status,
	}
}

// redactURLForError strips the query string and fragment from a URL before it
// is surfaced in a user-facing error (and stored on the node/trace). Presigned
// S3/CDN URLs carry credentials (X-Amz-Signature, X-Amz-Credential, security
// tokens) in the query string, so leaking the raw URL on a fetch failure would
// expose them. The scheme, host, and path are kept so the attachment stays
// identifiable.
func redactURLForError(rawURL string) string {
	if u, err := url.Parse(rawURL); err == nil && u.Scheme != "" {
		u.RawQuery = ""
		u.Fragment = ""
		return u.String()
	}
	if i := strings.IndexAny(rawURL, "?#"); i >= 0 {
		return rawURL[:i]
	}
	return rawURL
}
