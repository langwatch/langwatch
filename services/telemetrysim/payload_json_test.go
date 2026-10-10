package telemetrysim

import (
	"encoding/hex"
	"testing"

	colllogspb "go.opentelemetry.io/proto/otlp/collector/logs/v1"
	"google.golang.org/protobuf/proto"
)

func TestHexIDsRewritesOnlyOTLPIDFields(t *testing.T) {
	in := `{"traceId":"AAEC","spanId":"/w==","parentSpanId":"","name":"x","eventId":"AAEC",` +
		`"attr":"{\"traceId\":\"AAEC\"}","traceIdish":"AAEC","spanId":"not base64!"}`
	want := `{"traceId":"000102","spanId":"ff","parentSpanId":"","name":"x","eventId":"AAEC",` +
		`"attr":"{\"traceId\":\"AAEC\"}","traceIdish":"AAEC","spanId":"not base64!"}`
	if got := string(hexIDs([]byte(in))); got != want {
		t.Fatalf("hexIDs:\n got %s\nwant %s", got, want)
	}
}

func TestAJSONBodySentAsProtobufKeepsItsHexIDs(t *testing.T) {
	body := `{"resourceLogs":[{"scopeLogs":[{"logRecords":[{"timeUnixNano":"1700000000123456789",` +
		`"traceId":"5b8efff798038103d269b633813fc60c","spanId":"eee19b7ec3c1b174","body":{"stringValue":"x"}}]}]}]}`
	payload, err := encodeOTLPJSON([]byte(body), BatchSpec{Encoding: EncodingProtobuf})
	if err != nil {
		t.Fatal(err)
	}
	var msg colllogspb.ExportLogsServiceRequest
	if err := proto.Unmarshal(payload.Body, &msg); err != nil {
		t.Fatal(err)
	}
	rec := msg.GetResourceLogs()[0].GetScopeLogs()[0].GetLogRecords()[0]
	if got := hex.EncodeToString(rec.GetTraceId()); got != "5b8efff798038103d269b633813fc60c" {
		t.Errorf("traceId: got %s (%d bytes)", got, len(rec.GetTraceId()))
	}
	if got := hex.EncodeToString(rec.GetSpanId()); got != "eee19b7ec3c1b174" {
		t.Errorf("spanId: got %s", got)
	}
	if rec.GetTimeUnixNano() != 1700000000123456789 {
		t.Errorf("timeUnixNano: got %d", rec.GetTimeUnixNano())
	}
}
