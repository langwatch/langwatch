package ksuid

import (
	"context"
	"crypto/rand"
	"encoding/binary"
	"sync"
	"time"

	"github.com/langwatch/langwatch/pkg/contexts"
)

// ID is a k-sortable globally unique ID with optional environment/resource prefix.
type ID struct {
	Environment string
	Resource    string
	Timestamp   uint64
	InstanceID  InstanceID
	SequenceID  uint32
}

// IsZero returns true if the ID has not been initialized.
func (id ID) IsZero() bool { return id == ID{} }

// String returns the full prefixed string representation.
func (id ID) String() string {
	prefix := ""
	if id.Resource != "" {
		if id.Environment != "" && id.Environment != "prod" {
			prefix = id.Environment + "_"
		}
		prefix += id.Resource + "_"
	}

	buf := make([]byte, 21)
	binary.BigEndian.PutUint64(buf[0:8], id.Timestamp)
	buf[8] = id.InstanceID.Scheme
	copy(buf[9:17], id.InstanceID.Data[:])
	binary.BigEndian.PutUint32(buf[17:21], id.SequenceID)

	return prefix + encodeBase62(buf)
}

// Node generates IDs for a specific machine instance.
type Node struct {
	instanceID InstanceID
	mu         sync.Mutex
	timestamp  uint64
	sequence   uint32
}

// InstanceID identifies the machine/process generating IDs.
type InstanceID struct {
	Scheme byte
	Data   [8]byte
}

var globalNode = &Node{instanceID: newRandomInstanceID()}

// SetInstanceID overrides the global node's instance ID.
func SetInstanceID(id InstanceID) {
	globalNode.mu.Lock()
	globalNode.instanceID = id
	globalNode.mu.Unlock()
}

// Generate creates a new ID using the global node.
func Generate(ctx context.Context, resource string) ID {
	return globalNode.Generate(ctx, resource)
}

// Generate creates a new ID from this node.
func (n *Node) Generate(ctx context.Context, resource string) ID {
	env := "prod"
	if info := contexts.GetServiceInfo(ctx); info != nil && info.Environment != "" {
		env = info.Environment
	}

	n.mu.Lock()
	ts := uint64(time.Now().UTC().Unix())
	if ts-n.timestamp >= 1 {
		n.timestamp = ts
		n.sequence = 0
	} else {
		n.sequence++
	}
	seq := n.sequence
	iid := n.instanceID
	n.mu.Unlock()

	return ID{
		Environment: env,
		Resource:    resource,
		Timestamp:   ts,
		InstanceID:  iid,
		SequenceID:  seq,
	}
}

func newRandomInstanceID() InstanceID {
	var data [8]byte
	if _, err := rand.Read(data[:]); err != nil {
		panic(err)
	}
	return InstanceID{Scheme: 'R', Data: data}
}

const base62Chars = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz"

func encodeBase62(orig []byte) string {
	if len(orig) == 0 {
		return ""
	}

	// Copy to avoid mutating the caller's slice.
	src := make([]byte, len(orig))
	copy(src, orig)

	// Convert bytes to a big integer, then repeatedly mod 62
	// Simple implementation using big.Int-style math on byte slices
	result := make([]byte, 0, 29)
	zero := make([]byte, len(src))

	for !equal(src, zero) {
		var remainder int
		for i := range src {
			acc := remainder*256 + int(src[i])
			src[i] = byte(acc / 62)
			remainder = acc % 62
		}
		result = append(result, base62Chars[remainder])
	}

	// Pad to 29 chars
	for len(result) < 29 {
		result = append(result, '0')
	}

	// Reverse
	for i, j := 0, len(result)-1; i < j; i, j = i+1, j-1 {
		result[i], result[j] = result[j], result[i]
	}

	return string(result)
}

func equal(a, b []byte) bool {
	if len(a) != len(b) {
		return false
	}
	for i := range a {
		if a[i] != b[i] {
			return false
		}
	}
	return true
}
