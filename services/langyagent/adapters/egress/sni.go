package egress

import (
	"errors"
	"io"
	"net"
	"strings"
	"time"
)

// The egress adapter reads the FQDN from the CONNECT authority as the primary,
// enforceable destination (ADR-043 "Where FQDN enforcement lives"). It ALSO
// peeks the TLS ClientHello SNI as a cross-check: a cooperative-but-hostile
// client that sends `CONNECT allowed.com:443` and then negotiates TLS with SNI
// `attacker.com` (domain-fronting a shared CDN) would otherwise slip past an
// authority-only check. We parse the SNI without terminating TLS — the tunnel
// stays opaque — and refuse a definite mismatch.

// maxClientHelloRecord bounds how much we buffer while looking for the SNI. A
// TLS record payload is at most 16384 bytes; the ClientHello fits comfortably.
const maxClientHelloRecord = 18 << 10

// peekClientHelloSNI reads the first TLS record from conn, returns the SNI host
// found in it (lowercased, "" if none/not-a-ClientHello), and a net.Conn that
// re-serves the consumed bytes so the caller can forward them upstream
// unchanged. On any parse ambiguity it returns sni="" — the caller only ever
// BLOCKS on a definite mismatch, never on an unparseable hello, so opaque and
// non-TLS tunnels are unaffected.
func peekClientHelloSNI(conn net.Conn, deadline time.Duration) (string, net.Conn, error) {
	if deadline > 0 {
		_ = conn.SetReadDeadline(time.Now().Add(deadline))
		defer conn.SetReadDeadline(time.Time{})
	}
	record, err := readFirstTLSRecord(conn)
	// Whatever we managed to read must be replayed, even on error, so the
	// upstream sees a byte-identical handshake.
	replayed := &prefixConn{Conn: conn, prefix: record}
	if err != nil {
		return "", replayed, err
	}
	return parseClientHelloSNI(record), replayed, nil
}

// readFirstTLSRecord reads one TLS record (5-byte header + payload). If the
// leading byte is not a handshake content type (22) the stream isn't TLS; we
// return what we read so it can be replayed, with no error. On a short read the
// bytes actually consumed are returned so they can still be replayed upstream.
func readFirstTLSRecord(r io.Reader) ([]byte, error) {
	header := make([]byte, 5)
	n, err := io.ReadFull(r, header)
	if err != nil {
		return header[:n], err
	}
	// header[0] == 22 (handshake). Anything else: not a TLS ClientHello.
	if header[0] != 22 {
		return header, nil
	}
	length := int(header[3])<<8 | int(header[4])
	if length <= 0 || length > maxClientHelloRecord {
		return header, errors.New("tls record length out of range")
	}
	payload := make([]byte, length)
	pn, err := io.ReadFull(r, payload)
	if err != nil {
		return append(header, payload[:pn]...), err
	}
	return append(header, payload...), nil
}

// parseClientHelloSNI extracts the server_name from a full TLS record
// (header+payload). Returns "" on any malformed or absent field — never panics
// on a truncated buffer.
func parseClientHelloSNI(record []byte) string {
	if len(record) < 5 || record[0] != 22 {
		return ""
	}
	b := record[5:] // handshake payload
	// Handshake: type(1)=ClientHello(1), length(3), body.
	if len(b) < 4 || b[0] != 1 {
		return ""
	}
	b = b[4:]
	// legacy_version(2) + random(32).
	if len(b) < 34 {
		return ""
	}
	b = b[34:]
	// session_id: len(1) + bytes.
	sid, ok := readVec8(b)
	if !ok {
		return ""
	}
	b = b[1+len(sid):]
	// cipher_suites: len(2) + bytes.
	cs, ok := readVec16(b)
	if !ok {
		return ""
	}
	b = b[2+len(cs):]
	// compression_methods: len(1) + bytes.
	cm, ok := readVec8(b)
	if !ok {
		return ""
	}
	b = b[1+len(cm):]
	// extensions: len(2) + bytes.
	exts, ok := readVec16(b)
	if !ok {
		return ""
	}
	return sniFromExtensions(exts)
}

// sniFromExtensions walks the extensions block looking for server_name (type
// 0) and returns the first host_name (type 0) entry, lowercased.
func sniFromExtensions(exts []byte) string {
	for len(exts) >= 4 {
		extType := int(exts[0])<<8 | int(exts[1])
		extLen := int(exts[2])<<8 | int(exts[3])
		exts = exts[4:]
		if len(exts) < extLen {
			return ""
		}
		body := exts[:extLen]
		exts = exts[extLen:]
		if extType != 0 { // server_name
			continue
		}
		// ServerNameList: list_len(2) then entries of type(1)+len(2)+name.
		if len(body) < 2 {
			return ""
		}
		list := body[2:]
		for len(list) >= 3 {
			nameType := list[0]
			nameLen := int(list[1])<<8 | int(list[2])
			list = list[3:]
			if len(list) < nameLen {
				return ""
			}
			name := list[:nameLen]
			list = list[nameLen:]
			if nameType == 0 { // host_name
				return strings.ToLower(strings.TrimSuffix(string(name), "."))
			}
		}
		return ""
	}
	return ""
}

func readVec8(b []byte) ([]byte, bool) {
	if len(b) < 1 {
		return nil, false
	}
	n := int(b[0])
	if len(b) < 1+n {
		return nil, false
	}
	return b[1 : 1+n], true
}

func readVec16(b []byte) ([]byte, bool) {
	if len(b) < 2 {
		return nil, false
	}
	n := int(b[0])<<8 | int(b[1])
	if len(b) < 2+n {
		return nil, false
	}
	return b[2 : 2+n], true
}

// prefixConn re-serves a buffered prefix (the peeked ClientHello record) ahead
// of the live connection, so forwarding the handshake upstream is byte-exact.
type prefixConn struct {
	net.Conn
	prefix []byte
}

func (c *prefixConn) Read(p []byte) (int, error) {
	if len(c.prefix) > 0 {
		n := copy(p, c.prefix)
		c.prefix = c.prefix[n:]
		return n, nil
	}
	return c.Conn.Read(p)
}
