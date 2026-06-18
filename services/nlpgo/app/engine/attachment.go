package engine

import (
	"context"
	"encoding/base64"
	"errors"
	"fmt"
	"io"
	"mime"
	"net/http"
	"regexp"
	"strings"
	"time"

	"github.com/langwatch/langwatch/services/nlpgo/app"
	"github.com/langwatch/langwatch/services/nlpgo/app/engine/blocks/httpblock"
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
	return &attachmentFetcher{
		client: &http.Client{
			Timeout:   defaultAttachmentTimeout,
			Transport: &http.Transport{DialContext: httpblock.SafeDialer(ssrf)},
		},
		ssrf:     ssrf,
		maxBytes: defaultMaxAttachmentBytes,
	}
}

// fetchedAttachment is the validated result of fetching a URL.
type fetchedAttachment struct {
	mediaType string // normalized, lowercase, e.g. "image/png"
	data      []byte
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
		return nil, attachmentError(rawURL, "could not be reached ("+err.Error()+")", 0)
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
	return &fetchedAttachment{mediaType: mt, data: body}, nil
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
			parts, replaced, ne := f.splitStringAttachments(ctx, content)
			if ne != nil {
				return nil, ne
			}
			if replaced {
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
// real attachment, returns the text rewritten as a content-part list. The
// second return is false (and parts nil) when there is nothing to attach, so
// the caller keeps the original string. A failed fetch returns a *NodeError.
func (f *attachmentFetcher) splitStringAttachments(ctx context.Context, text string) ([]any, bool, *NodeError) {
	locs := httpURLRe.FindAllStringIndex(text, -1)
	if len(locs) == 0 {
		return nil, false, nil
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
		att, ne := f.fetch(ctx, rawURL)
		if ne != nil {
			return nil, false, ne
		}
		part, ok := contentPartForAttachment(att)
		addText(text[last:loc[0]])
		if ok {
			parts = append(parts, part)
			addText(trailing)
			attached = true
		} else {
			// Reachable but not an attachment (e.g. an HTML page): the author
			// is referencing a link, so keep the URL verbatim as text.
			addText(rawURL + trailing)
		}
		last = loc[1]
	}
	addText(text[last:])
	if !attached {
		return nil, false, nil
	}
	return parts, true, nil
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
			sub, replaced, ne := f.splitStringAttachments(ctx, t)
			if ne != nil {
				return nil, ne
			}
			if replaced {
				out = append(out, sub...)
			} else {
				out = append(out, block)
			}
		case "image_url":
			img, _ := block["image_url"].(map[string]any)
			url, _ := img["url"].(string)
			if !strings.HasPrefix(strings.ToLower(url), "http") {
				out = append(out, block) // already a data URL, leave as-is
				continue
			}
			att, ne := f.fetch(ctx, url)
			if ne != nil {
				return nil, ne
			}
			part, ok := contentPartForAttachment(att)
			if ok {
				out = append(out, part)
			} else {
				out = append(out, block)
			}
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
				"format": strings.TrimPrefix(att.mediaType, "audio/"),
			},
		}, true
	case att.mediaType == "application/pdf":
		return map[string]any{
			"type": "file",
			"file": map[string]any{
				"filename":  "attachment.pdf",
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
func attachmentError(url, reason string, status int) *NodeError {
	return &NodeError{
		Type:    "attachment_fetch_error",
		Message: fmt.Sprintf("Could not load the attachment %s: it %s.", url, reason),
		Status:  status,
	}
}
