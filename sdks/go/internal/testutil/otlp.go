package testutil

import (
	"encoding/binary"
	"errors"
)

// ReceivedSpan is the part of an OTLP span the SDK's transport tests check.
type ReceivedSpan struct {
	Name          string
	AttributeKeys []string
}

// ReadOTLPSpans reads the spans out of an OTLP/protobuf
// ExportTraceServiceRequest without the generated OTLP packages, which the
// root module does not depend on.
func ReadOTLPSpans(body []byte) ([]ReceivedSpan, error) {
	var out []ReceivedSpan
	err := eachMessage(body, 1, func(resourceSpans []byte) error {
		return eachMessage(resourceSpans, 2, func(scopeSpans []byte) error {
			return eachMessage(scopeSpans, 2, func(span []byte) error {
				sp, err := readSpan(span)
				out = append(out, sp)
				return err
			})
		})
	})
	return out, err
}

// readSpan reads a Span's name (5) and its attribute (9) keys (KeyValue 1).
func readSpan(span []byte) (ReceivedSpan, error) {
	var sp ReceivedSpan
	err := eachMessage(span, 5, func(name []byte) error {
		sp.Name = string(name)
		return nil
	})
	if err != nil {
		return sp, err
	}
	err = eachMessage(span, 9, func(kv []byte) error {
		return eachMessage(kv, 1, func(key []byte) error {
			sp.AttributeKeys = append(sp.AttributeKeys, string(key))
			return nil
		})
	})
	return sp, err
}

var errMalformed = errors.New("malformed protobuf")

// eachMessage calls fn with the payload of every length-delimited field num
// in b, skipping other fields.
func eachMessage(b []byte, num uint64, fn func([]byte) error) error {
	for len(b) > 0 {
		tag, payload, rest, err := nextField(b)
		if err != nil {
			return err
		}
		if tag == num<<3|2 {
			if err := fn(payload); err != nil {
				return err
			}
		}
		b = rest
	}
	return nil
}

// nextField splits off the first field of b: its tag, its payload when it is
// length-delimited, and the bytes after it.
func nextField(b []byte) (tag uint64, payload, rest []byte, err error) {
	tag, n := binary.Uvarint(b)
	if n <= 0 {
		return 0, nil, nil, errMalformed
	}
	b = b[n:]
	switch tag & 7 {
	case 0:
		_, n = binary.Uvarint(b)
	case 1:
		n = 8
	case 5:
		n = 4
	case 2:
		size, m := binary.Uvarint(b)
		if m <= 0 || size > uint64(len(b)-m) {
			return 0, nil, nil, errMalformed
		}
		payload, n = b[m:m+int(size)], m+int(size)
	default:
		n = 0
	}
	if n <= 0 || n > len(b) {
		return 0, nil, nil, errMalformed
	}
	return tag, payload, b[n:], nil
}
