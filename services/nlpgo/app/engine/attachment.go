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
// content the model can actually see/hear/read. The data-URL splitter in
// multimodal.go only handles inline data:...;base64 values; a plain
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
// into content parts. It runs after splitMessagesWithAttachments, so inline data:
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
		// re-homing splitMessagesWithAttachments does for inline data-URL attachments.
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

// inlineAttachmentInputs resolves image-typed and file-typed inputs that carry
// a remote http(s) URL into inline base64 data URLs before message templating,
// so the data-URL splitter delivers them as content parts. Such a field is an
// explicit attachment: the author declared it an image or a file, so a URL it
// carries that cannot be delivered fails the run with a clear, user-facing
// error rather than being left as text for the model to guess from (e.g. from
// a filename). An image field accepts image media types only; a file field
// accepts every media type the engine can deliver. Inputs that are neither
// typed, not http(s) URLs, or already inline data URLs are left untouched. The
// returned map is a copy only when a value was replaced, so the caller's
// original inputs (surfaced verbatim in execution events) keep the readable URL
// rather than a base64 blob.
func (f *attachmentFetcher) inlineAttachmentInputs(ctx context.Context, node *dsl.Node, inputs map[string]any) (map[string]any, *NodeError) {
	out := inputs
	copied := false
	for _, field := range node.Data.Inputs {
		rawURL, ok := remoteAttachmentFieldURL(field, inputs)
		if !ok {
			continue
		}
		att, ne := f.fetch(ctx, rawURL)
		if ne != nil {
			return nil, ne
		}
		if ne := refuseUndeliverableAttachment(field.Type, rawURL, att.mediaType); ne != nil {
			return nil, ne
		}
		if !copied {
			out = copyInputs(inputs)
			copied = true
		}
		out[field.Identifier] = dataURL(att)
	}
	return out, nil
}

// remoteAttachmentFieldURL returns the remote URL an attachment-typed field
// carries, or false for a field that is not an attachment, holds no string,
// or already holds an inline data URL.
func remoteAttachmentFieldURL(field dsl.Field, inputs map[string]any) (string, bool) {
	if field.Type != dsl.FieldTypeImage && field.Type != dsl.FieldTypeFile {
		return "", false
	}
	raw, ok := inputs[field.Identifier].(string)
	if !ok {
		return "", false
	}
	rawURL := strings.TrimSpace(raw)
	if !isHTTPURL(rawURL) {
		return "", false
	}
	return rawURL, true
}

// refuseUndeliverableAttachment names why a fetched response is not what the
// field declared, or nil when it is deliverable.
func refuseUndeliverableAttachment(fieldType dsl.FieldType, rawURL, mediaType string) *NodeError {
	if fieldType == dsl.FieldTypeImage && !strings.HasPrefix(mediaType, "image/") {
		return attachmentError(rawURL, "could not be loaded as an image (its content type is "+mediaType+")", 0)
	}
	if fieldType == dsl.FieldTypeFile && !isDeliverableMediaType(mediaType) {
		return attachmentError(rawURL, "could not be loaded as a file (its content type is "+mediaType+")", 0)
	}
	return nil
}

// copyInputs shallow-copies the caller's inputs so the originals, surfaced
// verbatim in execution events, keep the readable URL rather than a base64 blob.
func copyInputs(inputs map[string]any) map[string]any {
	out := make(map[string]any, len(inputs))
	for k, v := range inputs {
		out[k] = v
	}
	return out
}

// isDeliverableMediaType reports whether the engine can turn a media type into
// a content part the model reads. Everything outside this list (an executable,
// an archive, an unrecognized binary) is refused on a file-typed field rather
// than shipped to the provider as an opaque blob.
func isDeliverableMediaType(mediaType string) bool {
	switch {
	case strings.HasPrefix(mediaType, "image/"),
		strings.HasPrefix(mediaType, "audio/"),
		strings.HasPrefix(mediaType, "video/"),
		strings.HasPrefix(mediaType, "text/"):
		return true
	}
	switch mediaType {
	case "application/pdf", "application/json", "application/xml", "application/csv":
		return true
	}
	return false
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
				"filename":  fileNameFromURL(att.sourceURL, "document.pdf"),
				"file_data": dataURL(att),
			},
		}, true
	default:
		return nil, false
	}
}

