// Package chclient is a small ClickHouse HTTP client for ch-config's own
// queries (backups). Credentials sit behind an interface so the source of the
// admin login can change without touching the callers.
package chclient

import (
	"bufio"
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"strconv"
	"strings"
	"time"
)

// Credentials yield the login for the next request. Implementations re-read
// their source on every call, so a rotated password applies without a restart.
type Credentials interface {
	Login() (user, password string, err error)
}

// PasswordFile logs in as User with the trimmed contents of Path.
type PasswordFile struct {
	User string
	Path string
}

func (p PasswordFile) Login() (string, string, error) {
	data, err := os.ReadFile(p.Path)
	if err != nil {
		return "", "", fmt.Errorf("reading the password file: %w", err)
	}
	password := strings.TrimSpace(string(data))
	if password == "" {
		return "", "", fmt.Errorf("password file %s is empty", p.Path)
	}
	return p.User, password, nil
}

// Static is a fixed login, for one-shot commands handed CLICKHOUSE_PASSWORD.
type Static struct {
	User     string
	Password string
}

func (s Static) Login() (string, string, error) { return s.User, s.Password, nil }

// Error is an exception ClickHouse returned.
type Error struct {
	Code    int
	Message string
}

func (e *Error) Error() string { return fmt.Sprintf("clickhouse code %d: %s", e.Code, e.Message) }

// CodeUnknownTable is UNKNOWN_TABLE: a system log table not created yet.
const CodeUnknownTable = 60

// IsCode reports whether err is a ClickHouse exception with that code.
func IsCode(err error, code int) bool {
	var chErr *Error
	return errors.As(err, &chErr) && chErr.Code == code
}

// Client sends queries to one server's HTTP interface.
type Client struct {
	BaseURL string // http://host:8123
	Creds   Credentials
	HTTP    *http.Client
	// Timeout bounds each request; queries here are short (BACKUP runs ASYNC).
	Timeout time.Duration
}

// Exec runs a statement and discards its result.
func (c *Client) Exec(ctx context.Context, query string) error {
	body, err := c.do(ctx, query)
	if err != nil {
		return err
	}
	return body.Close()
}

// Rows runs query with FORMAT JSONEachRow and decodes each row into a T.
func Rows[T any](ctx context.Context, c *Client, query string) ([]T, error) {
	body, err := c.do(ctx, query+" FORMAT JSONEachRow")
	if err != nil {
		return nil, err
	}
	defer body.Close()
	var out []T
	scanner := bufio.NewScanner(body)
	scanner.Buffer(make([]byte, 64<<10), 4<<20)
	for scanner.Scan() {
		line := bytes.TrimSpace(scanner.Bytes())
		if len(line) == 0 {
			continue
		}
		var row T
		if err := json.Unmarshal(line, &row); err != nil {
			return nil, fmt.Errorf("decoding a row: %w", err)
		}
		out = append(out, row)
	}
	return out, scanner.Err()
}

func (c *Client) do(ctx context.Context, query string) (io.ReadCloser, error) {
	user, password, err := c.Creds.Login()
	if err != nil {
		return nil, err
	}
	timeout := c.Timeout
	if timeout == 0 {
		timeout = time.Minute
	}
	ctx, cancel := context.WithTimeout(ctx, timeout)
	// 64-bit integers as JSON numbers, not strings.
	params := url.Values{"output_format_json_quote_64bit_integers": {"0"}}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, strings.TrimRight(c.BaseURL, "/")+"/?"+params.Encode(), strings.NewReader(query))
	if err != nil {
		cancel()
		return nil, err
	}
	// Headers, not the URL: URLs end up in access logs.
	req.Header.Set("X-ClickHouse-User", user)
	req.Header.Set("X-ClickHouse-Key", password)
	httpClient := c.HTTP
	if httpClient == nil {
		httpClient = http.DefaultClient
	}
	resp, err := httpClient.Do(req)
	if err != nil {
		cancel()
		return nil, err
	}
	if resp.StatusCode != http.StatusOK || resp.Header.Get("X-ClickHouse-Exception-Code") != "" {
		defer cancel()
		defer resp.Body.Close()
		msg, _ := io.ReadAll(io.LimitReader(resp.Body, 8<<10))
		code, _ := strconv.Atoi(resp.Header.Get("X-ClickHouse-Exception-Code"))
		if code == 0 {
			code = parseCode(string(msg))
		}
		return nil, &Error{Code: code, Message: strings.TrimSpace(string(msg))}
	}
	return cancelOnClose{resp.Body, cancel}, nil
}

// parseCode reads "Code: 60. DB::Exception: ..." when the header is missing.
func parseCode(msg string) int {
	_, rest, ok := strings.Cut(msg, "Code: ")
	if !ok {
		return 0
	}
	end := strings.IndexFunc(rest, func(r rune) bool { return r < '0' || r > '9' })
	if end <= 0 {
		return 0
	}
	code, _ := strconv.Atoi(rest[:end])
	return code
}

type cancelOnClose struct {
	io.ReadCloser
	cancel context.CancelFunc
}

func (c cancelOnClose) Close() error {
	err := c.ReadCloser.Close()
	c.cancel()
	return err
}
