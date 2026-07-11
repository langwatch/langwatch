// Package netports grabs free loopback TCP ports for adapters that need to
// pre-allocate ports before spawning a process (system.System, clickhousedocker.Server).
package netports

import "net"

// Free grabs n distinct free loopback TCP ports: bind 127.0.0.1:0, read the
// port the kernel assigned, close the listener. There is an inherent TOCTOU
// gap between close and the caller's later bind, but it is the standard,
// good-enough approach for local dev tooling.
func Free(n int) ([]int, error) {
	var ports []int
	var held []net.Listener
	for i := 0; i < n; i++ {
		l, err := net.Listen("tcp", "127.0.0.1:0")
		if err != nil {
			for _, h := range held {
				_ = h.Close()
			}
			return nil, err
		}
		held = append(held, l)
		ports = append(ports, l.Addr().(*net.TCPAddr).Port)
	}
	for _, h := range held {
		_ = h.Close()
	}
	return ports, nil
}
