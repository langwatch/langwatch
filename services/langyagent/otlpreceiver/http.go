package otlpreceiver

import (
	"bytes"
	"compress/gzip"
	"fmt"
	"io"
	"net/http"
	"strings"
)

// readLimited reads the whole body up to max bytes, erroring past it rather than
// silently truncating — a truncated protobuf decodes to garbage, and forwarding
// half a batch upstream is worse than dropping it loudly.
func readLimited(r io.Reader, max int64) ([]byte, error) {
	body, err := io.ReadAll(io.LimitReader(r, max+1))
	if err != nil {
		return nil, err
	}
	if int64(len(body)) > max {
		return nil, fmt.Errorf("otlp body exceeds %d bytes", max)
	}
	return body, nil
}

// decompress gunzips a body when the exporter gzipped it. The OTel Go SDK
// compresses by default, so skipping this would mean silently decoding nothing
// from the very producer we care most about. Only the SINK path decompresses:
// the forwarder ships the original compressed bytes with their original
// Content-Encoding.
func decompress(body []byte, contentEncoding string) ([]byte, error) {
	if !strings.Contains(strings.ToLower(contentEncoding), "gzip") {
		return body, nil
	}
	zr, err := gzip.NewReader(bytes.NewReader(body))
	if err != nil {
		return nil, fmt.Errorf("gzip reader: %w", err)
	}
	defer zr.Close()

	out, err := io.ReadAll(zr)
	if err != nil {
		return nil, fmt.Errorf("gunzip otlp body: %w", err)
	}
	return out, nil
}

// writeOTLPSuccess answers the exporter with an empty ExportXServiceResponse —
// the OTLP "full success" reply. An empty protobuf message is zero bytes, and
// `{}` is its JSON equivalent, so one shape serves traces, logs and metrics.
//
// We answer 200 even when decoding failed. The payload is already on its way
// upstream, and a 4xx/5xx would only make the exporter retry a batch we cannot
// read — burning its queue on our parse bug.
func writeOTLPSuccess(w http.ResponseWriter, contentType string) {
	if normalizeContentType(contentType, nil) == contentTypeJSON {
		w.Header().Set("Content-Type", contentTypeJSON)
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte("{}"))
		return
	}
	w.Header().Set("Content-Type", contentTypeProtobuf)
	w.WriteHeader(http.StatusOK)
}
