package mailsim

import (
	"bytes"
	"io"
	"regexp"
	"strings"
	"time"

	emessage "github.com/emersion/go-message"
	"github.com/emersion/go-message/mail"
)

// linkPattern finds an absolute http(s) URL, trimming the trailing
// punctuation a sentence or an HTML attribute commonly leaves attached.
var linkPattern = regexp.MustCompile(`(?i)https?://[^\s<>"']+`)

// extractLinks returns every absolute http(s) URL in text and html,
// deduplicated, in order of first appearance.
func extractLinks(text, html string) []string {
	seen := make(map[string]bool)
	var out []string
	for _, body := range []string{text, html} {
		for _, raw := range linkPattern.FindAllString(body, -1) {
			link := strings.TrimRight(raw, ".,;:!?)'\"]}")
			if link == "" || seen[link] {
				continue
			}
			seen[link] = true
			out = append(out, link)
		}
	}
	return out
}

// parseMessage turns a raw RFC 5322 message plus its SMTP envelope into the
// message the API and inbox serve back.
func parseMessage(raw []byte, envelopeFrom string, envelopeTo []string, receivedAt time.Time) *Message {
	msg := &Message{
		Summary: Summary{
			From:       envelopeFrom,
			To:         envelopeTo,
			ReceivedAt: receivedAt,
			SizeBytes:  len(raw),
		},
		Headers: map[string]string{},
	}

	reader, err := mail.CreateReader(bytes.NewReader(raw))
	if err != nil && !emessage.IsUnknownCharset(err) {
		// Unparseable input still gets an inbox entry — an untrusted message
		// that cannot be parsed is exactly the kind of thing a caught-mail
		// sink must show rather than silently drop.
		msg.Text = string(raw)
		return msg
	}

	msg.Headers = headerMap(reader.Header)
	if subject, err := reader.Header.Subject(); err == nil {
		msg.Subject = subject
	}

	for {
		part, err := reader.NextPart()
		if err == io.EOF {
			break
		}
		if err != nil && !emessage.IsUnknownCharset(err) {
			break
		}
		body, _ := io.ReadAll(part.Body)
		switch h := part.Header.(type) {
		case *mail.InlineHeader:
			contentType, _, _ := h.ContentType()
			if strings.HasPrefix(contentType, "text/html") {
				msg.HTML += string(body)
			} else {
				msg.Text += string(body)
			}
		case *mail.AttachmentHeader:
			filename, _ := h.Filename()
			contentType, _, _ := h.ContentType()
			msg.Attachments = append(msg.Attachments, AttachmentInfo{
				Filename:    filename,
				ContentType: contentType,
				SizeBytes:   len(body),
			})
		}
	}

	msg.Links = extractLinks(msg.Text, msg.HTML)
	return msg
}

// headerMap flattens the parsed header into the flat string map the wire
// contract carries. A repeated field's values are joined in order — the
// inbox is for reading, not for reconstructing the original wire form.
func headerMap(h mail.Header) map[string]string {
	out := map[string]string{}
	fields := h.Fields()
	for fields.Next() {
		key := fields.Key()
		if existing, ok := out[key]; ok {
			out[key] = existing + ", " + fields.Value()
		} else {
			out[key] = fields.Value()
		}
	}
	return out
}
