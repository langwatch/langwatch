package mailsim

import (
	"bytes"
	"errors"
	"html"
	"html/template"
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
func extractLinks(text, htmlBody string) []string {
	seen := make(map[string]bool)
	var out []string
	for _, body := range []string{text, htmlBody} {
		for _, raw := range linkPattern.FindAllString(body, -1) {
			// A URL written in HTML has its ampersands escaped, so the raw match
			// carries `&amp;` through every query parameter after the first. Copied
			// or clicked, that address is not the one the email meant.
			link := strings.TrimRight(html.UnescapeString(raw), ".,;:!?)'\"]}")
			if link == "" || seen[link] {
				continue
			}
			seen[link] = true
			out = append(out, link)
		}
	}
	return out
}

// envelope is what the SMTP transaction said, as opposed to what the
// message's own headers claim.
type envelope struct {
	From       string
	To         []string
	ReceivedAt time.Time
}

// parseMessage turns a raw RFC 5322 message plus its SMTP envelope into the
// message the API and inbox serve back.
func parseMessage(raw []byte, env envelope) *Message {
	msg := &Message{
		Summary: Summary{
			From:       env.From,
			To:         env.To,
			ReceivedAt: env.ReceivedAt,
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
		if errors.Is(err, io.EOF) {
			break
		}
		if err != nil && !emessage.IsUnknownCharset(err) {
			break
		}
		absorbPart(msg, part)
	}

	msg.Links = extractLinks(msg.Text, msg.HTML)
	return msg
}

// absorbPart folds one MIME part into the message: inline text and HTML
// bodies accumulate, attachments are recorded by name, type and size.
func absorbPart(msg *Message, part *mail.Part) {
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

// popupBase is what makes an anchor in a sandboxed preview do something. A
// frame allowed to open popups but not to navigate itself does nothing at all
// with a plain <a href>; targeting a new context turns the same anchor into the
// one click the preview exists for.
const popupBase = `<base target="_blank">`

// withPopupBase inserts that base into a caught message's HTML. It goes inside
// <head> when the message has one — a base element outside the head is invalid
// and browsers vary on whether they honor it — and in front of everything
// otherwise, which is what a fragment body (the common case for a template
// rendered without a document wrapper) gets. A message that already declares
// its own base is left alone: the sender said where its links resolve, and
// overriding that would change what the developer is being shown.
func withPopupBase(body string) string {
	if body == "" || strings.Contains(strings.ToLower(body), "<base") {
		return body
	}
	if loc := headOpenTag.FindStringIndex(body); loc != nil {
		return body[:loc[1]] + popupBase + body[loc[1]:]
	}
	return popupBase + body
}

// headOpenTag matches the opening <head> tag, with or without attributes.
var headOpenTag = regexp.MustCompile(`(?i)<head[^>]*>`)

// textLinkPattern is linkPattern with the HTML delimiters left in, because
// plain text has none: a URL in a text body ends at whitespace, and the
// trailing punctuation a sentence leaves on it is trimmed after the match.
var textLinkPattern = regexp.MustCompile(`(?i)https?://\S+`)

// LinkifiedText is the plain-text body with its URLs turned into anchors, safe
// to render directly. Everything is escaped first and only the anchors are
// added back, so a text body containing `<script>` stays the four words it is.
//
// It exists because the plain-text tab is where a text-only message is read,
// and a sign-in link printed there as characters is one a developer has to
// select and paste. The preview tab got its links back by being allowed to open
// them; this is the same fix for the other half of the message.
func (m *Message) LinkifiedText() template.HTML {
	var b strings.Builder
	rest := m.Text
	for {
		loc := textLinkPattern.FindStringIndex(rest)
		if loc == nil {
			b.WriteString(template.HTMLEscapeString(rest))
			break
		}
		b.WriteString(template.HTMLEscapeString(rest[:loc[0]]))
		raw := rest[loc[0]:loc[1]]
		link := strings.TrimRight(raw, ".,;:!?)'\"]}")
		escaped := template.HTMLEscapeString(link)
		b.WriteString(`<a href="` + escaped + `" target="_blank" rel="noreferrer">` + escaped + `</a>`)
		b.WriteString(template.HTMLEscapeString(raw[len(link):]))
		rest = rest[loc[1]:]
	}
	return template.HTML(b.String()) //nolint:gosec // every segment above is escaped; only the anchors are markup
}
