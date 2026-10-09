// Package orbstore keeps what the haven dev orb sends from a stack's app page:
// one JSON file per feedback item, and the page's latest console and network
// buffer. It lives in the stack's log directory, so `haven destroy` takes it.
package orbstore

import (
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"
	"time"
)

// MaxFeedback bounds the store: adding past it drops the oldest items.
const MaxFeedback = 200

// ErrNotFound is a feedback id the store does not hold.
var ErrNotFound = errors.New("no such feedback")

var idPattern = regexp.MustCompile(`^[0-9a-z]+$`)

// ConsoleEntry is one console call the page made, as text.
type ConsoleEntry struct {
	Level string `json:"level"`
	Text  string `json:"text"`
	At    string `json:"at"`
}

// Request is one fetch or XHR the page made. It has no room for a body, a
// header or a query string, so decoding drops any a client sent.
type Request struct {
	Method     string  `json:"method"`
	URL        string  `json:"url"`
	Status     int     `json:"status"`
	DurationMs float64 `json:"durationMs"`
	Failed     bool    `json:"failed"`
	At         string  `json:"at"`
}

// Box is a rectangle in the viewport's CSS pixels.
type Box struct {
	X      float64 `json:"x"`
	Y      float64 `json:"y"`
	Width  float64 `json:"width"`
	Height float64 `json:"height"`
}

// Target is the element a reader picked.
type Target struct {
	Selector string `json:"selector"`
	Tag      string `json:"tag"`
	Role     string `json:"role,omitempty"`
	Text     string `json:"text,omitempty"`
	Box      Box    `json:"box"`
}

// Page is the page's latest buffer, as the orb last pushed it.
type Page struct {
	URL     string         `json:"url"`
	At      string         `json:"at"`
	Console []ConsoleEntry `json:"console"`
	Network []Request      `json:"network"`
}

// Report is what a reader sent: a note on an element or a region, with the page's buffer.
type Report struct {
	Note     string  `json:"note"`
	Route    string  `json:"route"`
	Viewport Box     `json:"viewport"`
	Target   *Target `json:"target,omitempty"`
	Region   *Box    `json:"region,omitempty"`
	Page
}

// Feedback is one stored report.
type Feedback struct {
	ID         string `json:"id"`
	ReceivedAt string `json:"receivedAt"`
	ResolvedAt string `json:"resolvedAt,omitempty"`
	Report
}

// Open reports whether nobody has resolved the item yet.
func (f Feedback) Open() bool { return f.ResolvedAt == "" }

// Store is one stack's orb directory.
type Store struct{ dir string }

// At is the store under a stack's log directory; nothing is created until a write.
func At(logDir string) Store { return Store{dir: filepath.Join(logDir, "orb")} }

func (s Store) feedbackDir() string { return filepath.Join(s.dir, "feedback") }

// Add stores a report as a new open item and drops the oldest past MaxFeedback.
// The id is the receive time in base 36, padded so file order is arrival order.
func (s Store) Add(r Report, now time.Time) (Feedback, error) {
	id := strconv.FormatInt(now.UnixNano(), 36)
	item := Feedback{
		ID:         strings.Repeat("0", max(0, 13-len(id))) + id,
		ReceivedAt: now.UTC().Format(time.RFC3339Nano),
		Report:     r,
	}
	if err := s.write(item); err != nil {
		return Feedback{}, err
	}
	return item, s.prune()
}

// List answers every item, oldest first.
func (s Store) List() ([]Feedback, error) {
	names, err := s.ids()
	if err != nil {
		return nil, err
	}
	items := make([]Feedback, 0, len(names))
	for _, id := range names {
		item, err := s.Get(id)
		if err != nil {
			return nil, err
		}
		items = append(items, item)
	}
	return items, nil
}

// Get answers one item by id.
func (s Store) Get(id string) (Feedback, error) {
	if !idPattern.MatchString(id) {
		return Feedback{}, fmt.Errorf("%w: %q", ErrNotFound, id)
	}
	var item Feedback
	err := readJSON(filepath.Join(s.feedbackDir(), id+".json"), &item)
	if errors.Is(err, os.ErrNotExist) {
		return Feedback{}, fmt.Errorf("%w: %s", ErrNotFound, id)
	}
	return item, err
}

// Resolve marks an item done; resolving it again keeps the first time.
func (s Store) Resolve(id string, now time.Time) (Feedback, error) {
	item, err := s.Get(id)
	if err != nil || !item.Open() {
		return item, err
	}
	item.ResolvedAt = now.UTC().Format(time.RFC3339Nano)
	return item, s.write(item)
}

// SavePage replaces the page buffer.
func (s Store) SavePage(p Page) error { return writeJSON(filepath.Join(s.dir, "page.json"), p) }

// Page answers the latest page buffer, empty before the orb pushed one.
func (s Store) Page() (Page, error) {
	var p Page
	err := readJSON(filepath.Join(s.dir, "page.json"), &p)
	if errors.Is(err, os.ErrNotExist) {
		return Page{}, nil
	}
	return p, err
}

// ids answers the stored ids in file-name order, which is arrival order.
func (s Store) ids() ([]string, error) {
	entries, err := os.ReadDir(s.feedbackDir())
	if errors.Is(err, os.ErrNotExist) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	var ids []string
	for _, entry := range entries {
		if id, ok := strings.CutSuffix(entry.Name(), ".json"); ok {
			ids = append(ids, id)
		}
	}
	return ids, nil
}

func (s Store) write(item Feedback) error {
	return writeJSON(filepath.Join(s.feedbackDir(), item.ID+".json"), item)
}

func (s Store) prune() error {
	ids, err := s.ids()
	if err != nil {
		return err
	}
	for _, id := range ids[:max(0, len(ids)-MaxFeedback)] {
		if err := os.Remove(filepath.Join(s.feedbackDir(), id+".json")); err != nil {
			return err
		}
	}
	return nil
}

// writeJSON replaces path whole, so a reader never sees half a file.
func writeJSON(path string, v any) error {
	if err := os.MkdirAll(filepath.Dir(path), 0o700); err != nil {
		return err
	}
	data, err := json.MarshalIndent(v, "", "  ")
	if err != nil {
		return err
	}
	tmp := path + ".tmp"
	if err := os.WriteFile(tmp, data, 0o600); err != nil {
		return err
	}
	return os.Rename(tmp, path)
}

func readJSON(path string, into any) error {
	data, err := os.ReadFile(path)
	if err != nil {
		return err
	}
	return json.Unmarshal(data, into)
}
