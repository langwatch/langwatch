package httpblock

import (
	"context"
	"crypto/tls"
	"crypto/x509"
	"errors"
	"net"
	"syscall"
)

// Failure names why a request to the author's endpoint failed, so the test
// panel can say what the author can do about it. The endpoint's own answer
// (a non-2xx status and body) is an UpstreamError, not one of these.
type Failure string

// The failures ClassifyFailure tells apart; FailureOther is everything else.
const (
	FailureTimeout           Failure = "timeout"
	FailureDNS               Failure = "dns"
	FailureConnectionRefused Failure = "connection_refused"
	FailureTLS               Failure = "tls"
	FailureInvalidResponse   Failure = "invalid_response"
	FailureOther             Failure = "other"
)

// ErrInvalidResponse marks a 2xx answer the block could not use: a body that
// could not be read, or an output path that does not match it.
var ErrInvalidResponse = errors.New("invalid response")

// ClassifyFailure sorts a transport or extraction error into a Failure. An
// error it cannot name is FailureOther, never a guess.
// Transport causes are tested before ErrInvalidResponse: a body read that
// times out carries both, and the timeout is what the author can fix.
func ClassifyFailure(err error) Failure {
	var dnsErr *net.DNSError
	if errors.As(err, &dnsErr) && !dnsErr.IsTimeout {
		return FailureDNS
	}
	if errors.Is(err, context.DeadlineExceeded) {
		return FailureTimeout
	}
	var netErr net.Error
	if errors.As(err, &netErr) && netErr.Timeout() {
		return FailureTimeout
	}
	if errors.Is(err, syscall.ECONNREFUSED) {
		return FailureConnectionRefused
	}
	if isTLSFailure(err) {
		return FailureTLS
	}
	if errors.Is(err, ErrInvalidResponse) {
		return FailureInvalidResponse
	}

	return FailureOther
}

func isTLSFailure(err error) bool {
	var verification *tls.CertificateVerificationError
	var record tls.RecordHeaderError
	var alert tls.AlertError
	var unknownAuthority x509.UnknownAuthorityError
	var hostname x509.HostnameError
	var invalid x509.CertificateInvalidError

	// A TCP TLS client reports the server's alert as a "remote error"
	// OpError around an unexported alert type; tls.AlertError is QUIC-only.
	var op *net.OpError
	remoteAlert := errors.As(err, &op) && op.Op == "remote error"

	return remoteAlert || errors.As(err, &verification) || errors.As(err, &record) ||
		errors.As(err, &alert) || errors.As(err, &unknownAuthority) ||
		errors.As(err, &hostname) || errors.As(err, &invalid)
}
