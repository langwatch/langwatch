package outboundsim

import (
	"fmt"
	"net/http"
	"strconv"
	"time"
)

// ChannelFeed records reads of the usage feeds a custom HTTP pull source polls.
const ChannelFeed = "feed"

const feedLength = 5

// feedEvents is a named feed's whole history: five priced calls an hour apart, ending at origin.
func feedEvents(name string, origin time.Time) []map[string]any {
	out := make([]map[string]any, 0, feedLength)
	for i := range feedLength {
		at := origin.Add(time.Duration(i-feedLength+1) * time.Hour)
		out = append(out, map[string]any{
			"id": fmt.Sprintf("%s-evt-%d", name, i+1), "timestamp": at.Format(time.RFC3339),
			"user": fmt.Sprintf("user%d@sim.feed.test", i%2+1), "action": "chat.completion",
			"model": "gpt-sim-mini", "cost_usd": "0.0125", "tokens_input": 120, "tokens_output": 48,
		})
	}
	return out
}

// handleFeed answers GET /feeds/{name}?cursor=<n>: the events after n and the cursor to send next.
// The bearer token picks the tenant as on the Databricks routes (empty, revoked, noscope, ...).
func (s *Server) handleFeed(w http.ResponseWriter, r *http.Request) {
	c, ok := readCall(w, r, ChannelFeed, r.URL.Path)
	if !ok {
		return
	}
	token := bearerOf(r)
	if token == "" {
		s.finish(w, c, jsonReply(http.StatusUnauthorized, map[string]string{"error": "missing bearer token"}))
		return
	}
	tenant := dbxTenantOf(token)
	if refusal, refused := dbxRefusal(tenant); refused {
		s.finish(w, c, refusal)
		return
	}
	events := feedEvents(r.PathValue("name"), s.databricks.origin)
	if tenant == dbxTenantEmpty {
		events = []map[string]any{}
	}
	from, _ := strconv.Atoi(r.URL.Query().Get("cursor"))
	from = min(max(from, 0), len(events))
	s.finish(w, c, jsonReply(http.StatusOK, map[string]any{
		"events": events[from:], "next_cursor": strconv.Itoa(len(events)),
	}))
}
