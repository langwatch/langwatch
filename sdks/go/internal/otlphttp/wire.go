package otlphttp

import (
	"encoding/binary"
	"errors"
	"math"
)

// Protobuf wire types (https://protobuf.dev/programming-guides/encoding/).
const (
	wireVarint  = 0
	wireFixed64 = 1
	wireBytes   = 2
	wireFixed32 = 5
)

var errMalformed = errors.New("malformed protobuf")

func appendTag(b []byte, num, wireType int) []byte {
	return binary.AppendUvarint(b, uint64(num)<<3|uint64(wireType))
}

// appendVarintField appends a non-zero varint field; proto3 omits zero.
func appendVarintField(b []byte, num int, v uint64) []byte {
	if v == 0 {
		return b
	}
	return binary.AppendUvarint(appendTag(b, num, wireVarint), v)
}

func appendFixed64Field(b []byte, num int, v uint64) []byte {
	if v == 0 {
		return b
	}
	return binary.LittleEndian.AppendUint64(appendTag(b, num, wireFixed64), v)
}

func appendFixed32Field(b []byte, num int, v uint32) []byte {
	if v == 0 {
		return b
	}
	return binary.LittleEndian.AppendUint32(appendTag(b, num, wireFixed32), v)
}

func appendBytesField(b []byte, num int, v []byte) []byte {
	if len(v) == 0 {
		return b
	}
	b = binary.AppendUvarint(appendTag(b, num, wireBytes), uint64(len(v)))
	return append(b, v...)
}

func appendStringField(b []byte, num int, v string) []byte {
	if v == "" {
		return b
	}
	b = binary.AppendUvarint(appendTag(b, num, wireBytes), uint64(len(v)))
	return append(b, v...)
}

// appendMessage appends field num holding the message body appends. The body
// is written in place after a one-byte length, which is widened (and the body
// moved) only when the body is 128 bytes or longer.
func appendMessage(b []byte, num int, body func([]byte) []byte) []byte {
	b = appendTag(b, num, wireBytes)
	mark := len(b)
	b = body(append(b, 0))
	n := len(b) - mark - 1
	if width := uvarintLen(uint64(n)); width > 1 {
		b = append(b, make([]byte, width-1)...)
		copy(b[mark+width:], b[mark+1:mark+1+n])
	}
	binary.PutUvarint(b[mark:], uint64(n))
	return b
}

func uvarintLen(v uint64) int {
	n := 1
	for v >= 0x80 {
		v >>= 7
		n++
	}
	return n
}

// field is one decoded protobuf field: a varint or fixed value in num, or the
// payload of a length-delimited field in data.
type field struct {
	number int
	num    uint64
	data   []byte
}

// readFields splits a message into its fields, without interpreting them.
func readFields(b []byte) ([]field, error) {
	var out []field
	for len(b) > 0 {
		f, rest, err := readField(b)
		if err != nil {
			return nil, err
		}
		out, b = append(out, f), rest
	}
	return out, nil
}

// readField reads the first field of b and returns the bytes after it.
func readField(b []byte) (field, []byte, error) {
	tag, n := binary.Uvarint(b)
	if n <= 0 || tag>>3 == 0 || tag>>3 > math.MaxInt32 {
		return field{}, nil, errMalformed
	}
	b = b[n:]
	f := field{number: int(tag >> 3)}
	switch tag & 7 {
	case wireVarint:
		f.num, n = binary.Uvarint(b)
	case wireFixed64:
		if n = fixedLen(b, 8); n > 0 {
			f.num = binary.LittleEndian.Uint64(b)
		}
	case wireFixed32:
		if n = fixedLen(b, 4); n > 0 {
			f.num = uint64(binary.LittleEndian.Uint32(b))
		}
	case wireBytes:
		f.data, n = lengthDelimited(b)
	default:
		n = 0
	}
	if n <= 0 {
		return field{}, nil, errMalformed
	}
	return f, b[n:], nil
}

// fixedLen is size when b holds at least size bytes, else 0.
func fixedLen(b []byte, size int) int {
	if len(b) < size {
		return 0
	}
	return size
}

// lengthDelimited reads a length-prefixed payload, returning it and the bytes
// consumed, or 0 when b is too short.
func lengthDelimited(b []byte) ([]byte, int) {
	size, n := binary.Uvarint(b)
	if n <= 0 || size > uint64(len(b)-n) {
		return nil, 0
	}
	end := n + int(size)
	return b[n:end], end
}
