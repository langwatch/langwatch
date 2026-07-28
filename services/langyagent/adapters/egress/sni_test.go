package egress

import (
	"bytes"
	"crypto/tls"
	"io"
	"net"
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

// A handshake that never completes must not buffer without bound.
func TestPeekClientHelloSNI_BoundsEndlessFragments(t *testing.T) {
	// A handshake message claiming a huge length, dribbled as small records
	// that never complete it.
	var stream []byte
	body := make([]byte, 256)
	first := append([]byte{1, 0xFF, 0xFF, 0xFF}, body...)
	appendRecord := func(chunk []byte) {
		stream = append(stream, 22, 3, 1, byte(len(chunk)>>8), byte(len(chunk)))
		stream = append(stream, chunk...)
	}
	appendRecord(first)
	for len(stream) < maxClientHelloBytes*2 {
		appendRecord(body)
	}

	done := make(chan struct{})
	go func() {
		defer close(done)
		_, _, _, _ = peekClientHelloSNI(fakeConn{r: bytes.NewReader(stream), w: io.Discard}, 0)
	}()
	select {
	case <-done:
	case <-time.After(5 * time.Second):
		t.Fatal("peek did not terminate on an endless fragment stream")
	}
}
