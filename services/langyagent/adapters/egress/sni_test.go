package egress

import (
	"bytes"
	"crypto/tls"
	"io"
	"net"
	"strings"
	"testing"
	"time"
)

// clientHelloFor captures the bytes a real TLS client puts on the wire for the
// given SNI, so the fragmentation tests operate on a genuine ClientHello rather
// than a hand-rolled approximation of one.
func clientHelloFor(t *testing.T, serverName string) []byte {
	t.Helper()
	var buf bytes.Buffer
	// The handshake fails (nothing answers), but not before the ClientHello has
	// been written into buf.
	_ = tls.Client(fakeConn{r: bytes.NewReader(nil), w: &buf}, &tls.Config{
		ServerName:         serverName,
		InsecureSkipVerify: true,
	}).Handshake()
	if buf.Len() == 0 {
		t.Fatal("failed to capture a ClientHello")
	}
	return buf.Bytes()
}

// fakeConn is a net.Conn over a reader/writer pair. Only Read/Write/Close and
// the deadline setters are exercised; the embedded nil interface satisfies the
// rest of net.Conn and would panic loudly if anything else were ever called.
type fakeConn struct {
	net.Conn
	r io.Reader
	w io.Writer
}

func (c fakeConn) Read(p []byte) (int, error)       { return c.r.Read(p) }
func (c fakeConn) Write(p []byte) (int, error)      { return c.w.Write(p) }
func (c fakeConn) Close() error                     { return nil }
func (c fakeConn) SetDeadline(time.Time) error      { return nil }
func (c fakeConn) SetReadDeadline(time.Time) error  { return nil }
func (c fakeConn) SetWriteDeadline(time.Time) error { return nil }

// refragment re-frames one TLS record's payload as two records, splitting the
// handshake message at `at` bytes. This is legal TLS, and it is the cheap way to
// push the SNI extension out of the first record.
func refragment(t *testing.T, record []byte, at int) []byte {
	t.Helper()
	if len(record) < 5 || record[0] != 22 {
		t.Fatal("not a handshake record")
	}
	payload := record[5:]
	if at <= 0 || at >= len(payload) {
		t.Fatalf("split point %d out of range for a %d-byte payload", at, len(payload))
	}
	var out []byte
	appendRecord := func(chunk []byte) {
		hdr := []byte{22, record[1], record[2], byte(len(chunk) >> 8), byte(len(chunk))}
		out = append(out, hdr...)
		out = append(out, chunk...)
	}
	appendRecord(payload[:at])
	appendRecord(payload[at:])
	return out
}

func TestPeekClientHelloSNI_ReadsAnUnfragmentedHello(t *testing.T) {
	hello := clientHelloFor(t, "example.test")

	sni, sawHandshake, _, err := peekClientHelloSNI(fakeConn{r: bytes.NewReader(hello), w: io.Discard}, 0)
	if err != nil {
		t.Fatalf("peek: %v", err)
	}
	if !sawHandshake {
		t.Fatal("a ClientHello must be recognized as a TLS handshake")
	}
	if sni != "example.test" {
		t.Fatalf("sni = %q, want example.test", sni)
	}
}

// The regression. Splitting the ClientHello across two records used to leave the
// SNI in record 2, where a single-record peek never looked — so the peek
// returned "", the caller found no "definite mismatch", and the anti-fronting
// cross-check was skipped entirely.
// @scenario "A ClientHello split across TLS records still reveals its SNI"
func TestPeekClientHelloSNI_ReassemblesAFragmentedHello(t *testing.T) {
	hello := clientHelloFor(t, "attacker.example")
	// Split early — right after the handshake header — so the server_name
	// extension lands wholly in the second record.
	fragmented := refragment(t, hello, 8)

	// Establish that the split is real: reading ONLY the first record — what the
	// pre-fix peek did — recovers no SNI. Without this the test below could pass
	// against a hello that was never meaningfully fragmented.
	firstRecordLen := 5 + int(fragmented[3])<<8 + int(fragmented[4])
	if got := parseHandshakeSNI(fragmented[5:firstRecordLen]); got != "" {
		t.Fatalf("first record still yields sni %q; the fragmentation is not exercising the bug", got)
	}

	sni, sawHandshake, _, err := peekClientHelloSNI(fakeConn{r: bytes.NewReader(fragmented), w: io.Discard}, 0)
	if err != nil {
		t.Fatalf("peek: %v", err)
	}
	if !sawHandshake {
		t.Fatal("a fragmented ClientHello is still a TLS handshake")
	}
	if sni != "attacker.example" {
		t.Fatalf("sni = %q, want attacker.example — a fragmented hello must not hide the SNI", sni)
	}
}

