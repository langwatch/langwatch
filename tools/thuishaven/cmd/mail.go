package cmd

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"strings"
	"time"
)

// The `haven mail` noun: read this worktree's own caught email — one client
// over the sink's own HTTP API (services/mailsim), the same API a test would
// call directly. `address` needs no request; every other subcommand dials
// d.orch.MailBaseURL, which refuses immediately, naming the lane and the
// command that starts it, when the sink is not running.

// mailHTTPTimeout bounds every request except `wait`, which adds its own
// requested timeout on top — a long-poll must not be cut off by the client
// before the server's own deadline fires.
const mailHTTPTimeout = 5 * time.Second

// mailWaitDefaultTimeout is `haven mail wait`'s timeout when --timeout is not
// given, matching the sink's own default.
const mailWaitDefaultTimeout = 30 * time.Second

// mailSummary is one caught message as the sink's list/wait endpoints report
// it — the pinned contract's Summary shape.
type mailSummary struct {
	ID         string    `json:"id"`
	From       string    `json:"from"`
	To         []string  `json:"to"`
	Subject    string    `json:"subject"`
	ReceivedAt time.Time `json:"receivedAt"`
	SizeBytes  int64     `json:"sizeBytes"`
}

// mailAttachment is one attachment on a fully-read message.
type mailAttachment struct {
	Filename    string `json:"filename"`
	ContentType string `json:"contentType"`
	SizeBytes   int64  `json:"sizeBytes"`
}

// mailMessage is a message read in full — the pinned contract's Summary +
// headers/bodies/links/attachments. Embedding mailSummary flattens its fields
// into this one's JSON, matching the wire shape exactly.
type mailMessage struct {
	mailSummary
	Headers     map[string]string `json:"headers"`
	Text        string            `json:"text"`
	HTML        string            `json:"html"`
	Links       []string          `json:"links"`
	Attachments []mailAttachment  `json:"attachments"`
}

// mailClient is the one seam every subcommand's HTTP call goes through, so a
// test can stub it with an httptest.Server's URL instead of a running sink.
type mailClient struct {
	baseURL string
	http    *http.Client
}

func newMailClient(baseURL string) mailClient {
	return mailClient{baseURL: strings.TrimRight(baseURL, "/"), http: &http.Client{Timeout: mailHTTPTimeout}}
}

// mailRequest is one call to the sink. notFound is returned verbatim on a
// 404, so callers can give it a message that names what was being looked up
// rather than "answered 404 Not Found".
type mailRequest struct {
	method, path string
	query        url.Values
	into         any
	notFound     error
}

// do issues one request and decodes a 200 JSON body into r.into.
func (c mailClient) do(ctx context.Context, r mailRequest) error {
	method, path := r.method, r.path
	target := c.baseURL + path
	if len(r.query) > 0 {
		target += "?" + r.query.Encode()
	}
	req, err := http.NewRequestWithContext(ctx, method, target, nil)
	if err != nil {
		return err
	}
	resp, err := c.http.Do(req)
	if err != nil {
		return fmt.Errorf("could not reach the mail sink at %s: %w", c.baseURL, err)
	}
	defer func() { _ = resp.Body.Close() }()
	switch resp.StatusCode {
	case http.StatusOK:
		if r.into == nil {
			return nil
		}
		return json.NewDecoder(resp.Body).Decode(r.into)
	case http.StatusNoContent:
		return nil
	case http.StatusNotFound:
		if r.notFound != nil {
			return r.notFound
		}
		return fmt.Errorf("%s %s answered 404", method, path)
	default:
		body, _ := io.ReadAll(resp.Body)
		return fmt.Errorf("%s %s answered %s: %s", method, path, resp.Status, strings.TrimSpace(string(body)))
	}
}

// mailFilter narrows a list or a wait to a recipient and a subject; empty
// fields match everything.
type mailFilter struct {
	to, subject string
}

// addTo sets the filter's non-empty fields on q.
func (f mailFilter) addTo(q url.Values) url.Values {
	if f.to != "" {
		q.Set("to", f.to)
	}
	if f.subject != "" {
		q.Set("subject", f.subject)
	}
	return q
}

