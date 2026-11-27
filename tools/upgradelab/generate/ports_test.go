package generate

import (
	"net"
	"testing"
)

// scriptedListener is a listener the test hands out in place of the OS's, on a port it chooses.
type scriptedListener struct{ port int }

func (listener scriptedListener) Accept() (net.Conn, error) { return nil, net.ErrClosed }
func (listener scriptedListener) Close() error              { return nil }
func (listener scriptedListener) Addr() net.Addr {
	return &net.TCPAddr{IP: net.IPv4(127, 0, 0, 1), Port: listener.port}
}

// scriptedListen offers the given ports in order, as an OS that reuses a just-closed port would.
func scriptedListen(ports ...int) func() (net.Listener, error) {
	next := 0
	return func() (net.Listener, error) {
		port := ports[next%len(ports)]
		next++
		return scriptedListener{port: port}, nil
	}
}

// @scenario "A generation run publishes its stores on ports no other run holds"
func TestPortsHandedOutOnceSkipAPortTheOSOffersAgain(t *testing.T) {
	handed := newHandedOutPorts()
	first, err := freePortsFrom(scriptedListen(40001, 40002, 40003, 40004, 40005), handed)
	if err != nil {
		t.Fatal(err)
	}
	// The OS hands 40001 and 40003 out again once the first run closed them.
	second, err := freePortsFrom(scriptedListen(40001, 40003, 40006, 40007, 40008, 40009, 40010), handed)
	if err != nil {
		t.Fatal(err)
	}
	seen := map[string]bool{}
	for _, ports := range []Ports{first, second} {
		for _, port := range []string{ports.App, ports.Postgres, ports.Redis, ports.ClickHouse, ports.Private} {
			if port == "" || seen[port] {
				t.Errorf("port %q is empty or already handed to another run: first %+v, second %+v", port, first, second)
			}
			seen[port] = true
		}
	}
}

// @scenario "A generation run stops when the OS offers only ports already handed out"
func TestPortsGiveUpWhenTheOSOffersNothingNew(t *testing.T) {
	handed := newHandedOutPorts()
	if _, err := freePortsFrom(scriptedListen(40001, 40002, 40003, 40004, 40005), handed); err != nil {
		t.Fatal(err)
	}
	if _, err := freePortsFrom(scriptedListen(40001), handed); err == nil {
		t.Error("an OS that only offers a port already handed out must fail the run, not loop or reuse it")
	}
}
