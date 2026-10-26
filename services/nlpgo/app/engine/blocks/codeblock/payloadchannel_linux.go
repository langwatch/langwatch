//go:build linux

// How one execution's code, inputs and secrets reach its interpreter.
//
// Not over a descriptor exec handed it. A descriptor that exists at exec can
// be cloned out of /proc by any process running as the same user during the
// moment before the runner makes itself non-dumpable, and a clone of a pipe
// reads whatever is written to it afterwards, so a handshake cannot save a
// payload that travels that way.
//
// The interpreter is therefore handed nothing, and asks. Once it is hidden it
// connects to this socket, and the engine answers by the pid the kernel
// reports for the process at the other end: an interpreter gets its own run's
// payload, once, and anything else gets nothing. The pid cannot be set by the
// peer, so the answer does not depend on a secret the peer could have stolen
// in that same moment.
package codeblock

import (
	"errors"
	"fmt"
	"net"
	"os"
	"syscall"
	"time"
)

// payloadChannel serves payloads over a socket in the abstract namespace: it
// has no path, so nothing about it is reachable through the filesystem the
// executions share.
type payloadChannel struct {
	name     string
	listener *net.UnixListener
}

// payloadWriteBudget bounds one answer. The reader is an interpreter that has
// just asked for its payload, so this only bounds a process that asked and
// then stopped reading.
const payloadWriteBudget = 10 * time.Second

// acceptRetryPause keeps a failing accept from spinning while whatever it ran
// out of comes back.
const acceptRetryPause = 50 * time.Millisecond

// newPayloadChannel binds the socket and starts answering. The name travels to
// the runner in its environment and is not a secret: the peer check is what
// makes the channel safe, not the name.
func newPayloadChannel() (*payloadChannel, error) {
	suffix, err := newRunToken()
	if err != nil {
		return nil, err
	}
	name := fmt.Sprintf("nlpgo-codeblock-%d-%s", os.Getpid(), suffix)
	listener, err := net.ListenUnix("unix", &net.UnixAddr{Name: "@" + name, Net: "unix"})
	if err != nil {
		return nil, fmt.Errorf("codeblock: payload channel: %w", err)
	}
	channel := &payloadChannel{name: name, listener: listener}
	go channel.serve()
	return channel, nil
}

// channelEnv tells the runner where to ask. Nothing when there is no channel,
// which is how the runner knows to read its payload from stdin instead.
func (c *payloadChannel) channelEnv() []string {
	if c == nil {
		return nil
	}
	return []string{payloadChannelEnvVar + "=" + c.name}
}

// serve answers for as long as the socket is open. An accept can fail for a
// reason that passes, descriptors running out being the likely one, and giving
// up on it would leave every later execution waiting for a payload that never
// arrives, so only a closed listener ends this.
// close gives up the socket, which also ends the accept loop. Only a boot
// that fails after the channel is bound needs it: an executor that was built
// answers for as long as the process does.
func (c *payloadChannel) close() {
	if c == nil {
		return
	}
	_ = c.listener.Close()
}

func (c *payloadChannel) serve() {
	for {
		conn, err := c.listener.AcceptUnix()
		if err != nil {
			if errors.Is(err, net.ErrClosed) {
				return
			}
			time.Sleep(acceptRetryPause)
			continue
		}
		go c.answer(conn)
	}
}

// answer hands one interpreter its payload. Claiming it removes it, so a
// second ask for the same run is answered with nothing, as is an ask from a
// process that is not an execution this engine started.
func (c *payloadChannel) answer(conn *net.UnixConn) {
	defer func() { _ = conn.Close() }()
	pid, ok := peerPid(conn)
	if !ok {
		return
	}
	payload := runningChildren.claimPayload(pid)
	if payload == nil {
		return
	}
	_ = conn.SetWriteDeadline(time.Now().Add(payloadWriteBudget))
	_, _ = conn.Write(payload)
}

// peerPid asks the kernel which process is at the other end of the connection.
func peerPid(conn *net.UnixConn) (int, bool) {
	raw, err := conn.SyscallConn()
	if err != nil {
		return 0, false
	}
	var cred *syscall.Ucred
	var credErr error
	controlErr := raw.Control(func(fd uintptr) {
		cred, credErr = syscall.GetsockoptUcred(int(fd), syscall.SOL_SOCKET, syscall.SO_PEERCRED)
	})
	if controlErr != nil || credErr != nil || cred == nil {
		return 0, false
	}
	return int(cred.Pid), true
}
