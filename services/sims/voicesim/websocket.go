package voicesim

import (
	"bufio"
	"crypto/sha1" //nolint:gosec // RFC 6455 defines the handshake accept key as a SHA-1
	"encoding/base64"
	"encoding/binary"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"strings"
)

// The RFC 6455 opcodes voicesim reads or writes.
const (
	opText  = 0x1
	opClose = 0x8
	opPing  = 0x9
	opPong  = 0xa
)

// websocketGUID is the constant RFC 6455 appends to the client's key.
const websocketGUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11"

// maxMessageBytes bounds one message; ElevenLabs' own client allows 16 MiB.
const maxMessageBytes = 16 << 20

var errMessageTooLarge = errors.New("websocket message larger than 16 MiB")

// wsConn is the server end of one WebSocket: just enough of RFC 6455 for the
// conversation socket (no extensions, no compression; the client asks for none).
type wsConn struct {
	conn net.Conn
	r    *bufio.Reader
}

// acceptWebSocket upgrades the request, or answers 400 when it is not an upgrade.
func acceptWebSocket(w http.ResponseWriter, r *http.Request) (*wsConn, error) {
	key := r.Header.Get("Sec-WebSocket-Key")
	if !strings.EqualFold(r.Header.Get("Upgrade"), "websocket") || key == "" {
		writeError(w, http.StatusBadRequest, "voicesim expects a WebSocket upgrade here")
		return nil, errors.New("not a websocket upgrade")
	}
	conn, rw, err := http.NewResponseController(w).Hijack()
	if err != nil {
		return nil, fmt.Errorf("hijacking the connection: %w", err)
	}
	sum := sha1.Sum([]byte(key + websocketGUID)) //nolint:gosec // see the import
	_, _ = fmt.Fprintf(rw, "HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: %s\r\n\r\n",
		base64.StdEncoding.EncodeToString(sum[:]))
	if err := rw.Flush(); err != nil {
		_ = conn.Close()
		return nil, err
	}
	return &wsConn{conn: conn, r: rw.Reader}, nil
}

func (c *wsConn) close() { _ = c.conn.Close() }

// readMessage returns the next data message, answering pings on the way and
// ending with io.EOF when the peer closes.
func (c *wsConn) readMessage() ([]byte, error) {
	var message []byte
	for {
		fin, payload, err := c.nextDataFrame()
		if err != nil {
			return nil, err
		}
		message = append(message, payload...)
		if len(message) > maxMessageBytes {
			return nil, errMessageTooLarge
		}
		if fin {
			return message, nil
		}
	}
}

// nextDataFrame reads frames until one carries data, answering control frames.
func (c *wsConn) nextDataFrame() (fin bool, payload []byte, err error) {
	for {
		fin, op, payload, err := c.readFrame()
		if err != nil {
			return false, nil, err
		}
		isControl, err := c.answerControl(op, payload)
		if err != nil || !isControl {
			return fin, payload, err
		}
	}
}

// answerControl answers a close or a ping, reporting whether op was a control
// frame; a close ends the read with io.EOF.
func (c *wsConn) answerControl(op byte, payload []byte) (bool, error) {
	switch op {
	case opClose:
		_ = c.writeFrame(opClose, nil)
		return true, io.EOF
	case opPing:
		return true, c.writeFrame(opPong, payload)
	case opPong:
		return true, nil
	}
	return false, nil
}

func (c *wsConn) readFrame() (fin bool, op byte, payload []byte, err error) {
	var head [2]byte
	if _, err = io.ReadFull(c.r, head[:]); err != nil {
		return false, 0, nil, err
	}
	size, err := c.readSize(head[1] & 0x7f)
	if err != nil {
		return false, 0, nil, err
	}
	var mask [4]byte
	masked := head[1]&0x80 != 0
	if masked {
		if _, err = io.ReadFull(c.r, mask[:]); err != nil {
			return false, 0, nil, err
		}
	}
	payload = make([]byte, size)
	if _, err = io.ReadFull(c.r, payload); err != nil {
		return false, 0, nil, err
	}
	if masked {
		for i := range payload {
			payload[i] ^= mask[i%4]
		}
	}
	return head[0]&0x80 != 0, head[0] & 0x0f, payload, nil
}

func (c *wsConn) readSize(short byte) (uint64, error) {
	size := uint64(short)
	switch short {
	case 126:
		var ext [2]byte
		if _, err := io.ReadFull(c.r, ext[:]); err != nil {
			return 0, err
		}
		size = uint64(binary.BigEndian.Uint16(ext[:]))
	case 127:
		var ext [8]byte
		if _, err := io.ReadFull(c.r, ext[:]); err != nil {
			return 0, err
		}
		size = binary.BigEndian.Uint64(ext[:])
	}
	if size > maxMessageBytes {
		return 0, errMessageTooLarge
	}
	return size, nil
}

// writeFrame sends one unfragmented, unmasked frame (servers never mask).
func (c *wsConn) writeFrame(op byte, payload []byte) error {
	head := []byte{0x80 | op}
	switch n := len(payload); {
	case n < 126:
		head = append(head, byte(n))
	case n <= 0xffff:
		head = binary.BigEndian.AppendUint16(append(head, 126), uint16(n))
	default:
		head = binary.BigEndian.AppendUint64(append(head, 127), uint64(n))
	}
	_, err := c.conn.Write(append(head, payload...))
	return err
}
