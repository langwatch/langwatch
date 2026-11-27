package docsdeploy_test

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"reflect"
	"testing"

	"github.com/langwatch/langwatch/tools/docsdeploy"
)

func sitemapOf(entries ...[2]string) []byte {
	out := `<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">`
	for _, entry := range entries {
		out += "<url><loc>" + entry[0] + "</loc><lastmod>" + entry[1] + "</lastmod></url>"
	}

	return []byte(out + "</urlset>")
}

// @scenario "A deploy tells IndexNow which pages it changed"
func TestChangedPagesAreTheNewAndRedatedOnes(t *testing.T) {
	live := sitemapOf(
		[2]string{"https://langwatch.ai/docs/a", "2026-10-01"},
		[2]string{"https://langwatch.ai/docs/b", "2026-10-01"},
		[2]string{"https://langwatch.ai/docs/gone", "2026-10-01"},
	)
	built := sitemapOf(
		[2]string{"https://langwatch.ai/docs/a", "2026-10-01"},
		[2]string{"https://langwatch.ai/docs/b", "2026-11-02"},
		[2]string{"https://langwatch.ai/docs/new", "2026-11-02"},
	)
	got, err := docsdeploy.ChangedPages(live, built)
	if err != nil {
		t.Fatal(err)
	}
	want := []string{"https://langwatch.ai/docs/b", "https://langwatch.ai/docs/new"}
	if !reflect.DeepEqual(got, want) {
		t.Errorf("changed pages = %v, want %v", got, want)
	}
}

// @scenario "A deploy tells IndexNow which pages it changed"
func TestAFirstDeployNamesEveryPage(t *testing.T) {
	built := sitemapOf([2]string{"https://langwatch.ai/docs/a", "2026-10-01"})
	got, err := docsdeploy.ChangedPages(nil, built)
	if err != nil {
		t.Fatal(err)
	}
	if !reflect.DeepEqual(got, []string{"https://langwatch.ai/docs/a"}) {
		t.Errorf("a first deploy names %v", got)
	}
}

// @scenario "A deploy tells IndexNow which pages it changed"
func TestSubmitPostsTheKeyItsLocationAndThePages(t *testing.T) {
	var received map[string]any
	calls := 0
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		calls++
		_ = json.NewDecoder(r.Body).Decode(&received)
		w.WriteHeader(http.StatusAccepted)
	}))
	defer server.Close()
	n := docsdeploy.IndexNow{
		Endpoint:    server.URL,
		Key:         "abc123",
		KeyLocation: "https://langwatch.ai/docs/indexnow.txt",
		Client:      server.Client(),
	}
	if err := n.Submit(context.Background(), nil); err != nil || calls != 0 {
		t.Fatalf("no pages must send nothing: calls %d, err %v", calls, err)
	}
	if err := n.Submit(context.Background(), []string{"https://langwatch.ai/docs/a"}); err != nil {
		t.Fatal(err)
	}
	if received["host"] != "langwatch.ai" || received["key"] != "abc123" ||
		received["keyLocation"] != "https://langwatch.ai/docs/indexnow.txt" {
		t.Errorf("body = %v", received)
	}
	if list, _ := received["urlList"].([]any); len(list) != 1 || list[0] != "https://langwatch.ai/docs/a" {
		t.Errorf("urlList = %v", received["urlList"])
	}
}

// @scenario "A deploy tells IndexNow which pages it changed"
func TestSubmitReportsARefusal(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		http.Error(w, "key not valid", http.StatusForbidden)
	}))
	defer server.Close()
	n := docsdeploy.IndexNow{Endpoint: server.URL, Key: "k", KeyLocation: "https://langwatch.ai/docs/indexnow.txt", Client: server.Client()}
	if err := n.Submit(context.Background(), []string{"https://langwatch.ai/docs/a"}); err == nil {
		t.Error("a refused submission must be an error")
	}
}