func (c mailClient) list(ctx context.Context, filter mailFilter) ([]mailSummary, error) {
	var out struct {
		Messages []mailSummary `json:"messages"`
	}
	if err := c.do(ctx, mailRequest{method: http.MethodGet, path: "/api/messages", query: filter.addTo(url.Values{}), into: &out}); err != nil {
		return nil, err
	}
	return out.Messages, nil
}

func (c mailClient) get(ctx context.Context, id string) (mailMessage, error) {
	var msg mailMessage
	notFound := fmt.Errorf("message %q is not in this stack's inbox", id)
	if err := c.do(ctx, mailRequest{method: http.MethodGet, path: "/api/messages/" + url.PathEscape(id), into: &msg, notFound: notFound}); err != nil {
		return mailMessage{}, err
	}
	return msg, nil
}

// wait long-polls the sink; matched is false only on the sink's own 204
// timeout, never on a network failure (that is returned as an error instead).
func (c mailClient) wait(ctx context.Context, filter mailFilter, timeout time.Duration) (mailMessage, bool, error) {
	q := filter.addTo(url.Values{"timeout": {timeout.String()}})
	target := c.baseURL + "/api/messages/wait?" + q.Encode()
	// The client's own deadline must outlast the server's requested long-poll
	// window, or a slow-but-legitimate wait reads as a network failure instead
	// of the timeout it actually is.
	waitCtx, cancel := context.WithTimeout(ctx, timeout+mailHTTPTimeout)
	defer cancel()
	req, err := http.NewRequestWithContext(waitCtx, http.MethodGet, target, nil)
	if err != nil {
		return mailMessage{}, false, err
	}
	resp, err := c.http.Do(req)
	if err != nil {
		return mailMessage{}, false, fmt.Errorf("could not reach the mail sink at %s: %w", c.baseURL, err)
	}
	defer func() { _ = resp.Body.Close() }()
	switch resp.StatusCode {
	case http.StatusOK:
		var msg mailMessage
		if err := json.NewDecoder(resp.Body).Decode(&msg); err != nil {
			return mailMessage{}, false, err
		}
		return msg, true, nil
	case http.StatusNoContent:
		return mailMessage{}, false, nil
	default:
		body, _ := io.ReadAll(resp.Body)
		return mailMessage{}, false, fmt.Errorf("wait answered %s: %s", resp.Status, strings.TrimSpace(string(body)))
	}
}

func (c mailClient) clear(ctx context.Context) error {
	return c.do(ctx, mailRequest{method: http.MethodDelete, path: "/api/messages"})
}

// getHTML reads a message's raw HTML body — not JSON, so it bypasses do's
// decoder and reads the response bytes as-is.
func (c mailClient) getHTML(ctx context.Context, id string) (string, error) {
	target := c.baseURL + "/api/messages/" + url.PathEscape(id) + "/html"
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, target, nil)
	if err != nil {
		return "", err
	}
	resp, err := c.http.Do(req)
	if err != nil {
		return "", fmt.Errorf("could not reach the mail sink at %s: %w", c.baseURL, err)
	}
	defer func() { _ = resp.Body.Close() }()
	body, readErr := io.ReadAll(resp.Body)
	switch resp.StatusCode {
	case http.StatusOK:
		return string(body), readErr
	case http.StatusNotFound:
		return "", fmt.Errorf("message %q is not in this stack's inbox", id)
	default:
		return "", fmt.Errorf("GET .../html answered %s: %s", resp.Status, strings.TrimSpace(string(body)))
	}
}

// mailUsage is printed on a missing or unknown subcommand.
const mailUsage = "usage: haven mail <address|list [--to] [--subject]|get <id> [--html]|wait [--to] [--subject] [--timeout]|clear> [--json]"

// runMail is `haven mail <address|list|get|wait|clear>`.
func runMail(ctx context.Context, d deps, inv invocation) error {
	if len(inv.args) == 0 {
		return errors.New(mailUsage)
	}
	asJSON := inv.has("--json") || d.isAgent

	if inv.args[0] == "address" {
		addr, err := d.orch.MailAddress(d.params)
		if err != nil {
			return err
		}
		if asJSON {
			return printMailJSON(map[string]string{"address": addr})
		}
		fmt.Println(addr)
		return nil
	}

	base, err := d.orch.MailBaseURL(d.params)
	if err != nil {
		return err
	}
	return runMailSubcommand(ctx, inv, mailSink{baseURL: base, asJSON: asJSON})
}

