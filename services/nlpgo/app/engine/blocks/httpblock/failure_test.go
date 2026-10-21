package httpblock

import (
	"context"
	"crypto/x509"
	"errors"
	"fmt"
	"net"
	"os"
	"syscall"
	"testing"

	"github.com/stretchr/testify/assert"
)

type timeoutError struct{}

func (timeoutError) Error() string   { return "i/o timeout" }
func (timeoutError) Timeout() bool   { return true }
func (timeoutError) Temporary() bool { return true }

func TestClassifyFailure(t *testing.T) {
	refused := &net.OpError{Op: "dial", Err: &os.SyscallError{Syscall: "connect", Err: syscall.ECONNREFUSED}}
	cases := map[string]struct {
		err  error
		want Failure
	}{
		"a deadline":                 {fmt.Errorf("httpblock: %w", context.DeadlineExceeded), FailureTimeout},
		"a network timeout":          {fmt.Errorf("httpblock: %w", &net.OpError{Op: "read", Err: timeoutError{}}), FailureTimeout},
		"an unknown host":            {fmt.Errorf("httpblock: %w", &net.DNSError{Err: "no such host", Name: "nope.invalid", IsNotFound: true}), FailureDNS},
		"a refused connection":       {fmt.Errorf("httpblock: %w", refused), FailureConnectionRefused},
		"an untrusted cert":          {fmt.Errorf("httpblock: %w", x509.UnknownAuthorityError{}), FailureTLS},
		"an unusable 2xx answer":     {fmt.Errorf("%w: %w", ErrInvalidResponse, ErrNoMatch), FailureInvalidResponse},
		"anything else":              {errors.New("httpblock: unsupported protocol scheme"), FailureOther},
		"a body read that times out": {fmt.Errorf("httpblock: read response body: %w: %w", ErrInvalidResponse, context.DeadlineExceeded), FailureTimeout},
		"a server TLS alert":         {fmt.Errorf("httpblock: %w", &net.OpError{Op: "remote error", Err: errors.New("tls: handshake failure")}), FailureTLS},
	}
	for name, tc := range cases {
		t.Run(name, func(t *testing.T) {
			assert.Equal(t, tc.want, ClassifyFailure(tc.err))
		})
	}
}
