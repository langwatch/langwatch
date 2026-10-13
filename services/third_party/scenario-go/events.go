package scenario

import (
	"bytes"
	"encoding/json"
	"slices"
	"time"

	"github.com/langwatch/scenario/go/internal/jsjson"
)

// EventType is the type of a scenario event posted to LangWatch.
type EventType string

// Scenario event types.
const (
	EventRunStarted         EventType = "SCENARIO_RUN_STARTED"
	EventRunFinished        EventType = "SCENARIO_RUN_FINISHED"
	EventMessageSnapshot    EventType = "SCENARIO_MESSAGE_SNAPSHOT"
	EventTextMessageStart   EventType = "SCENARIO_TEXT_MESSAGE_START"
	EventTextMessageContent EventType = "SCENARIO_TEXT_MESSAGE_CONTENT"
	EventTextMessageEnd     EventType = "SCENARIO_TEXT_MESSAGE_END"
	EventToolCallStart      EventType = "SCENARIO_TOOL_CALL_START"
	EventToolCallArgs       EventType = "SCENARIO_TOOL_CALL_ARGS"
	EventToolCallEnd        EventType = "SCENARIO_TOOL_CALL_END"
)

// RunStatus is the status of a finished run.
type RunStatus string

// Run statuses.
const (
	RunStatusSuccess RunStatus = "SUCCESS"
	RunStatusError   RunStatus = "ERROR"
	RunStatusFailed  RunStatus = "FAILED"
)

// Event is one scenario event, encoded once at creation so retries post the
// identical body (same ids, same timestamp).
type Event struct {
	Type EventType
	// Seq orders the events of one run, starting at 1.
	Seq uint64
	// Timestamp is the event time in Unix milliseconds.
	Timestamp     int64
	ScenarioRunID string
	// Payload is the JSON body posted to /api/scenario-events.
	Payload []byte
}

// eventBase carries the fields every event of a run shares.
type eventBase struct {
	batchRunID    string
	scenarioID    string
	scenarioRunID string
	scenarioSetID string
}

// begin starts an event body: type, timestamp, then the shared ids, in the
// order the JS SDK writes them.
func (b eventBase) begin(dst []byte, t EventType, ts int64) []byte {
	dst = append(dst, `{"type":`...)
	dst = jsjson.AppendString(dst, string(t))
	dst = append(dst, `,"timestamp":`...)
	dst = jsjson.AppendNumber(dst, float64(ts))
	dst = append(dst, `,"batchRunId":`...)
	dst = jsjson.AppendString(dst, b.batchRunID)
	dst = append(dst, `,"scenarioId":`...)
	dst = jsjson.AppendString(dst, b.scenarioID)
	dst = append(dst, `,"scenarioRunId":`...)
	dst = jsjson.AppendString(dst, b.scenarioRunID)
	dst = append(dst, `,"scenarioSetId":`...)
	return jsjson.AppendString(dst, b.scenarioSetID)
}

// runAgent is one entry of RUN_STARTED metadata.agents.
type runAgent struct {
	name string
	role AgentRole
}

// runStartedPayload builds RUN_STARTED. Metadata keys come first (sorted, Go
// maps have no order), then name, description, agents and fields; a
// metadata key with one of those names keeps its place and takes the run's
// value, like the JS object spread.
func (b eventBase) runStartedPayload(ts int64, cfg ScenarioConfig, agents []runAgent) []byte {
	dst := b.begin(make([]byte, 0, 512), EventRunStarted, ts)
	dst = append(dst, `,"metadata":{`...)

	overrides := map[string]func([]byte) []byte{
		"name":        func(d []byte) []byte { return jsjson.AppendString(d, cfg.Name) },
		"description": func(d []byte) []byte { return jsjson.AppendString(d, cfg.Description) },
		"agents":      func(d []byte) []byte { return appendRunAgents(d, agents) },
	}
	if len(cfg.Fields) > 0 {
		overrides["fields"] = func(d []byte) []byte { return appendSortedJSONMap(d, cfg.Fields) }
	}
	n := 0
	key := func(k string) {
		if n > 0 {
			dst = append(dst, ',')
		}
		n++
		dst = jsjson.AppendString(dst, k)
		dst = append(dst, ':')
	}
	written := map[string]bool{}
	for _, k := range sortedKeys(cfg.Metadata) {
		key(k)
		if o, ok := overrides[k]; ok {
			dst = o(dst)
			written[k] = true
			continue
		}
		dst = appendJSONValue(dst, cfg.Metadata[k])
	}
	for _, k := range [...]string{"name", "description", "agents", "fields"} {
		if o, ok := overrides[k]; ok && !written[k] {
			key(k)
			dst = o(dst)
		}
	}
	return append(dst, "}}"...)
}

