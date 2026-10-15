package orbstore

import (
	"encoding/base64"
	"errors"
	"os"
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

// @scenario "haven stores the capture beside the note"
func TestAddStoresTheCaptureAsAPNGBesideTheNote(t *testing.T) {
	store := At(t.TempDir())
	png := []byte("\x89PNG\r\n\x1a\nfake")
	item, err := store.Add(Report{Note: "n", Image: pngDataURL + base64.StdEncoding.EncodeToString(png)}, time.Unix(1, 0))
	if err != nil {
		t.Fatal(err)
	}
	stored, err := os.ReadFile(item.Screenshot)
	if err != nil || string(stored) != string(png) {
		t.Fatalf("screenshot %q: %q, %v", item.Screenshot, stored, err)
	}
	got, err := store.Get(item.ID)
	if err != nil || got.Image != "" || got.Screenshot != item.Screenshot {
		t.Fatalf("the note keeps the data URL or loses the path: %+v, %v", got, err)
	}
}

func TestAddRefusesAnImageThatIsNotAPNG(t *testing.T) {
	store := At(t.TempDir())
	for _, image := range []string{"data:image/svg+xml;base64,PHN2Zy8+", pngDataURL + base64.StdEncoding.EncodeToString([]byte("<svg/>"))} {
		if _, err := store.Add(Report{Note: "n", Image: image}, time.Unix(1, 0)); !errors.Is(err, ErrBadImage) {
			t.Fatalf("%s: got %v, want ErrBadImage", image, err)
		}
	}
	if items, _ := store.List(); len(items) != 0 {
		t.Fatalf("stored %d items from refused posts", len(items))
	}
}
