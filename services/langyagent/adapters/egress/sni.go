package egress

import (
	"errors"
	"io"
	"net"
	"net/netip"
	"strings"
	"time"
)

// The egress adapter reads the FQDN from the CONNECT authority as the primary,
// enforceable destination (ADR-076 "Where FQDN enforcement lives"). It ALSO
// peeks the TLS ClientHello SNI as a cross-check: a cooperative-but-hostile
// client that sends `CONNECT allowed.com:443` and then negotiates TLS with SNI
// `attacker.com` (domain-fronting a shared CDN) would otherwise slip past an
// authority-only check. We parse the SNI without terminating TLS — the tunnel
// stays opaque — and refuse a definite mismatch.

// maxClientHelloRecord bounds a single TLS record payload. A TLS record payload
// is at most 16384 bytes; one ClientHello record fits comfortably.
const maxClientHelloRecord = 18 << 10

// maxClientHelloBytes bounds the REASSEMBLED handshake across records, so a
// peer that dribbles endless handshake fragments cannot make us buffer forever.
const maxClientHelloBytes = 64 << 10

// peekClientHelloSNI reads TLS records from conn until the first handshake
// message is complete, returns the SNI host found in it (lowercased, "" if
// none), whether the stream was a TLS handshake at all, and a net.Conn that
// re-serves every consumed byte so the caller forwards the handshake upstream
// unchanged.
//
// It reassembles ACROSS records on purpose. A handshake message may legally be
// fragmented over several TLS records, and reading only the first one let a
// hostile client split its ClientHello so the SNI landed in record 2 — the peek
// then found nothing, the caller had no "definite mismatch" to act on, and the
// domain-fronting check this exists to perform was skipped. Reassembly closes
// that, and `sawHandshake` lets the caller fail closed when it still cannot
// read an SNI out of something that plainly IS a TLS handshake.
func peekClientHelloSNI(conn net.Conn, deadline time.Duration) (sni string, sawHandshake bool, replayed net.Conn, err error) {
	if deadline > 0 {
		_ = conn.SetReadDeadline(time.Now().Add(deadline))
		defer func() { _ = conn.SetReadDeadline(time.Time{}) }()
	}
	raw, handshake, sawHandshake, err := readClientHelloRecords(conn)
	// Whatever we managed to read must be replayed, even on error, so the
	// upstream sees a byte-identical handshake.
	replayed = &prefixConn{Conn: conn, prefix: raw}
	if err != nil || !sawHandshake {
		return "", sawHandshake, replayed, err
	}
	return parseHandshakeSNI(handshake), true, replayed, nil
}

// readClientHelloRecords reads TLS handshake records until the first handshake
// message is complete (or a bound/error stops it). It returns the raw bytes
// consumed — every one of them, so they can be replayed upstream — the
// reassembled handshake stream with record framing stripped, and whether the
// stream is a TLS handshake at all.
func readClientHelloRecords(r io.Reader) (raw []byte, handshake []byte, sawHandshake bool, err error) {
	for {
		header := make([]byte, 5)
		n, herr := io.ReadFull(r, header)
		raw = append(raw, header[:n]...)
		if herr != nil {
			return raw, handshake, sawHandshake, herr
		}
		// A content type that is not 22 is the clean "not TLS" exit: an opaque
		// tunnel that never claimed to be a handshake. No error, no
		// sawHandshake — require-TLS is the rung that governs it, and holding
		// it for the whole peek timeout would be a latency cost for nothing.
		if header[0] != 22 {
			return raw, handshake, sawHandshake, nil
		}
		// Past here the stream HAS claimed to be a handshake, so every exit
		// below must leave the caller able to tell it could not read an SNI.
		//
		// The version is checked, but an implausible one is an ERROR rather
		// than a pass. Returning nil here — as this did — was a fail-OPEN: the
		// caller's guard is `sni == "" && sniUnreadable(sawHandshake, err)`,
		// and (false, nil) satisfies neither term, so the tunnel spliced
		// uninspected. Flipping one byte of legacy_record_version (0x0301 ->
		// 0x0305) was enough, because RFC 8446 §5.1 deprecates that field and
		// says it MUST be ignored — so the destination still parsed the very
		// ClientHello we had just declined to look at, and domain fronting was
		// back. Anything claiming content type 22 that we cannot follow is
		// unreadable, not absent.
		sawHandshake = true
		if header[1] != 3 || header[2] > 4 {
			return raw, handshake, sawHandshake, errors.New("implausible tls record version")
		}
		length := int(header[3])<<8 | int(header[4])
		if length <= 0 || length > maxClientHelloRecord {
			return raw, handshake, sawHandshake, errors.New("tls record length out of range")
		}
		payload := make([]byte, length)
		pn, perr := io.ReadFull(r, payload)
		raw = append(raw, payload[:pn]...)
		handshake = append(handshake, payload[:pn]...)
		if perr != nil {
			return raw, handshake, sawHandshake, perr
		}
		if handshakeMessageComplete(handshake) {
			return raw, handshake, sawHandshake, nil
		}
		if len(handshake) >= maxClientHelloBytes {
			return raw, handshake, sawHandshake, errors.New("client hello exceeds reassembly bound")
		}
	}
}

// handshakeMessageComplete reports whether b holds a whole handshake message:
// type(1) + uint24 length + body.
func handshakeMessageComplete(b []byte) bool {
	if len(b) < 4 {
		return false
	}
	msgLen := int(b[1])<<16 | int(b[2])<<8 | int(b[3])
	return len(b) >= 4+msgLen
}

// parseHandshakeSNI extracts the server_name from a reassembled handshake
// stream (record framing already stripped). Returns "" on any malformed or
// absent field — never panics on a truncated buffer.
func parseHandshakeSNI(b []byte) string {
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

// sniUnreadable reports whether the peek failed to produce a positive answer
// about the stream's SNI.
//
// True in two cases: the stream IS a TLS handshake but no server_name came out
// of it, or the peek errored before it could tell (a stall past the deadline, a
// truncated header, a record length out of range). Both mean "we were supposed
// to check and could not".
//
// False for a stream that is cleanly not TLS — a complete record header with a
// non-handshake content type and no error. That is an opaque tunnel, and
// require-TLS is the rung that governs it.
func sniUnreadable(sawHandshake bool, err error) bool {
	return sawHandshake || err != nil
}

// isIPLiteral reports whether the CONNECT authority is a bare address rather
// than a name. RFC 6066 forbids sending server_name for an IP literal, so a
// conforming client legitimately produces no SNI and must not be failed closed
// for it.
func isIPLiteral(host string) bool {
	_, err := netip.ParseAddr(strings.TrimSuffix(strings.TrimSpace(host), "."))
	return err == nil
}
