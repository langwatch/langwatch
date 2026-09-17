package dashboard

import (
	_ "embed"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"os"
	"sort"
	"strings"
	"time"

	"github.com/charmbracelet/x/ansi"

	"github.com/langwatch/langwatch/tools/thuishaven/domain"
	"github.com/langwatch/langwatch/tools/thuishaven/domain/logfmt"
)

const logTailBytes = 128 << 10
const logTailLines = 1000

var errLogDirectory = errors.New("invalid log directory")

//go:embed logs.js
var logsJS string

func serveLogsScript(w http.ResponseWriter, _ *http.Request) {
	w.Header().Set("Content-Type", "text/javascript; charset=utf-8")
	w.Header().Set("Cache-Control", "no-cache")
	_, _ = io.WriteString(w, logsJS)
}

type logLine struct {
	At      time.Time `json:"at"`
	Service string    `json:"service"`
	Level   string    `json:"level"`
	Text    string    `json:"text"`
}

func (s *Server) handleLogs(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Cache-Control", "no-store")
	w.Header().Set("X-Content-Type-Options", "nosniff")
	slug := r.URL.Query().Get("stack")
	if !s.knownLogStack(slug) {
		http.Error(w, "unknown stack", http.StatusNotFound)
		return
	}
	if s.config.LogDir == "" {
		http.Error(w, "log capture is not configured", http.StatusServiceUnavailable)
		return
	}
	lines, services, err := s.readStackLogs(slug, r.URL.Query().Get("service"))
	if errors.Is(err, errLogDirectory) {
		http.Error(w, "invalid log directory", http.StatusBadRequest)
		return
	}
	if err != nil && !errors.Is(err, os.ErrNotExist) {
		http.Error(w, "could not read captured logs", http.StatusInternalServerError)
		return
	}
	if lines == nil {
		lines = []logLine{}
	}
	if services == nil {
		services = []string{}
	}
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(struct {
		Lines    []logLine `json:"lines"`
		Services []string  `json:"services"`
		Limit    int       `json:"limit"`
	}{lines, services, logTailLines})
}

func (s *Server) knownLogStack(slug string) bool {
	if !domain.ValidSlug(slug) {
		return false
	}
	stacks := s.config.Stacks()
	for i := range stacks {
		if stacks[i].Slug == slug {
			return true
		}
	}
	return false
}

func (s *Server) readStackLogs(slug, selected string) ([]logLine, []string, error) {
	home, err := os.OpenRoot(s.config.LogDir)
	if err != nil {
		return nil, nil, err
	}
	defer func() { _ = home.Close() }()
	info, err := home.Lstat(slug)
	if err != nil {
		return nil, nil, err
	}
	if !info.IsDir() {
		return nil, nil, errLogDirectory
	}
	root, err := home.OpenRoot(slug)
	if err != nil {
		return nil, nil, err
	}
	defer func() { _ = root.Close() }()
	return readLogTail(root, selected)
}

func captureNames(root *os.Root) ([]string, error) {
	dir, err := root.Open(".")
	if err != nil {
		return nil, err
	}
	defer func() { _ = dir.Close() }()
	entries, err := dir.ReadDir(-1)
	if err != nil {
		return nil, err
	}
	var names []string
	for _, entry := range entries {
		name, ok := strings.CutSuffix(entry.Name(), ".log")
		if ok && entry.Type().IsRegular() {
			names = append(names, name)
		}
	}
	sort.Strings(names)
	return names, nil
}

func readLogTail(root *os.Root, selected string) ([]logLine, []string, error) {
	services, err := captureNames(root)
	if err != nil {
		return nil, nil, err
	}
	var lines []logLine
	for _, name := range services {
		if selected != "" && selected != name {
			continue
		}
		part, readErr := readServiceTail(root, name)
		if readErr != nil {
			return nil, nil, readErr
		}
		lines = append(lines, part...)
	}
	sort.SliceStable(lines, func(i, j int) bool { return lines[i].At.Before(lines[j].At) })
	if len(lines) > logTailLines {
		lines = lines[len(lines)-logTailLines:]
	}
	return lines, services, nil
}

func readServiceTail(root *os.Root, service string) ([]logLine, error) {
	file, err := root.Open(service + ".log")
	if err != nil {
		return nil, err
	}
	defer func() { _ = file.Close() }()
	return readCaptureTail(file, service)
}

func readCaptureTail(file *os.File, service string) ([]logLine, error) {
	info, err := file.Stat()
	if err != nil {
		return nil, err
	}
	start := max(int64(0), info.Size()-logTailBytes)
	if _, err := file.Seek(start, io.SeekStart); err != nil {
		return nil, err
	}
	data, err := io.ReadAll(io.LimitReader(file, logTailBytes))
	if err != nil {
		return nil, err
	}
	text := string(data)
	if start > 0 {
		_, text, _ = strings.Cut(text, "\n")
	}
	return parseCaptureLines(text, service), nil
}

func parseCaptureLines(text, service string) []logLine {
	complete := strings.LastIndexByte(text, '\n') + 1
	var lines []logLine
	for _, raw := range strings.Split(text[:complete], "\n") {
		stamp, body, ok := strings.Cut(raw, " ")
		if !ok {
			continue
		}
		at, err := time.Parse(time.RFC3339Nano, stamp)
		if err != nil {
			continue
		}
		level := ""
		if record, ok := logfmt.Parse(body); ok {
			level = string(record.Level)
		}
		lines = append(lines, logLine{At: at, Service: service, Level: level, Text: ansi.Strip(body)})
	}
	return lines
}