func appendRunAgents(dst []byte, agents []runAgent) []byte {
	dst = append(dst, '[')
	for i, a := range agents {
		if i > 0 {
			dst = append(dst, ',')
		}
		dst = append(dst, `{"name":`...)
		dst = jsjson.AppendString(dst, a.name)
		dst = append(dst, `,"role":`...)
		dst = jsjson.AppendString(dst, lower(string(a.role)))
		dst = append(dst, '}')
	}
	return append(dst, ']')
}

func sortedKeys[V any](m map[string]V) []string {
	keys := make([]string, 0, len(m))
	for k := range m {
		keys = append(keys, k)
	}
	slices.Sort(keys)
	return keys
}

func appendSortedJSONMap[V any](dst []byte, m map[string]V) []byte {
	dst = append(dst, '{')
	for i, k := range sortedKeys(m) {
		if i > 0 {
			dst = append(dst, ',')
		}
		dst = jsjson.AppendString(dst, k)
		dst = append(dst, ':')
		dst = appendJSONValue(dst, m[k])
	}
	return append(dst, '}')
}

// appendJSONValue encodes an arbitrary user value without HTML escaping.
func appendJSONValue(dst []byte, v any) []byte {
	switch x := v.(type) {
	case string:
		return jsjson.AppendString(dst, x)
	case bool, float64, int, int64, nil:
		return jsjson.Append(dst, x)
	}
	var buf bytes.Buffer
	enc := json.NewEncoder(&buf)
	enc.SetEscapeHTML(false)
	if err := enc.Encode(v); err != nil {
		return append(dst, "null"...)
	}
	return append(dst, bytes.TrimRight(buf.Bytes(), "\n")...)
}

// snapshotPayload builds MESSAGE_SNAPSHOT from encoded AG-UI rows.
func (b eventBase) snapshotPayload(ts int64, rows [][]byte) []byte {
	size := 256
	for _, r := range rows {
		size += len(r) + 1
	}
	dst := b.begin(make([]byte, 0, size), EventMessageSnapshot, ts)
	dst = append(dst, `,"messages":[`...)
	for i, r := range rows {
		if i > 0 {
			dst = append(dst, ',')
		}
		dst = append(dst, r...)
	}
	return append(dst, "]}"...)
}

// runFinishedPayload builds RUN_FINISHED; results are always present.
func (b eventBase) runFinishedPayload(ts int64, status RunStatus, r *ScenarioResult) []byte {
	dst := b.begin(make([]byte, 0, 512), EventRunFinished, ts)
	dst = append(dst, `,"status":`...)
	dst = jsjson.AppendString(dst, string(status))
	verdict := "failure"
	if r != nil && r.Success {
		verdict = "success"
	}
	dst = append(dst, `,"results":{"verdict":`...)
	dst = jsjson.AppendString(dst, verdict)
	var res ScenarioResult
	if r != nil {
		res = *r
	}
	dst = append(dst, `,"metCriteria":`...)
	dst = jsjson.Append(dst, nonNil(res.MetCriteria))
	dst = append(dst, `,"unmetCriteria":`...)
	dst = jsjson.Append(dst, nonNil(res.UnmetCriteria))
	if len(res.InconclusiveCriteria) > 0 {
		dst = append(dst, `,"inconclusiveCriteria":`...)
		dst = jsjson.Append(dst, res.InconclusiveCriteria)
	}
	if len(res.Criteria) > 0 {
		dst = append(dst, `,"criteria":[`...)
		for i, c := range res.Criteria {
			if i > 0 {
				dst = append(dst, ',')
			}
			dst = append(dst, `{"criterion":`...)
			dst = jsjson.AppendString(dst, c.Criterion)
			dst = append(dst, `,"requirement":`...)
			dst = jsjson.AppendString(dst, c.Requirement)
			dst = append(dst, `,"status":`...)
			dst = jsjson.AppendString(dst, string(c.Status))
			dst = append(dst, `,"reasoning":`...)
			dst = jsjson.AppendString(dst, c.Reasoning)
			dst = append(dst, '}')
		}
		dst = append(dst, ']')
	}
	if res.Reasoning != "" {
		dst = append(dst, `,"reasoning":`...)
		dst = jsjson.AppendString(dst, res.Reasoning)
	}
	if res.Error != "" {
		dst = append(dst, `,"error":`...)
		dst = jsjson.AppendString(dst, res.Error)
	}
	if res.Evaluations != nil {
		dst = append(dst, `,"evaluations":`...)
		dst = appendJSONValue(dst, res.Evaluations)
	}
	return append(dst, "}}"...)
}

