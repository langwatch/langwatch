//go:build !linux

// No payload channel off Linux, which in practice means a developer's macOS
// checkout. There is no PR_SET_DUMPABLE and no /proc to race there, so the
// payload goes to the interpreter on stdin as it always did.
package codeblock

type payloadChannel struct{}

func newPayloadChannel() (*payloadChannel, error) { return nil, nil }

func (c *payloadChannel) channelEnv() []string { return nil }