// Every consumed byte must be replayed, or the upstream handshake breaks.
func TestPeekClientHelloSNI_ReplaysEveryConsumedByte(t *testing.T) {
	hello := clientHelloFor(t, "example.test")
	fragmented := refragment(t, hello, 8)
	trailer := []byte("trailing-bytes")
	stream := append(append([]byte{}, fragmented...), trailer...)

	_, _, replayed, err := peekClientHelloSNI(fakeConn{r: bytes.NewReader(stream), w: io.Discard}, 0)
	if err != nil {
		t.Fatalf("peek: %v", err)
	}
	got, err := io.ReadAll(replayed)
	if err != nil {
		t.Fatalf("read replayed: %v", err)
	}
	if !bytes.Equal(got, stream) {
		t.Fatalf("replayed stream is not byte-identical: got %d bytes, want %d", len(got), len(stream))
	}
}

func TestPeekClientHelloSNI_NonTLSStreamIsNotAHandshake(t *testing.T) {
	stream := []byte("GET / HTTP/1.1\r\nHost: example.test\r\n\r\n")

	sni, sawHandshake, _, err := peekClientHelloSNI(fakeConn{r: bytes.NewReader(stream), w: io.Discard}, 0)
	if err != nil {
		t.Fatalf("peek: %v", err)
	}
	if sawHandshake {
		t.Fatal("a plain HTTP request must not be reported as a TLS handshake")
	}
	if sni != "" {
		t.Fatalf("sni = %q, want empty", sni)
	}
}

// repeatReader serves b over and over, without end. The stream must be
// genuinely infinite: dribbling a FINITE buffer proves nothing about the
// reassembly bound, because io.ReadFull hits EOF and the loop returns on its
// own. The earlier version of this test used a bytes.Reader and so passed with
// maxClientHelloBytes deleted outright.
type repeatReader struct {
	b []byte
	i int
}

func (r *repeatReader) Read(p []byte) (int, error) {
	n := copy(p, r.b[r.i:])
	r.i = (r.i + n) % len(r.b)
	return n, nil
}

// A handshake that never completes must not buffer without bound.
func TestPeekClientHelloSNI_BoundsEndlessFragments(t *testing.T) {
	// One record, repeated forever. Every copy re-opens a handshake message
	// claiming ~16 MiB, and handshakeMessageComplete only ever reads that length
	// from the first four bytes, so the message can never complete however much
	// we feed it — no need for the later records to differ from the first.
	body := append([]byte{1, 0xFF, 0xFF, 0xFF}, make([]byte, 256)...)
	record := append([]byte{22, 3, 1, byte(len(body) >> 8), byte(len(body))}, body...)

	done := make(chan error, 1)
	go func() {
		_, _, _, err := peekClientHelloSNI(fakeConn{r: &repeatReader{b: record}, w: io.Discard}, 0)
		done <- err
	}()

	select {
	case err := <-done:
		if err == nil || !strings.Contains(err.Error(), "reassembly bound") {
			t.Fatalf("err = %v, want the reassembly-bound error", err)
		}
	case <-time.After(5 * time.Second):
		t.Fatal("peek did not terminate — the reassembly bound is gone")
	}
}

// The regression the review caught: keying the fail-closed branch on
// "saw a handshake byte" left it bypassable by sending NOTHING. The read errors
// before the 5-byte header completes, so sawHandshake stays false — and if the
// caller also discards the error, the tunnel is spliced uninspected.
// @scenario "An unreadable ClientHello is refused while a policy is enforcing"
func TestSNIUnreadable_TreatsAStalledHelloAsUnreadable(t *testing.T) {
	// A peer that opens the tunnel and then says nothing: io.ReadFull returns
	// an error with no complete header, so sawHandshake is false.
	sni, sawHandshake, _, err := peekClientHelloSNI(
		fakeConn{r: bytes.NewReader(nil), w: io.Discard}, 0)

	if sni != "" || sawHandshake {
		t.Fatalf("expected no SNI and no handshake, got sni=%q sawHandshake=%v", sni, sawHandshake)
	}
	if err == nil {
		t.Fatal("a stalled/empty hello must surface an error for the caller to fail closed on")
	}
	if !sniUnreadable(sawHandshake, err) {
		t.Fatal("a stalled hello must count as unreadable, or a `sleep` defeats the cross-check")
	}
}

