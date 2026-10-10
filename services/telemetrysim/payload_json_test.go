package telemetrysim

import "testing"

func TestHexIDsRewritesOnlyOTLPIDFields(t *testing.T) {
	in := `{"traceId":"AAEC","spanId":"/w==","parentSpanId":"","name":"x","eventId":"AAEC",` +
		`"attr":"{\"traceId\":\"AAEC\"}","traceIdish":"AAEC","spanId":"not base64!"}`
	want := `{"traceId":"000102","spanId":"ff","parentSpanId":"","name":"x","eventId":"AAEC",` +
		`"attr":"{\"traceId\":\"AAEC\"}","traceIdish":"AAEC","spanId":"not base64!"}`
	if got := string(hexIDs([]byte(in))); got != want {
		t.Fatalf("hexIDs:\n got %s\nwant %s", got, want)
	}
}
