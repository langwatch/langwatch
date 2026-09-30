package mailsim

import (
	"cmp"
	"context"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"slices"
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

// WaitFilter narrows a long poll: To and Subject as List does, and After, when
// set, to messages caught after that id (ids sort in arrival order).
type WaitFilter struct {
	To, Subject, After string
}

func (f WaitFilter) matches(m *Message) bool {
	return m.matches(f.To, f.Subject) && (f.After == "" || m.ID > f.After)
}

// waiter is one long-poll request parked on a filter until a matching
// message arrives, or its own context ends first.
type waiter struct {
	filter WaitFilter
	ch     chan *Message
}

// entry is a stored message with its match keys lowercased once, at arrival,
// so a scan never allocates.
type entry struct {
	msg     *Message
	seq     uint64
	to      []string
	subject string
}

// Store holds the newest caught messages, in arrival order, bounded at
// maxMessages (the oldest is evicted first), with an optional file backing
// so an agent restarting the backend mid-test does not lose the email it was
// about to assert on. Messages are indexed by id and by recipient address.
type Store struct {
	mu          sync.Mutex
	entries     []*entry // arrival order, oldest first
	byID        map[string]*entry
	byRecipient map[string][]*entry // lowercased address -> entries, oldest first
	waiters     []*waiter
	dataDir     string
	maxMessages int
	seq         uint64
}

// NewStore builds a store with the default cap; see NewBoundedStore.
func NewStore(dataDir string) (*Store, error) {
	return NewBoundedStore(dataDir, defaultMaxMessages)
}

// NewBoundedStore builds a store holding at most maxMessages, loading the
// newest already on disk when dataDir is set.
func NewBoundedStore(dataDir string, maxMessages int) (*Store, error) {
	st := &Store{dataDir: dataDir, maxMessages: maxMessages}
	st.reset()
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
	for _, msg := range loadMessages(dataDir, entries, maxMessages) {
		st.insert(msg)
	}
	return st, nil
}

func (st *Store) reset() {
	st.entries = nil
	st.byID = map[string]*entry{}
	st.byRecipient = map[string][]*entry{}
}

// insert indexes msg and returns the evicted message's id, or "" when nothing was.
func (st *Store) insert(msg *Message) (evicted string) {
	st.seq++
	e := &entry{msg: msg, seq: st.seq, subject: strings.ToLower(msg.Subject)}
	for _, addr := range msg.To {
		lower := strings.ToLower(addr)
		e.to = append(e.to, lower)
		st.byRecipient[lower] = append(st.byRecipient[lower], e)
	}
	st.entries = append(st.entries, e)
	st.byID[msg.ID] = e
	if len(st.entries) > st.maxMessages {
		oldest := st.entries[0]
		st.entries[0] = nil
		st.entries = st.entries[1:]
		st.unindex(oldest)
		return oldest.msg.ID
	}
	return ""
}

func (st *Store) unindex(e *entry) {
	delete(st.byID, e.msg.ID)
	for _, addr := range e.to {
		list := st.byRecipient[addr]
		if list[0] == e { // eviction takes the oldest, which heads its lists
			list[0], list = nil, list[1:]
		} else {
			list = slices.DeleteFunc(list, func(o *entry) bool { return o == e })
		}
		if len(list) == 0 {
			delete(st.byRecipient, addr)
		} else {
			st.byRecipient[addr] = list
		}
	}
}

// matches reports whether the entry satisfies the filters: an empty one always
// matches, a non-empty one is a case-insensitive substring match.
func (e *entry) matches(to, subject string) bool {
	if subject != "" && !strings.Contains(e.subject, subject) {
		return false
	}
	return to == "" || slices.ContainsFunc(e.to, func(a string) bool { return strings.Contains(a, to) })
}

// scan calls fn on every entry matching the filters, newest first, until fn
// returns false. A recipient filter walks the recipient index, not the inbox.
// Callers hold st.mu.
func (st *Store) scan(to, subject string, fn func(*entry) bool) {
	to, subject = strings.ToLower(to), strings.ToLower(subject)
	if to == "" {
		for i := len(st.entries) - 1; i >= 0; i-- {
			if e := st.entries[i]; e.matches("", subject) && !fn(e) {
				return
			}
		}
		return
	}
	var hits []*entry
	for addr, list := range st.byRecipient {
		if strings.Contains(addr, to) {
			hits = append(hits, list...)
		}
	}
	slices.SortFunc(hits, func(a, b *entry) int { return cmp.Compare(b.seq, a.seq) })
	hits = slices.CompactFunc(hits, func(a, b *entry) bool { return a == b })
	for _, e := range hits {
		if e.matches("", subject) && !fn(e) {
			return
		}
	}
}

// loadMessages reads the newest keep persisted messages back, in arrival order.
func loadMessages(dataDir string, entries []os.DirEntry, keep int) []*Message {
	names := make([]string, 0, len(entries))
	for _, e := range entries {
		if !e.IsDir() && strings.HasSuffix(e.Name(), ".json") {
			names = append(names, e.Name())
		}
	}
	sort.Strings(names) // ULID filenames sort in arrival order.
	names = names[max(0, len(names)-keep):]
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
	evicted := st.insert(msg)
	var matched []*waiter
	remaining := make([]*waiter, 0, len(st.waiters))
	for _, w := range st.waiters {
		if w.filter.matches(msg) {
			matched = append(matched, w)
		} else {
			remaining = append(remaining, w)
		}
	}
	st.waiters = remaining
	st.mu.Unlock()

	if evicted != "" {
		st.removeFile(evicted)
	}
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
	out := []Summary{}
	st.scan(to, subject, func(e *entry) bool {
		out = append(out, e.msg.Summary)
		return true
	})
	return out
}

// Get returns one message by id.
func (st *Store) Get(id string) (*Message, bool) {
	st.mu.Lock()
	defer st.mu.Unlock()
	if e, ok := st.byID[id]; ok {
		return e.msg, true
	}
	return nil, false
}

// Delete removes one message by id, from disk too when persistence is on.
func (st *Store) Delete(id string) bool {
	st.mu.Lock()
	e, ok := st.byID[id]
	if ok {
		st.entries = slices.DeleteFunc(st.entries, func(o *entry) bool { return o == e })
		st.unindex(e)
	}
	st.mu.Unlock()
	if ok {
		st.removeFile(e.msg.ID)
	}
	return ok
}

// removeFile unlinks a persisted message. It takes the stored id, never the
// caller's, so the store only removes a name it minted and a hostile id
// cannot traverse.
func (st *Store) removeFile(id string) {
	if st.dataDir != "" {
		_ = os.Remove(filepath.Join(st.dataDir, id+".json"))
	}
}

// Clear empties the inbox.
func (st *Store) Clear() {
	st.mu.Lock()
	st.reset()
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

// Wait blocks until a message matching the filter exists — one already
// caught, or the next one to arrive — or ctx ends first.
func (st *Store) Wait(ctx context.Context, filter WaitFilter) (*Message, bool) {
	st.mu.Lock()
	var found *Message
	st.scan(filter.To, filter.Subject, func(e *entry) bool {
		if filter.After != "" && e.msg.ID <= filter.After {
			return false // ids sort in arrival order: nothing older can match
		}
		found = e.msg
		return false
	})
	if found != nil {
		st.mu.Unlock()
		return found, true
	}
	w := &waiter{filter: filter, ch: make(chan *Message, 1)}
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
	st.waiters = slices.DeleteFunc(st.waiters, func(w *waiter) bool { return w == target })
}
