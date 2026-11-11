package docsdeploy

import (
	"bytes"
	"context"
	"encoding/json"
	"encoding/xml"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"sort"
)

// IndexNowEndpoint is the shared IndexNow API: Bing, Yandex, Seznam and
// Naver all read submissions made here.
const IndexNowEndpoint = "https://api.indexnow.org/indexnow"

// indexNowLimit is the most URLs one IndexNow request may carry.
const indexNowLimit = 10_000

type sitemap struct {
	URLs []struct {
		Loc     string `xml:"loc"`
		LastMod string `xml:"lastmod"`
	} `xml:"url"`
}

// sitemapDates reads a sitemap into each page's lastmod, keyed by its URL.
func sitemapDates(raw []byte) (map[string]string, error) {
	var parsed sitemap
	if len(bytes.TrimSpace(raw)) == 0 {
		return map[string]string{}, nil
	}
	if err := xml.Unmarshal(raw, &parsed); err != nil {
		return nil, fmt.Errorf("read sitemap: %w", err)
	}
	dates := make(map[string]string, len(parsed.URLs))
	for _, entry := range parsed.URLs {
		dates[entry.Loc] = entry.LastMod
	}

	return dates, nil
}

// ChangedPages lists, sorted, the pages of the built sitemap that the live
// one lacks or dates differently: the pages a deploy publishes anew. An
// empty live sitemap (a first deploy) names every page.
func ChangedPages(live, built []byte) ([]string, error) {
	before, err := sitemapDates(live)
	if err != nil {
		return nil, err
	}
	after, err := sitemapDates(built)
	if err != nil {
		return nil, err
	}
	changed := []string{}
	for page, date := range after {
		if previous, ok := before[page]; !ok || previous != date {
			changed = append(changed, page)
		}
	}
	sort.Strings(changed)

	return changed, nil
}

// IndexNow submits changed pages to an IndexNow endpoint for one host.
type IndexNow struct {
	Endpoint    string
	Key         string
	KeyLocation string
	Client      *http.Client
}

type indexNowBody struct {
	Host        string   `json:"host"`
	Key         string   `json:"key"`
	KeyLocation string   `json:"keyLocation"`
	URLList     []string `json:"urlList"`
}

// Submit sends the pages in requests of at most 10,000; no pages sends none.
func (n IndexNow) Submit(ctx context.Context, pages []string) error {
	if len(pages) == 0 {
		return nil
	}
	location, err := url.Parse(n.KeyLocation)
	if err != nil {
		return fmt.Errorf("key location: %w", err)
	}
	for start := 0; start < len(pages); start += indexNowLimit {
		batch := pages[start:min(start+indexNowLimit, len(pages))]
		body := indexNowBody{Host: location.Host, Key: n.Key, KeyLocation: n.KeyLocation, URLList: batch}
		if err := n.post(ctx, body); err != nil {
			return err
		}
	}

	return nil
}

func (n IndexNow) post(ctx context.Context, body indexNowBody) error {
	payload, err := json.Marshal(body)
	if err != nil {
		return err
	}
	request, err := http.NewRequestWithContext(ctx, http.MethodPost, n.Endpoint, bytes.NewReader(payload))
	if err != nil {
		return err
	}
	request.Header.Set("Content-Type", "application/json; charset=utf-8")
	response, err := n.Client.Do(request)
	if err != nil {
		return fmt.Errorf("indexnow: %w", err)
	}
	defer response.Body.Close()
	if response.StatusCode != http.StatusOK && response.StatusCode != http.StatusAccepted {
		detail, _ := io.ReadAll(io.LimitReader(response.Body, 512))

		return fmt.Errorf("indexnow answered %s: %s", response.Status, bytes.TrimSpace(detail))
	}

	return nil
}
