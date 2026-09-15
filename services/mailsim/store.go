package mailsim

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"sync"
	"time"

	"github.com/oklog/ulid/v2"
)

// AttachmentInfo is what an attachment publishes over the wire — never its
// bytes, since nothing in the API serves attachment content back.
type AttachmentInfo struct {
	Filename    string `json:"filename"`
	ContentType string `json:"contentType"`
	SizeBytes   int    `json:"sizeBytes"`
}

// Summary is a message as it appears in a list — enough to pick one out
// without fetching its bodies.
type Summary struct {
	ID         string    `json:"id"`
	From       string    `json:"from"`
	To         []string  `json:"to"`
	Subject    string    `json:"subject"`
	ReceivedAt time.Time `json:"receivedAt"`
	SizeBytes  int       `json:"sizeBytes"`
}

// Message is a caught message in full.
type Message struct {
	Summary
	Headers     map[string]string `json:"headers"`
	Text        string            `json:"text"`
	HTML        string            `json:"html"`
	Links       []string          `json:"links"`
	Attachments []AttachmentInfo  `json:"attachments"`
}

// matches reports whether the message satisfies both filters. An empty filter
// always matches; a non-empty one is a case-insensitive substring match.
func (m *Message) matches(to, subject string) bool {
	if subject != "" && !strings.Contains(strings.ToLower(m.Subject), strings.ToLower(subject)) {
		return false
	}
	if to == "" {
		return true
	}
	needle := strings.ToLower(to)
	for _, addr := range m.To {
		if strings.Contains(strings.ToLower(addr), needle) {
			return true
		}
	}
	return false
}

// waiter is one long-poll request parked on a filter until a matching
// message arrives, or its own context ends first.
type waiter struct {
	to, subject string
	ch          chan *Message
}

// Store holds every caught message, in arrival order, with an optional file
// backing so an agent restarting the backend mid-test does not lose the
// email it was about to assert on.
type Store struct {
	mu       sync.Mutex
	messages []*Message
	waiters  []*waiter
	dataDir  string
}

// NewStore builds a store, loading any messages already on disk when dataDir
// is set.
func NewStore(dataDir string) (*Store, error) {
	st := &Store{dataDir: dataDir}
	if dataDir == "" {
		return st, nil
	}
	if err := os.MkdirAll(dataDir, 0o750); err != nil {
		return nil, fmt.Errorf("creating mailsim data dir %s: %w", dataDir, err)
	}
	entries, err := os.ReadDir(dataDir)
	if err != nil {
		return nil, fmt.Errorf("reading mailsim data dir %s: %w", dataDir, err)
	}
	st.messages = loadMessages(dataDir, entries)
	return st, nil
}

// loadMessages reads every persisted message back, in arrival order.
func loadMessages(dataDir string, entries []os.DirEntry) []*Message {
	names := make([]string, 0, len(entries))
	for _, e := range entries {
		if !e.IsDir() && strings.HasSuffix(e.Name(), ".json") {
			names = append(names, e.Name())
		}
	}
	sort.Strings(names) // ULID filenames sort in arrival order.
	messages := make([]*Message, 0, len(names))
	for _, name := range names {
		raw, err := os.ReadFile(filepath.Join(dataDir, name))
		if err != nil {
			continue // A partially-written file from a crash is skipped, not fatal.
		}
		var msg Message
		if err := json.Unmarshal(raw, &msg); err != nil {
			continue
		}
		messages = append(messages, &msg)
	}
	return messages
}

// newID mints a lexically sortable message id.
func newID() string {
	return ulid.Make().String()
}

// Deliver records a freshly caught message, persists it when a data
// directory is configured, and wakes any waiter it satisfies.
func (st *Store) Deliver(msg *Message) error {
	if msg.ID == "" {
		msg.ID = newID()
	}
	st.mu.Lock()
	st.messages = append(st.messages, msg)
	var matched []*waiter
	remaining := make([]*waiter, 0, len(st.waiters))
	for _, w := range st.waiters {
		if msg.matches(w.to, w.subject) {
			matched = append(matched, w)
		} else {
			remaining = append(remaining, w)
		}
	}
	st.waiters = remaining
	st.mu.Unlock()

	for _, w := range matched {
		w.ch <- msg
	}
	return st.persist(msg)
}

func (st *Store) persist(msg *Message) error {
	if st.dataDir == "" {
		return nil
	}
	raw, err := json.Marshal(msg)
	if err != nil {
		return fmt.Errorf("encoding message %s: %w", msg.ID, err)
	}
	path := filepath.Join(st.dataDir, msg.ID+".json")
	tmp := path + ".tmp"
	if err := os.WriteFile(tmp, raw, 0o600); err != nil {
		return fmt.Errorf("writing message %s: %w", msg.ID, err)
	}
	return os.Rename(tmp, path)
}

// List returns matching messages, newest first.
func (st *Store) List(to, subject string) []Summary {
	st.mu.Lock()
	defer st.mu.Unlock()
	out := make([]Summary, 0, len(st.messages))
	for i := len(st.messages) - 1; i >= 0; i-- {
		if st.messages[i].matches(to, subject) {
			out = append(out, st.messages[i].Summary)
		}
	}
	return out
}

// Get returns one message by id.
func (st *Store) Get(id string) (*Message, bool) {
	st.mu.Lock()
	defer st.mu.Unlock()
	for _, m := range st.messages {
		if m.ID == id {
			return m, true
		}
	}
	return nil, false
}

// Delete removes one message by id, from disk too when persistence is on.
func (st *Store) Delete(id string) bool {
	st.mu.Lock()
	defer st.mu.Unlock()
	for i, m := range st.messages {
		if m.ID == id {
			st.messages = append(st.messages[:i], st.messages[i+1:]...)
			if st.dataDir != "" {
				// m.ID, not the caller's id: the store only ever unlinks a
				// name it minted itself, so a hostile id cannot traverse.
				_ = os.Remove(filepath.Join(st.dataDir, m.ID+".json"))
			}
			return true
		}
	}
	return false
}

// Clear empties the inbox.
func (st *Store) Clear() {
	st.mu.Lock()
	st.messages = nil
	st.mu.Unlock()
	if st.dataDir == "" {
		return
	}
	entries, err := os.ReadDir(st.dataDir)
	if err != nil {
		return
	}
	for _, e := range entries {
		if !e.IsDir() && strings.HasSuffix(e.Name(), ".json") {
			_ = os.Remove(filepath.Join(st.dataDir, e.Name()))
		}
	}
}

// Wait blocks until a message matching both filters exists — one already
// caught, or the next one to arrive — or ctx ends first.
func (st *Store) Wait(ctx context.Context, to, subject string) (*Message, bool) {
	st.mu.Lock()
	for i := len(st.messages) - 1; i >= 0; i-- {
		if st.messages[i].matches(to, subject) {
			m := st.messages[i]
			st.mu.Unlock()
			return m, true
		}
	}
	w := &waiter{to: to, subject: subject, ch: make(chan *Message, 1)}
	st.waiters = append(st.waiters, w)
	st.mu.Unlock()

	select {
	case m := <-w.ch:
		return m, true
	case <-ctx.Done():
		st.removeWaiter(w)
		return nil, false
	}
}

func (st *Store) removeWaiter(target *waiter) {
	st.mu.Lock()
	defer st.mu.Unlock()
	for i, w := range st.waiters {
		if w == target {
			st.waiters = append(st.waiters[:i], st.waiters[i+1:]...)
			return
		}
	}
}
