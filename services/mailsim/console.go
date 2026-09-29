package mailsim

import (
	"embed"
	"io/fs"
	"net/http"
	"net/url"
	"strings"

	"github.com/langwatch/langwatch/pkg/webconsole"
)

// consoleBuildCommand is what the not-built page tells a developer to run.
const consoleBuildCommand = "pnpm --filter @langwatch/mailsim-web build"

// consoleFiles is apps/mailsim-web's Vite build (ADR-160). Only web/dist/.gitkeep
// is committed, so a binary built before the bundle embeds no index.html and
// serves the not-built page instead.
//
//go:embed all:web/dist
var consoleFiles embed.FS

// embeddedConsole is the bundle this binary was built with.
func embeddedConsole() fs.FS {
	bundle, err := fs.Sub(consoleFiles, "web/dist")
	if err != nil {
		panic(err) // the path is a constant that go:embed has already resolved
	}
	return bundle
}

func newConsole(bundle fs.FS) http.Handler {
	return webconsole.New(bundle, consoleBuildCommand)
}

// handleConsole serves the inbox bundle at every non-API path, /messages/{id}
// included, under the inbox's own security policy.
func (s *Server) handleConsole(w http.ResponseWriter, r *http.Request) {
	setUIHeaders(w)
	s.console.ServeHTTP(w, r)
}

// inboxInfo is what the inbox page says about itself: which stack it belongs
// to, where mail is sent, and whether it survives a restart.
type inboxInfo struct {
	Stack      string `json:"stack"`
	SMTPAddr   string `json:"smtpAddr"`
	BaseURL    string `json:"baseUrl"`
	Persistent bool   `json:"persistent"`
}

func (s *Server) handleInbox(w http.ResponseWriter, _ *http.Request) {
	setAPIHeaders(w)
	writeJSON(w, http.StatusOK, s.inboxInfo())
}

// inboxInfo names the stack from a mail.<slug>.langwatch.localhost base URL;
// a standalone sink has no stack and answers "".
func (s *Server) inboxInfo() inboxInfo {
	stack := ""
	if origin, err := url.Parse(s.cfg.BaseURL); err == nil {
		host := origin.Hostname()
		if strings.HasPrefix(host, "mail.") && strings.HasSuffix(host, ".langwatch.localhost") {
			stack = strings.TrimSuffix(strings.TrimPrefix(host, "mail."), ".langwatch.localhost")
		}
	}
	smtpAddr := s.cfg.SMTPAddr
	if strings.HasPrefix(smtpAddr, ":") {
		smtpAddr = "127.0.0.1" + smtpAddr
	}
	return inboxInfo{Stack: stack, SMTPAddr: smtpAddr, BaseURL: s.cfg.BaseURL, Persistent: s.cfg.DataDir != ""}
}
