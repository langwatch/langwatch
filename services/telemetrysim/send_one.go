package telemetrysim

import (
	"cmp"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"io/fs"
	"net/http"
	"strings"
	"time"

	colllogspb "go.opentelemetry.io/proto/otlp/collector/logs/v1"
	collmetricspb "go.opentelemetry.io/proto/otlp/collector/metrics/v1"
	colltracepb "go.opentelemetry.io/proto/otlp/collector/trace/v1"
	"google.golang.org/protobuf/encoding/protojson"
	"google.golang.org/protobuf/proto"
)

// SendOneRequest posts one OTLP request outside any run, without a retry: a
// pasted OTLP JSON Body, else a recorded Fixture, else a Preset batch.
type SendOneRequest struct {
	Preset   string   `json:"preset,omitempty"`
	Fixture  string   `json:"fixture,omitempty"`
	Body     string   `json:"body,omitempty"`
	Seed     uint64   `json:"seed,omitempty"`
	Encoding Encoding `json:"encoding,omitempty"`
	NoGzip   bool     `json:"noGzip,omitempty"`
	Endpoint string   `json:"endpoint,omitempty"`
	APIKey   string   `json:"apiKey,omitempty"`
}

// SendOneAnswer is what was sent and how the door answered it (Status 0: no answer, see Error).
type SendOneAnswer struct {
	URL         string   `json:"url"`
	Signal      Signal   `json:"signal"`
	Encoding    Encoding `json:"encoding"`
	Gzip        bool     `json:"gzip"`
	Bytes       int      `json:"bytes"`
	Status      int      `json:"status"`
	RetryAfter  string   `json:"retryAfter,omitempty"`
	ContentType string   `json:"contentType,omitempty"`
	Body        string   `json:"body,omitempty"`
	LatencyMs   float64  `json:"latencyMs"`
	Error       string   `json:"error,omitempty"`
}

// handleSendOne is POST /_sim/api/send-one. The sim answers 200 whatever the
// door said; a 400 means the sim could not build the request at all.
func (s *Server) handleSendOne(w http.ResponseWriter, r *http.Request) {
	var req SendOneRequest
	if err := json.NewDecoder(io.LimitReader(r.Body, 4<<20)).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "the request is not JSON: "+err.Error())
		return
	}
	if req.Endpoint == "" {
		req.Endpoint, req.APIKey = s.cfg.Endpoint, cmp.Or(req.APIKey, s.cfg.APIKey)
	}
	payload, err := s.oneRequest(&req)
	if err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	d := delivery{url: strings.TrimRight(req.Endpoint, "/") + "/v1/" + string(payload.Signal), apiKey: req.APIKey, payload: payload}
	began := time.Now()
	a, sendErr := s.sender.send(r.Context(), d)
	out := SendOneAnswer{
		URL: d.url, Signal: payload.Signal, Encoding: req.Encoding, Gzip: payload.Gzip, Bytes: len(payload.Body),
		Status: a.status, RetryAfter: a.retryAfter, ContentType: a.contentType, Body: string(a.body),
		LatencyMs: float64(time.Since(began).Microseconds()) / 1000,
	}
	if sendErr != nil {
		out.Error = sendErr.Error()
	}
	writeJSON(w, http.StatusOK, out)
}

// oneRequest checks req and builds the one body it names.
func (s *Server) oneRequest(req *SendOneRequest) (Payload, error) {
	if err := checkEndpoint(req.Endpoint); err != nil {
		return Payload{}, err
	}
	if err := checkEncoding(&req.Encoding); err != nil {
		return Payload{}, err
	}
	spec := BatchSpec{Seed: req.Seed, Start: time.Now().UTC(), Encoding: req.Encoding, Gzip: !req.NoGzip}
	switch {
	case req.Body != "":
		return encodeOTLPJSON([]byte(req.Body), spec)
	case req.Fixture != "":
		body, err := s.recorded(req.Fixture)
		if err != nil {
			return Payload{}, err
		}
		return encodeOTLPJSON(body, spec)
	}
	preset, ok := presetByName(cmp.Or(req.Preset, "llm-trace"))
	if !ok {
		return Payload{}, fmt.Errorf("unknown preset %q; presets: %s", req.Preset, strings.Join(PresetNames(), ", "))
	}
	spec.Preset = preset
	return Build(spec)
}

// recorded reads fixtures/<name>.otlp.json.
func (s *Server) recorded(name string) ([]byte, error) {
	body, err := fs.ReadFile(s.fixtures, name+recordedSuffix)
	if err != nil {
		return nil, fmt.Errorf("no recorded fixture %q", name)
	}
	return body, nil
}

// encodeOTLPJSON names an OTLP JSON body's signal by its top-level field, then
// sends JSON as written and converts it for protobuf.
func encodeOTLPJSON(body []byte, spec BatchSpec) (Payload, error) {
	signal, msg, err := otlpMessageOf(body)
	if err != nil {
		return Payload{}, err
	}
	spec.Preset = Preset{Signal: signal}
	if spec.Encoding == EncodingJSON {
		return finish(spec, body, contentType(EncodingJSON))
	}
	if err := protojson.Unmarshal(body, msg); err != nil {
		return Payload{}, fmt.Errorf("the body is not OTLP JSON for %s, so it has no protobuf form: %w", signal, err)
	}
	wire, err := proto.Marshal(msg)
	if err != nil {
		return Payload{}, err
	}
	return finish(spec, wire, contentType(EncodingProtobuf))
}

func otlpMessageOf(body []byte) (Signal, proto.Message, error) {
	var top map[string]json.RawMessage
	if err := json.Unmarshal(body, &top); err != nil {
		return "", nil, fmt.Errorf("the body is not a JSON object: %w", err)
	}
	switch {
	case top["resourceSpans"] != nil:
		return SignalTraces, &colltracepb.ExportTraceServiceRequest{}, nil
	case top["resourceLogs"] != nil:
		return SignalLogs, &colllogspb.ExportLogsServiceRequest{}, nil
	case top["resourceMetrics"] != nil:
		return SignalMetrics, &collmetricspb.ExportMetricsServiceRequest{}, nil
	}
	return "", nil, errors.New("an OTLP body needs resourceSpans, resourceLogs or resourceMetrics")
}