// inlineAttachmentPart turns an attachment the author explicitly declared into
// the content part its media type calls for. It differs from
// contentPartForAttachment in what it does with the types that one refuses: a
// declared attachment is never left as a link, so text-like content is decoded
// into a text part the model reads and anything else travels as a file part.
//
// contentPartForAttachment keeps its own narrower answer because it also serves
// the best-effort prose scan, where a reachable web page is a link the author
// mentioned rather than a document they attached.
func inlineAttachmentPart(att *fetchedAttachment) map[string]any {
	if part, ok := contentPartForAttachment(att); ok {
		return part
	}
	if isTextMediaType(att.mediaType) {
		return map[string]any{"type": "text", "text": string(att.data)}
	}
	return map[string]any{
		"type": "file",
		"file": map[string]any{
			"filename":  fileNameFromURL(att.sourceURL, "file"+extensionForMediaType(att.mediaType)),
			"file_data": dataURL(att),
		},
	}
}

// isTextMediaType reports whether the bytes read as characters rather than as a
// binary payload, in which case the model reads them best as plain text.
func isTextMediaType(mediaType string) bool {
	if strings.HasPrefix(mediaType, "text/") {
		return true
	}
	switch mediaType {
	case "application/json", "application/xml", "application/csv":
		return true
	}
	return false
}

// extensionForMediaType names a file for a media type the standard table knows,
// falling back to the subtype so an unknown type still gets a readable suffix.
func extensionForMediaType(mediaType string) string {
	if exts, err := mime.ExtensionsByType(mediaType); err == nil && len(exts) > 0 {
		return exts[0]
	}
	subtype := mediaType
	if slash := strings.IndexByte(subtype, '/'); slash >= 0 {
		subtype = subtype[slash+1:]
	}
	if plus := strings.IndexByte(subtype, '+'); plus >= 0 {
		subtype = subtype[plus+1:]
	}
	subtype = strings.TrimPrefix(subtype, "x-")
	if subtype == "" {
		return ".bin"
	}
	return "." + subtype
}

func dataURL(att *fetchedAttachment) string {
	return "data:" + att.mediaType + ";base64," + base64.StdEncoding.EncodeToString(att.data)
}

// An attachment reaches the trace as real content when it fits, and keeps a
// short "[media-type, N bytes]" summary when it does not.
//
// The ceiling is the collector's OTLP body limit, not the fetch limit: an
// attachment fetch may return up to defaultMaxAttachmentBytes (20 MB) while the
// collector refuses a body over 10 MB, and a rejected body loses the whole
// trace, which is far worse than a summarized picture. The budget is shared
// across the message set so several medium attachments cannot add up past the
// same limit. Both figures count DECODED bytes; base64 inflates a payload by a
// third, so they leave headroom for the encoding and for the rest of the batch.
//
// Anything under the ceiling is carried through verbatim and the ingestion edge
// externalizes it to the content-addressed store, exactly as it does for media
// sent by any other SDK. That is what puts the picture in the trace instead of
// a placeholder that renders as broken media.
const (
	maxTracedAttachmentBytes       = 3 << 20
	maxTracedAttachmentBudgetBytes = 4 << 20
)

// traceAttachmentBudget is the per-message-set allowance described above.
type traceAttachmentBudget struct{ remaining int }

// admit reports whether an attachment with this base64 payload is carried into
// the trace, spending the budget when it is.
func (b *traceAttachmentBudget) admit(payload string) bool {
	n := approxBase64Bytes(payload)
	if n > maxTracedAttachmentBytes || n > b.remaining {
		return false
	}
	b.remaining -= n
	return true
}