// @scenario "A tunnel that is not TLS at all is unaffected by the cross-check"
func TestSNIUnreadable_LetsACleanlyNonTLSStreamThrough(t *testing.T) {
	// A complete record header with a non-handshake content type and no error:
	// an opaque tunnel, governed by require-TLS rather than by this rung.
	_, sawHandshake, _, err := peekClientHelloSNI(
		fakeConn{r: bytes.NewReader([]byte("GET / HTTP/1.1\r\n\r\n")), w: io.Discard}, 0)

	if err != nil || sawHandshake {
		t.Fatalf("expected a clean non-TLS read, got sawHandshake=%v err=%v", sawHandshake, err)
	}
	if sniUnreadable(sawHandshake, err) {
		t.Fatal("a cleanly non-TLS stream must NOT be treated as unreadable")
	}
}

// @scenario "A bare IP authority is exempt from the SNI requirement"
func TestIsIPLiteral_ExemptsBareAddressesFromTheSNIRequirement(t *testing.T) {
	// RFC 6066 forbids server_name for an IP literal, so a conforming client
	// legitimately sends none and must not be failed closed for it.
	for _, host := range []string{"203.0.113.10", "2001:db8::1", "127.0.0.1"} {
		if !isIPLiteral(host) {
			t.Errorf("%q should be recognized as an IP literal", host)
		}
	}
	for _, host := range []string{"allowed.example", "github.com", ""} {
		if isIPLiteral(host) {
			t.Errorf("%q is a name, not an IP literal", host)
		}
	}
}

// A record that CLAIMS content type 22 but carries a version no TLS record uses
// must come back UNREADABLE, never as "cleanly not TLS".
//
// This test asserted the opposite until the review caught it, and in doing so it
// pinned a fail-open. Returning (sawHandshake=false, err=nil) here satisfies
// neither term of the caller's guard — `sni == "" && sniUnreadable(saw, err)` —
// so the tunnel spliced uninspected. One byte of legacy_record_version
// (0x0301 -> 0x0305) was the whole bypass, because RFC 8446 §5.1 deprecates that
// field and says it MUST be ignored, so the destination happily parsed the
// ClientHello we had just declined to read. Domain fronting, restored.
//
// The latency worry that motivated the version check is still served: it is the
// CONTENT TYPE, not the version, that lets an opaque tunnel leave promptly.
func TestReadClientHelloRecords_TreatsAnImplausibleRecordVersionAsUnreadable(t *testing.T) {
	for _, name := range []struct {
		label  string
		header []byte
	}{
		{"minor above the plausible range", []byte{22, 3, 5, 0x00, 0x05}},
		{"major that is not 3", []byte{22, 4, 3, 0x00, 0x05}},
		{"nonsense in both bytes", []byte{22, 0xFF, 0xFF, 0x00, 0x05}},
	} {
		t.Run(name.label, func(t *testing.T) {
			stream := append(append([]byte{}, name.header...), 1, 2, 3, 4, 5)

			_, _, sawHandshake, err := readClientHelloRecords(bytes.NewReader(stream))

			if !sniUnreadable(sawHandshake, err) {
				t.Fatalf("a content-type-22 record we cannot follow must be UNREADABLE "+
					"so the caller fails closed; got sawHandshake=%v err=%v", sawHandshake, err)
			}
		})
	}
}

// The genuine not-TLS exit is keyed on the content type alone, so an opaque
// tunnel still leaves promptly instead of being held for the peek timeout.
func TestReadClientHelloRecords_LetsANonHandshakeContentTypeThrough(t *testing.T) {
	for _, contentType := range []byte{20, 21, 23, 'G'} {
		stream := append([]byte{contentType, 3, 1, 0x00, 0x05}, 1, 2, 3, 4, 5)

		_, _, sawHandshake, err := readClientHelloRecords(bytes.NewReader(stream))
		if sawHandshake || err != nil {
			t.Errorf("content type %d is not a handshake (saw=%v err=%v)", contentType, sawHandshake, err)
		}
		if sniUnreadable(sawHandshake, err) {
			t.Errorf("content type %d is cleanly not TLS and must not read as unreadable", contentType)
		}
	}
}

func TestReadClientHelloRecords_AcceptsRealRecordVersions(t *testing.T) {
	// TLS 1.3 still writes a 0x0301/0x0303 legacy_record_version; 0x0300 (SSL
	// 3.0) and the nominal 0x0304 are inside the range we accept.
	for _, minor := range []byte{0, 1, 2, 3, 4} {
		hello := clientHelloFor(t, "example.test")
		hello[2] = minor

		_, _, sawHandshake, err := readClientHelloRecords(bytes.NewReader(hello))
		if !sawHandshake || err != nil {
			t.Errorf("legacy_record_version 3.%d must be accepted (saw=%v err=%v)", minor, sawHandshake, err)
		}
	}
}
