package mediarelay

import (
	"net/http"

	"github.com/coder/websocket"
)

// Pump exposes the frame pump of a hopped socket pair to the external tests.
func (h *Hub) Pump(a, b *websocket.Conn) { h.pump(a, b) }

// HopHTTPClient exposes the hop dial client to the external tests.
func (h *Hub) HopHTTPClient() *http.Client { return h.hopClient }