func nonNil(s []string) []string {
	if s == nil {
		return []string{}
	}
	return s
}

// textMessageStartPayload builds TEXT_MESSAGE_START.
func (b eventBase) textMessageStartPayload(ts int64, id string, role Role, index int) []byte {
	dst := b.begin(make([]byte, 0, 256), EventTextMessageStart, ts)
	dst = append(dst, `,"messageId":`...)
	dst = jsjson.AppendString(dst, id)
	dst = append(dst, `,"role":`...)
	dst = jsjson.AppendString(dst, string(role))
	dst = append(dst, `,"messageIndex":`...)
	dst = jsjson.AppendNumber(dst, float64(index))
	return append(dst, '}')
}

// textMessageContentPayload builds TEXT_MESSAGE_CONTENT.
func (b eventBase) textMessageContentPayload(ts int64, id, delta string) []byte {
	dst := b.begin(make([]byte, 0, 256+len(delta)), EventTextMessageContent, ts)
	dst = append(dst, `,"messageId":`...)
	dst = jsjson.AppendString(dst, id)
	dst = append(dst, `,"delta":`...)
	dst = jsjson.AppendString(dst, delta)
	return append(dst, '}')
}

// textMessageEndPayload builds TEXT_MESSAGE_END. The full AG-UI row is the
// authoritative "message"; "content" is the display text: the string
// content, or the concatenated text parts of a multipart message (the
// transcript of an audio turn), so base64 never lands in it. It is omitted
// when the message has no text.
func (b eventBase) textMessageEndPayload(ts int64, row aguiRow, index int) []byte {
	dst := b.begin(make([]byte, 0, 256+2*len(row.json)), EventTextMessageEnd, ts)
	dst = append(dst, `,"messageId":`...)
	dst = jsjson.AppendString(dst, row.id)
	dst = append(dst, `,"role":`...)
	dst = jsjson.AppendString(dst, string(row.role))
	if row.textContent {
		dst = append(dst, `,"content":`...)
		dst = jsjson.AppendString(dst, row.text)
	}
	dst = append(dst, `,"message":`...)
	dst = append(dst, row.json...)
	if row.traceID != "" {
		dst = append(dst, `,"traceId":`...)
		dst = jsjson.AppendString(dst, row.traceID)
	}
	dst = append(dst, `,"messageIndex":`...)
	dst = jsjson.AppendNumber(dst, float64(index))
	return append(dst, '}')
}

// toolCallStartPayload builds TOOL_CALL_START.
func (b eventBase) toolCallStartPayload(ts int64, toolCallID, name, parentMessageID string) []byte {
	dst := b.begin(make([]byte, 0, 256), EventToolCallStart, ts)
	dst = append(dst, `,"toolCallId":`...)
	dst = jsjson.AppendString(dst, toolCallID)
	dst = append(dst, `,"toolCallName":`...)
	dst = jsjson.AppendString(dst, name)
	if parentMessageID != "" {
		dst = append(dst, `,"parentMessageId":`...)
		dst = jsjson.AppendString(dst, parentMessageID)
	}
	return append(dst, '}')
}

// toolCallArgsPayload builds TOOL_CALL_ARGS.
func (b eventBase) toolCallArgsPayload(ts int64, toolCallID, delta string) []byte {
	dst := b.begin(make([]byte, 0, 256+len(delta)), EventToolCallArgs, ts)
	dst = append(dst, `,"toolCallId":`...)
	dst = jsjson.AppendString(dst, toolCallID)
	dst = append(dst, `,"delta":`...)
	dst = jsjson.AppendString(dst, delta)
	return append(dst, '}')
}

// toolCallEndPayload builds TOOL_CALL_END.
func (b eventBase) toolCallEndPayload(ts int64, toolCallID string) []byte {
	dst := b.begin(make([]byte, 0, 200), EventToolCallEnd, ts)
	dst = append(dst, `,"toolCallId":`...)
	dst = jsjson.AppendString(dst, toolCallID)
	return append(dst, '}')
}

// nowMillis is the event clock; tests replace it for deterministic payloads.
var nowMillis = func() int64 { return time.Now().UnixMilli() }
