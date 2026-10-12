package lambdasim

import (
	"bytes"
	"encoding/binary"
	"hash/crc32"
	"io"
)

// writeEvent writes one application/vnd.amazon.eventstream message: a prelude of
// total and header lengths with its CRC, string headers, the payload, then the
// message CRC. The SDK's codec checks both CRCs.
func writeEvent(w io.Writer, eventType, contentType string, payload []byte) error {
	var headers bytes.Buffer
	for _, h := range [][2]string{{":event-type", eventType}, {":content-type", contentType}, {":message-type", "event"}} {
		headers.WriteByte(byte(len(h[0])))
		headers.WriteString(h[0])
		headers.WriteByte(7) // string value
		_ = binary.Write(&headers, binary.BigEndian, uint16(len(h[1])))
		headers.WriteString(h[1])
	}
	var msg bytes.Buffer
	_ = binary.Write(&msg, binary.BigEndian, uint32(16+headers.Len()+len(payload)))
	_ = binary.Write(&msg, binary.BigEndian, uint32(headers.Len()))
	_ = binary.Write(&msg, binary.BigEndian, crc32.ChecksumIEEE(msg.Bytes()))
	msg.Write(headers.Bytes())
	msg.Write(payload)
	_ = binary.Write(&msg, binary.BigEndian, crc32.ChecksumIEEE(msg.Bytes()))
	_, err := w.Write(msg.Bytes())
	return err
}