// mailSink is the sink a subcommand talks to and whether it answers in JSON.
type mailSink struct {
	baseURL string
	asJSON  bool
}

// runMailSubcommand is every `haven mail` subcommand but `address`, given the
// sink's base URL — split out so it can be unit-tested against a stub HTTP
// server implementing the pinned contract, with no Orchestrator involved.
func runMailSubcommand(ctx context.Context, inv invocation, sink mailSink) error {
	cmd := mailCommand{client: newMailClient(sink.baseURL), asJSON: sink.asJSON}
	switch inv.args[0] {
	case "list":
		return cmd.list(ctx, inv)
	case "get":
		return cmd.get(ctx, inv)
	case "wait":
		return cmd.wait(ctx, inv)
	case "clear":
		return cmd.clear(ctx)
	default:
		return fmt.Errorf("unknown `haven mail` subcommand %q — %s", inv.args[0], mailUsage)
	}
}

// mailCommand runs one subcommand against the sink and prints its answer.
type mailCommand struct {
	client mailClient
	asJSON bool
}

func (cmd mailCommand) list(ctx context.Context, inv invocation) error {
	messages, err := cmd.client.list(ctx, mailFilter{to: inv.value("--to"), subject: inv.value("--subject")})
	if err != nil {
		return err
	}
	if cmd.asJSON {
		return printMailJSON(messages)
	}
	printMailList(messages)
	return nil
}

func (cmd mailCommand) get(ctx context.Context, inv invocation) error {
	if len(inv.args) < 2 {
		return errors.New("usage: haven mail get <id> [--html]")
	}
	id := inv.args[1]
	if inv.has("--html") {
		html, err := cmd.client.getHTML(ctx, id)
		if err != nil {
			return err
		}
		fmt.Println(html)
		return nil
	}
	msg, err := cmd.client.get(ctx, id)
	if err != nil {
		return err
	}
	return cmd.printMessage(msg)
}

func (cmd mailCommand) wait(ctx context.Context, inv invocation) error {
	timeout := mailWaitDefaultTimeout
	if raw := inv.value("--timeout"); raw != "" {
		dur, err := time.ParseDuration(raw)
		if err != nil {
			return fmt.Errorf("--timeout %q is not a valid duration, e.g. 30s: %w", raw, err)
		}
		timeout = dur
	}
	msg, matched, err := cmd.client.wait(ctx, mailFilter{to: inv.value("--to"), subject: inv.value("--subject")}, timeout)
	if err != nil {
		return err
	}
	if !matched {
		return fmt.Errorf("no message matched within %s", timeout)
	}
	return cmd.printMessage(msg)
}

func (cmd mailCommand) clear(ctx context.Context) error {
	if err := cmd.client.clear(ctx); err != nil {
		return err
	}
	if cmd.asJSON {
		return printMailJSON(map[string]bool{"cleared": true})
	}
	fmt.Println("inbox cleared")
	return nil
}

func (cmd mailCommand) printMessage(msg mailMessage) error {
	if cmd.asJSON {
		return printMailJSON(msg)
	}
	printMailMessage(msg)
	return nil
}

func printMailJSON(v any) error {
	enc := json.NewEncoder(os.Stdout)
	enc.SetIndent("", "  ")
	return enc.Encode(v)
}

func printMailList(messages []mailSummary) {
	if len(messages) == 0 {
		fmt.Println("the inbox is empty")
		return
	}
	for _, m := range messages {
		fmt.Printf("%-24s %-28s %-28s %-32s %s\n",
			m.ID, m.From, strings.Join(m.To, ","), m.Subject, m.ReceivedAt.Format(time.RFC3339))
	}
}

func printMailMessage(m mailMessage) {
	fmt.Printf("id:      %s\n", m.ID)
	fmt.Printf("from:    %s\n", m.From)
	fmt.Printf("to:      %s\n", strings.Join(m.To, ", "))
	fmt.Printf("subject: %s\n", m.Subject)
	fmt.Printf("time:    %s\n", m.ReceivedAt.Format(time.RFC3339))
	fmt.Println()
	fmt.Println(m.Text)
	if len(m.Links) > 0 {
		fmt.Println("\nlinks:")
		for _, link := range m.Links {
			fmt.Println("  " + link)
		}
	}
}