// messagesForTracing returns the copy of messages handed to the span. The model
// always receives the originals, so nothing here changes what it sees.
func messagesForTracing(messages []app.ChatMessage) []app.ChatMessage {
	budget := &traceAttachmentBudget{remaining: maxTracedAttachmentBudgetBytes}
	out := make([]app.ChatMessage, len(messages))
	for i, m := range messages {
		out[i] = m
		parts, ok := m.Content.([]any)
		if !ok {
			continue
		}
		traced := make([]any, len(parts))
		for j, p := range parts {
			traced[j] = partForTracing(p, budget)
		}
		out[i].Content = traced
	}
	return out
}

// partForTracing carries one content part into the trace, summarizing its
// inline bytes only when they do not fit. Every other part shape is untouched.
func partForTracing(p any, budget *traceAttachmentBudget) any {
	block, ok := p.(map[string]any)
	if !ok {
		return p
	}
	switch block["type"] {
	case "image_url":
		return imageURLForTracing(p, block, budget)
	case "file":
		return fileForTracing(p, block, budget)
	case "input_audio":
		return inputAudioForTracing(p, block, budget)
	default:
		return p
	}
}

func imageURLForTracing(p any, block map[string]any, budget *traceAttachmentBudget) any {
	img, ok := block["image_url"].(map[string]any)
	if !ok {
		return p
	}
	u, _ := img["url"].(string)
	if !strings.HasPrefix(u, "data:") || budget.admit(dataURLPayload(u)) {
		return p
	}
	return map[string]any{
		"type":      "image_url",
		"image_url": map[string]any{"url": summarizeDataURL(u)},
	}
}

func fileForTracing(p any, block map[string]any, budget *traceAttachmentBudget) any {
	file, ok := block["file"].(map[string]any)
	if !ok {
		return p
	}
	fd, _ := file["file_data"].(string)
	if !strings.HasPrefix(fd, "data:") || budget.admit(dataURLPayload(fd)) {
		return p
	}
	return map[string]any{"type": "file", "file": map[string]any{
		"filename": file["filename"], "file_data": summarizeDataURL(fd),
	}}
}

func inputAudioForTracing(p any, block map[string]any, budget *traceAttachmentBudget) any {
	audio, ok := block["input_audio"].(map[string]any)
	if !ok {
		return p
	}
	data, _ := audio["data"].(string)
	if data == "" || budget.admit(data) {
		return p
	}
	format, _ := audio["format"].(string)
	return map[string]any{"type": "input_audio", "input_audio": map[string]any{
		"data":   fmt.Sprintf("[audio, %d bytes]", approxBase64Bytes(data)),
		"format": format,
	}}
}

// dataURLPayload returns the base64 payload of a data URL, or "" when it has none.
func dataURLPayload(s string) string {
	if comma := strings.IndexByte(s, ','); comma >= 0 {
		return s[comma+1:]
	}
	return ""
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
	return fmt.Sprintf("[%s, %d bytes]", mediaType, approxBase64Bytes(dataURLPayload(s)))
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

// redactURLForError strips the credential-bearing parts of a URL before it is
// surfaced in a user-facing error (and stored on the node/trace): the query
// string and fragment (presigned S3/CDN URLs carry X-Amz-Signature,
// X-Amz-Credential, and security tokens there) and the userinfo component
// (https://user:token@host/...). The scheme, host, and path are kept so the
// attachment stays identifiable.
func redactURLForError(rawURL string) string {
	if u, err := url.Parse(rawURL); err == nil && u.Scheme != "" {
		u.RawQuery = ""
		u.Fragment = ""
		u.User = nil
		return u.String()
	}
	// Fallback for a URL that does not parse: cut at the userinfo separator and
	// the query/fragment so neither embedded creds nor signed params survive.
	if at := strings.LastIndex(rawURL, "@"); at >= 0 {
		if slashes := strings.Index(rawURL, "://"); slashes >= 0 && at > slashes {
			rawURL = rawURL[:slashes+3] + rawURL[at+1:]
		}
	}
	if i := strings.IndexAny(rawURL, "?#"); i >= 0 {
		return rawURL[:i]
	}
	return rawURL
}
