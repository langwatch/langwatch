package docsdeploy_test

import (
	"bytes"
	"context"
	"errors"
	"slices"
	"strings"
	"testing"

	"github.com/langwatch/langwatch/tools/docsdeploy"
)

// The shapes the docs build's redirects.json uses: exact sources, export
// sources, internal and external patterns, with a pattern before an exact one.
const fixture = `{
  "/old": "/new",
  "/guardrails/:path*": "/evaluations/guardrails/overview",
  "/old.md": "/new.md",
  "/one/:id/edit": "/two/:id",
  "/langevals/:path*": "https://github.com/langwatch/langevals"
}`

// @scenario "The deploy writes the build's redirects into the edge's redirect store"
func TestItemsKeysExactSourcesAndListsPatternsInFileOrder(t *testing.T) {
	items, err := docsdeploy.Items([]byte(fixture))
	if err != nil {
		t.Fatal(err)
	}
	want := []docsdeploy.Item{
		{Key: "/old", Value: "/new"},
		{Key: "/old.md", Value: "/new.md"},
		{Key: docsdeploy.PatternsKey, Value: `[["/guardrails/:path*","/evaluations/guardrails/overview"],["/one/:id/edit","/two/:id"],["/langevals/:path*","https://github.com/langwatch/langevals"]]`},
	}
	if !slices.Equal(items, want) {
		t.Errorf("Items = %v\nwant    %v", items, want)
	}
}

// @scenario "The deploy writes the build's redirects into the edge's redirect store"
func TestItemsRefusesWhatTheStoreCannotHold(t *testing.T) {
	long := `{"/` + strings.Repeat("a", 600) + `": "/new"}`
	for name, raw := range map[string]string{
		"a key over 512 bytes": long,
		"not an object":        `["/old", "/new"]`,
		"a number destination": `{"/old": 1}`,
	} {
		if _, err := docsdeploy.Items([]byte(raw)); err == nil {
			t.Errorf("%s: Items accepted it", name)
		}
	}
}

// @scenario "The deploy writes the build's redirects into the edge's redirect store"
func TestPublishWritesOnlyWhatChangedThenDeletesWhatIsGone(t *testing.T) {
	store := &fakeStore{etag: "e0", keys: []docsdeploy.Item{
		{Key: "/old", Value: "/new"},
		{Key: "/gone", Value: "/elsewhere"},
		{Key: docsdeploy.PatternsKey, Value: "[]"},
	}}
	want, err := docsdeploy.Items([]byte(fixture))
	if err != nil {
		t.Fatal(err)
	}
	var log bytes.Buffer
	if err := (docsdeploy.Publisher{Store: store, Log: &log}).Publish(context.Background(), want); err != nil {
		t.Fatal(err)
	}
	if len(store.updates) != 2 {
		t.Fatalf("updates = %v, want one write and then one delete", store.updates)
	}
	puts := []string{}
	for _, it := range store.updates[0].Puts {
		puts = append(puts, it.Key)
	}
	if !slices.Equal(puts, []string{"/old.md", docsdeploy.PatternsKey}) || len(store.updates[0].Deletes) != 0 {
		t.Errorf("first update = %v, want the new and changed keys only", store.updates[0])
	}
	if !slices.Equal(store.updates[1].Deletes, []string{"/gone"}) || len(store.updates[1].Puts) != 0 {
		t.Errorf("second update = %v, want the key the build dropped", store.updates[1])
	}
	if !slices.Equal(store.etags, []string{"e0", "e1"}) {
		t.Errorf("updates were made against %v, want each against the version before it", store.etags)
	}
	if got := log.String(); got != "3 redirect keys: 2 to write, 1 to delete\n" {
		t.Errorf("log = %q", got)
	}
}

// @scenario "The deploy writes the build's redirects into the edge's redirect store"
func TestPublishLeavesAnUnchangedStoreAlone(t *testing.T) {
	want, _ := docsdeploy.Items([]byte(fixture))
	store := &fakeStore{etag: "e0", keys: want}
	if err := (docsdeploy.Publisher{Store: store, Log: &bytes.Buffer{}}).Publish(context.Background(), want); err != nil {
		t.Fatal(err)
	}
	if len(store.updates) != 0 {
		t.Errorf("an unchanged store was updated: %v", store.updates)
	}
}

// @scenario "The deploy writes the build's redirects into the edge's redirect store"
func TestBatchesHoldAtMostFiftyKeysAndWriteBeforeDeleting(t *testing.T) {
	c := docsdeploy.Change{}
	for i := range 120 {
		c.Puts = append(c.Puts, docsdeploy.Item{Key: string(rune('a' + i%26)), Value: "/x"})
	}
	c.Deletes = []string{"/a", "/b"}
	sizes := []int{}
	for _, b := range c.Batches() {
		if len(b.Puts) > 0 && len(b.Deletes) > 0 {
			t.Fatal("a batch both writes and deletes")
		}
		sizes = append(sizes, len(b.Puts)+len(b.Deletes))
	}
	if !slices.Equal(sizes, []int{50, 50, 20, 2}) {
		t.Errorf("batch sizes = %v, want [50 50 20 2]", sizes)
	}
}

// @scenario "The deploy writes the build's redirects into the edge's redirect store"
func TestPublishStopsAtAFailedUpdate(t *testing.T) {
	want, _ := docsdeploy.Items([]byte(fixture))
	store := &fakeStore{etag: "e0", updateErr: errors.New("PreconditionFailed")}
	if err := (docsdeploy.Publisher{Store: store, Log: &bytes.Buffer{}}).Publish(context.Background(), want); err == nil {
		t.Fatal("Publish ignored a refused update")
	}
}

type fakeStore struct {
	etag      string
	keys      []docsdeploy.Item
	updates   []docsdeploy.Change
	etags     []string
	described bool
	updateErr error
}

func (s *fakeStore) ETag(context.Context) (string, error) {
	s.described = true
	return s.etag, nil
}

func (s *fakeStore) List(context.Context) ([]docsdeploy.Item, error) { return s.keys, nil }

func (s *fakeStore) Update(_ context.Context, etag string, c docsdeploy.Change) (string, error) {
	if s.updateErr != nil {
		return "", s.updateErr
	}
	s.etags = append(s.etags, etag)
	s.updates = append(s.updates, c)
	s.etag = "e" + string(rune('0'+len(s.updates)))

	return s.etag, nil
}
