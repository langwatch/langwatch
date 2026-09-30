// Package mailsim is a local mail sink: it catches every message the stack
// sends over SMTP, stores it, and relays nothing anywhere. See the package
// README for the full shape.
package mailsim

import (
	"fmt"
	"os"
	"strconv"
)

// defaultMaxMessageBytes is the size cap applied when MAILSIM_MAX_MESSAGE_BYTES
// is unset — 10 MiB, generous for a verification email with an attachment.
const defaultMaxMessageBytes = 10 * 1024 * 1024

// defaultMaxMessages bounds the inbox when MAILSIM_MAX_MESSAGES is unset.
const defaultMaxMessages = 10000

// Config is mailsim's environment-derived configuration.
type Config struct {
	// HTTPAddr is the HTTP API and browser inbox listen address
	// (MAILSIM_HTTP_ADDR, default :5580).
	HTTPAddr string
	// SMTPAddr is the SMTP listen address (MAILSIM_SMTP_ADDR, default :5581).
	SMTPAddr string
	// BaseURL is the externally reachable base the inbox uses to render links
	// (MAILSIM_BASE_URL). Standalone it defaults to http://localhost:<port>.
	BaseURL string
	// DataDir is where messages persist as files (MAILSIM_DATA_DIR). Empty
	// means in-memory only — the inbox empties whenever the process restarts.
	DataDir string
	// MaxMessageBytes is the size cap a single message may not exceed
	// (MAILSIM_MAX_MESSAGE_BYTES, default 10485760).
	MaxMessageBytes int64
	// MaxMessages is how many messages the inbox keeps; the oldest is evicted
	// first (MAILSIM_MAX_MESSAGES, default 10000).
	MaxMessages int
	// Seed delivers a few sample messages at start (MAILSIM_SEED=1).
	Seed bool
}

// LoadConfig reads mailsim's configuration from the environment.
func LoadConfig() (Config, error) {
	cfg := Config{
		HTTPAddr: envOr("MAILSIM_HTTP_ADDR", ":5580"),
		SMTPAddr: envOr("MAILSIM_SMTP_ADDR", ":5581"),
		DataDir:  os.Getenv("MAILSIM_DATA_DIR"),
	}
	cfg.BaseURL = envOr("MAILSIM_BASE_URL", defaultBaseURL(cfg.HTTPAddr))

	cfg.MaxMessageBytes = defaultMaxMessageBytes
	if raw := os.Getenv("MAILSIM_MAX_MESSAGE_BYTES"); raw != "" {
		n, err := strconv.ParseInt(raw, 10, 64)
		if err != nil || n < 1 {
			return Config{}, fmt.Errorf("MAILSIM_MAX_MESSAGE_BYTES must be a positive integer, got %q", raw)
		}
		cfg.MaxMessageBytes = n
	}
	cfg.MaxMessages = defaultMaxMessages
	if raw := os.Getenv("MAILSIM_MAX_MESSAGES"); raw != "" {
		n, err := strconv.Atoi(raw)
		if err != nil || n < 1 {
			return Config{}, fmt.Errorf("MAILSIM_MAX_MESSAGES must be a positive integer, got %q", raw)
		}
		cfg.MaxMessages = n
	}
	cfg.Seed = os.Getenv("MAILSIM_SEED") == "1"
	return cfg, nil
}

func defaultBaseURL(addr string) string {
	port := addr
	if idx := lastColon(addr); idx >= 0 {
		port = addr[idx+1:]
	}
	return "http://localhost:" + port
}

func lastColon(s string) int {
	for i := len(s) - 1; i >= 0; i-- {
		if s[i] == ':' {
			return i
		}
	}
	return -1
}

func envOr(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}
