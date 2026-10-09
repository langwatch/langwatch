package orbstore

import (
	"errors"
	"testing"
	"time"
)

// @scenario "an agent resolves feedback"
func TestResolveClosesAnItemOnce(t *testing.T) {
	store := At(t.TempDir())
	item, err := store.Add(Report{Note: "label overlaps the icon"}, time.Unix(10, 0))
	if err != nil {
		t.Fatal(err)
	}
	first, err := store.Resolve(item.ID, time.Unix(20, 0))
	if err != nil || first.Open() {
		t.Fatalf("resolve: %+v, %v", first, err)
	}
	again, _ := store.Resolve(item.ID, time.Unix(30, 0))
	if again.ResolvedAt != first.ResolvedAt {
		t.Fatalf("second resolve moved the time: %s -> %s", first.ResolvedAt, again.ResolvedAt)
	}
}

func TestAddDropsTheOldestPastTheBound(t *testing.T) {
	store := At(t.TempDir())
	for i := range MaxFeedback + 3 {
		if _, err := store.Add(Report{Note: "n"}, time.Unix(int64(i+1), 0)); err != nil {
			t.Fatal(err)
		}
	}
	items, err := store.List()
	if err != nil || len(items) != MaxFeedback {
		t.Fatalf("got %d items, %v", len(items), err)
	}
	if want := time.Unix(4, 0).UTC().Format(time.RFC3339Nano); items[0].ReceivedAt != want {
		t.Fatalf("oldest kept is %s, want %s", items[0].ReceivedAt, want)
	}
}

func TestGetRefusesAPathForAnID(t *testing.T) {
	if _, err := At(t.TempDir()).Get("../../etc/passwd"); !errors.Is(err, ErrNotFound) {
		t.Fatalf("got %v, want ErrNotFound", err)
	}
}

func TestPageIsEmptyBeforeThePushAndRoundTripsAfter(t *testing.T) {
	store := At(t.TempDir())
	if page, err := store.Page(); err != nil || page.URL != "" {
		t.Fatalf("empty store: %+v, %v", page, err)
	}
	want := Page{URL: "https://app.feat-x.langwatch.localhost/", Network: []Request{{Method: "GET", Status: 500, Failed: true}}}
	if err := store.SavePage(want); err != nil {
		t.Fatal(err)
	}
	got, err := store.Page()
	if err != nil || got.URL != want.URL || len(got.Network) != 1 {
		t.Fatalf("got %+v, %v", got, err)
	}
}
