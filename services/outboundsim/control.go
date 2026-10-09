package outboundsim

import (
	"encoding/json"
	"errors"
	"net/http"
	"time"
)

// consoleStatus is what the console header says about this simulator.
type consoleStatus struct {
	Stack    string   `json:"stack"`
	Records  int      `json:"records"`
	Faults   int      `json:"faults"`
	BaseURL  string   `json:"baseUrl"`
	Activity Activity `json:"activity"`
}

func (s *Server) handleStatus(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, consoleStatus{
		Stack: s.cfg.Stack, Records: s.records.count(), Faults: s.faults.count(), BaseURL: baseURL(r),
		Activity: s.records.activity(s.now().Add(-activityWindow)),
	})
}

// handleSetup lists the URLs to paste into the product for each receiver, Slack and the queue.
func (s *Server) handleSetup(w http.ResponseWriter, r *http.Request) {
	base := baseURL(r)
	hooks := map[string]string{}
	for _, info := range s.receivers.list() {
		hooks[info.Name] = base + "/hooks/" + info.Name
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"baseUrl":         base,
		"slackWebhookUrl": base + "/services/" + s.slack.teamID + "/B0SIM/x",
		"slackApiUrl":     base + "/api",
		"webhookUrls":     hooks,
		"receivers":       s.receivers.list(),
		"sqsQueueUrl":     seedQueueURL,
		"sqsEndpoint":     base,
	})
}

// writeFieldError answers 422 naming the field, or 400 when err is not a field's.
func writeFieldError(w http.ResponseWriter, err error) {
	var fe fieldError
	if errors.As(err, &fe) {
		writeJSON(w, http.StatusUnprocessableEntity, map[string]string{"error": fe.Error(), "field": fe.Field})
		return
	}
	writeError(w, http.StatusBadRequest, err.Error())
}

func (s *Server) handleRecords(w http.ResponseWriter, r *http.Request) {
	q := r.URL.Query()
	f := Filter{Channel: q.Get("channel"), Target: q.Get("target"), EventID: q.Get("eventId")}
	if since := q.Get("since"); since != "" {
		at, err := time.Parse(time.RFC3339Nano, since)
		if err != nil {
			writeFieldError(w, fieldError{"since", "must be an RFC 3339 time"})
			return
		}
		f.Since = at
	}
	writeJSON(w, http.StatusOK, map[string][]Record{"records": s.records.list(f)})
}

func (s *Server) handleClearRecords(w http.ResponseWriter, _ *http.Request) {
	s.records.clear()
	w.WriteHeader(http.StatusNoContent)
}

// Delivery is one webhook event with every attempt made at it, oldest first.
type Delivery struct {
	EventID  string   `json:"eventId"`
	Target   string   `json:"target"`
	Status   int      `json:"status"`
	Attempts []Record `json:"attempts"`
}

// groupDeliveries groups webhook records by event id, most recently started first.
func groupDeliveries(newestFirst []Record) []Delivery {
	index := map[string]int{}
	out := []Delivery{}
	for i := len(newestFirst) - 1; i >= 0; i-- {
		r := newestFirst[i]
		if r.Channel != ChannelWebhook || r.EventID == "" {
			continue
		}
		at, seen := index[r.EventID]
		if !seen {
			at = len(out)
			index[r.EventID] = at
			out = append(out, Delivery{EventID: r.EventID, Target: r.Target})
		}
		out[at].Attempts = append(out[at].Attempts, r)
		out[at].Status = r.Status
	}
	for i, j := 0, len(out)-1; i < j; i, j = i+1, j-1 {
		out[i], out[j] = out[j], out[i]
	}
	return out
}

func (s *Server) handleDeliveries(w http.ResponseWriter, r *http.Request) {
	records := s.records.list(Filter{Channel: ChannelWebhook, EventID: r.URL.Query().Get("eventId")})
	writeJSON(w, http.StatusOK, map[string][]Delivery{"deliveries": groupDeliveries(records)})
}

func decodeJSON(r *http.Request, v any) error {
	decoder := json.NewDecoder(http.MaxBytesReader(nil, r.Body, 1<<20))
	decoder.DisallowUnknownFields()
	return decoder.Decode(v)
}

func (s *Server) handleFaults(w http.ResponseWriter, _ *http.Request) {
	writeJSON(w, http.StatusOK, map[string][]Fault{"faults": s.faults.list()})
}

func (s *Server) handleAddFault(w http.ResponseWriter, r *http.Request) {
	var f Fault
	if err := decodeJSON(r, &f); err != nil {
		writeError(w, http.StatusBadRequest, "the body is not a fault: "+err.Error())
		return
	}
	if err := f.validate(); err != nil {
		writeFieldError(w, err)
		return
	}
	writeJSON(w, http.StatusCreated, s.faults.add(f))
}

func (s *Server) handleClearFaults(w http.ResponseWriter, _ *http.Request) {
	s.faults.clear()
	w.WriteHeader(http.StatusNoContent)
}

func (s *Server) handleRemoveFault(w http.ResponseWriter, r *http.Request) {
	if !s.faults.remove(r.PathValue("id")) {
		writeError(w, http.StatusNotFound, "no fault "+r.PathValue("id"))
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (s *Server) handleSetReceiver(w http.ResponseWriter, r *http.Request) {
	var in struct {
		Secret string `json:"secret"`
	}
	if err := decodeJSON(r, &in); err != nil {
		writeError(w, http.StatusBadRequest, "the body is not a receiver: "+err.Error())
		return
	}
	if in.Secret == "" {
		writeFieldError(w, fieldError{"secret", "must not be empty"})
		return
	}
	s.receivers.setSecret(r.PathValue("name"), in.Secret)
	writeJSON(w, http.StatusOK, map[string][]receiverInfo{"receivers": s.receivers.list()})
}

func (s *Server) handleClearReceiver(w http.ResponseWriter, r *http.Request) {
	s.receivers.clearSecret(r.PathValue("name"))
	w.WriteHeader(http.StatusNoContent)
}
