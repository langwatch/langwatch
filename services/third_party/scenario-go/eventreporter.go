package scenario

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/url"
	"os"
	"strconv"
	"sync"
	"time"
)

// Delivery policy, matching the JS event bus: three attempts in total with
// exponential backoff, no retry of permanent client errors.
const (
	eventMaxAttempts  = 3
	eventRetryBase    = 100 * time.Millisecond
	eventLogMaxChars  = 2000
	eventsAPIPath     = "/api/scenario-events"
	httpClientTimeout = 30 * time.Second
)

// eventReporter posts events to LangWatch.
type eventReporter struct {
	url       string
	apiKey    string
	projectID string
	client    *http.Client
	retryBase time.Duration
}

// ResolveLangWatch fills the empty fields of c from LANGWATCH_ENDPOINT,
// LANGWATCH_API_KEY and LANGWATCH_PROJECT_ID; the endpoint defaults to
// DefaultLangWatchEndpoint.
func ResolveLangWatch(c LangWatchConfig) LangWatchConfig { return resolveLangWatch(c) }

// resolveLangWatch fills empty fields from the environment.
func resolveLangWatch(cfgs ...LangWatchConfig) LangWatchConfig {
	var out LangWatchConfig
	for _, c := range cfgs {
		if out.Endpoint == "" {
			out.Endpoint = c.Endpoint
		}
		if out.APIKey == "" {
			out.APIKey = c.APIKey
		}
		if out.ProjectID == "" {
			out.ProjectID = c.ProjectID
		}
	}
	if out.Endpoint == "" {
		out.Endpoint = os.Getenv("LANGWATCH_ENDPOINT")
	}
	if out.Endpoint == "" {
		out.Endpoint = DefaultLangWatchEndpoint
	}
	if out.APIKey == "" {
		out.APIKey = os.Getenv("LANGWATCH_API_KEY")
	}
	if out.ProjectID == "" {
		out.ProjectID = os.Getenv("LANGWATCH_PROJECT_ID")
	}
	return out
}

func newEventReporter(lw LangWatchConfig) *eventReporter {
	r := &eventReporter{apiKey: lw.APIKey, projectID: lw.ProjectID, client: sharedHTTPClient(), retryBase: eventRetryBase}
	if base, err := url.Parse(lw.Endpoint); err == nil {
		r.url = base.ResolveReference(&url.URL{Path: eventsAPIPath}).String()
	}
	return r
}

func (r *eventReporter) enabled() bool { return r.apiKey != "" && r.url != "" }

var (
	httpClientOnce sync.Once
	httpClient     *http.Client
)

// sharedHTTPClient is one keep-alive client for all runs of the process.
func sharedHTTPClient() *http.Client {
	httpClientOnce.Do(func() {
		t := http.DefaultTransport.(*http.Transport).Clone()
		t.MaxIdleConns = 64
		t.MaxIdleConnsPerHost = 16
		t.IdleConnTimeout = 90 * time.Second
		httpClient = &http.Client{Transport: t, Timeout: httpClientTimeout}
	})
	return httpClient
}

// httpStatusError is a non-2xx response.
type httpStatusError struct {
	status int
	body   string
}

func (e *httpStatusError) Error() string {
	return "event POST failed with status " + strconv.Itoa(e.status) + ": " + e.body
}

// permanent reports a 4xx other than 408 and 429: retrying cannot succeed.
func (e *httpStatusError) permanent() bool {
	return e.status >= 400 && e.status < 500 && e.status != 408 && e.status != 429
}

// postWithRetry delivers one event, retrying transient failures, and returns
// the set URL of a RUN_STARTED response. An event that keeps failing is
// logged and dropped so it never blocks the events behind it.
func (r *eventReporter) postWithRetry(ctx context.Context, ev Event) string {
	var err error
	for attempt := 1; attempt <= eventMaxAttempts; attempt++ {
		var setURL string
		setURL, err = r.post(ctx, ev)
		if err == nil {
			return setURL
		}
		var se *httpStatusError
		if errors.As(err, &se) && se.permanent() {
			break
		}
		if attempt < eventMaxAttempts {
			logger().Warn("event delivery failed, retrying", "type", string(ev.Type), "attempt", attempt, "error", err.Error())
			time.Sleep(r.retryBase << (attempt - 1))
		}
	}
	logger().Error("dropping event after failed delivery", "type", string(ev.Type), "scenarioRunId", ev.ScenarioRunID, "error", err.Error(), "event", redactedEventSummary(ev.Payload))
	return ""
}

func (r *eventReporter) post(ctx context.Context, ev Event) (string, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, r.url, bytes.NewReader(ev.Payload))
	if err != nil {
		return "", err
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer "+r.apiKey)
	if r.projectID != "" {
		req.Header.Set("X-Project-Id", r.projectID)
	}
	resp, err := r.client.Do(req)
	if err != nil {
		return "", err
	}
	defer resp.Body.Close()
	if resp.StatusCode < 200 || resp.StatusCode > 299 {
		body, _ := io.ReadAll(io.LimitReader(resp.Body, 4096))
		return "", &httpStatusError{status: resp.StatusCode, body: string(body)}
	}
	if ev.Type != EventRunStarted {
		_, _ = io.Copy(io.Discard, resp.Body)
		return "", nil
	}
	// The server accepted the event; a body that does not parse is not a
	// delivery failure.
	var data struct {
		URL string `json:"url"`
	}
	_ = json.NewDecoder(io.LimitReader(resp.Body, 1<<20)).Decode(&data)
	return data.URL, nil
}

// redactedEventSummary shortens an event for a failure log: base64 runs of
// 200+ characters (audio) are elided and the text is capped.
func redactedEventSummary(payload []byte) string {
	out := make([]byte, 0, min(len(payload), eventLogMaxChars+64))
	for i := 0; i < len(payload); {
		j := i
		for j < len(payload) && isBase64Char(payload[j]) {
			j++
		}
		if j-i >= 200 {
			k := j
			for k < len(payload) && k-j < 2 && payload[k] == '=' {
				k++
			}
			out = append(out, "<audio:"...)
			out = strconv.AppendInt(out, int64(k-i), 10)
			out = append(out, " b64 chars elided>"...)
			i = k
		} else if j > i {
			out = append(out, payload[i:j]...)
			i = j
		} else {
			out = append(out, payload[i])
			i++
		}
		if len(out) > eventLogMaxChars*4 {
			break
		}
	}
	if len(out) > eventLogMaxChars {
		return string(out[:eventLogMaxChars]) + "... (" + strconv.Itoa(len(out)) + " chars, truncated)"
	}
	return string(out)
}

func isBase64Char(c byte) bool {
	return (c >= 'A' && c <= 'Z') || (c >= 'a' && c <= 'z') || (c >= '0' && c <= '9') || c == '+' || c == '/'
}
