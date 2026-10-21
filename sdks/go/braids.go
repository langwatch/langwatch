package langwatch

// Signed calls for braids, wire format version 1 of ADR-183 section 4
// (dev/docs/adr/183-braids-show-matching-spans-in-another-projects-traces.md).
// The pinned test vector in the TypeScript and Python SDKs asserts the same signature.

import (
	"bytes"
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"regexp"
	"sort"
	"strings"

	"go.opentelemetry.io/otel/attribute"
	"go.opentelemetry.io/otel/baggage"
	sdktrace "go.opentelemetry.io/otel/sdk/trace"
	"go.opentelemetry.io/otel/trace"
)

// BraidSignatureKey is the baggage entry, and the span attribute, the signature travels as.
const BraidSignatureKey = "langwatch.signature"

// BraidSignatureDomain is the first line of every signed message, naming the wire format version.
const BraidSignatureDomain = "langwatch-braid-signature-v1"

const braidSigningKeyPrefix = "lwsk_"

var braidEntryKeyPattern = regexp.MustCompile(`^[A-Za-z0-9._-]{1,128}$`)

var braidPublicIDPattern = regexp.MustCompile(`^[A-Za-z0-9]+$`)

// BraidSigningErrorCode says why signing was refused. Branch on it, not on the message.
type BraidSigningErrorCode string

const (
	BraidErrMalformedSigningKey BraidSigningErrorCode = "malformed_signing_key"
	BraidErrEmptyEntries        BraidSigningErrorCode = "empty_entries"
	BraidErrInvalidEntryKey     BraidSigningErrorCode = "invalid_entry_key"
	BraidErrInvalidEntryValue   BraidSigningErrorCode = "invalid_entry_value"
	BraidErrNoActiveTrace       BraidSigningErrorCode = "no_active_trace"
)

// BraidSigningError is returned when signing or copying is refused.
type BraidSigningError struct {
	Code    BraidSigningErrorCode
	Message string
}

func (e *BraidSigningError) Error() string { return string(e.Code) + ": " + e.Message }

func checkBraidEntryKey(key string) error {
	if !braidEntryKeyPattern.MatchString(key) || key == BraidSignatureKey {
		return &BraidSigningError{
			Code:    BraidErrInvalidEntryKey,
			Message: fmt.Sprintf("braid entry key %q must match [A-Za-z0-9._-]{1,128} and not be %s", key, BraidSignatureKey),
		}
	}
	return nil
}

func braidPublicID(signingKey string) (string, error) {
	rest, ok := strings.CutPrefix(signingKey, braidSigningKeyPrefix)
	separator := strings.IndexByte(rest, '_')
	if !ok || separator <= 0 || separator == len(rest)-1 || !braidPublicIDPattern.MatchString(rest[:separator]) {
		return "", &BraidSigningError{
			Code:    BraidErrMalformedSigningKey,
			Message: "signing key must have the form lwsk_<publicId>_<secret>, publicId in [A-Za-z0-9]",
		}
	}
	return rest[:separator], nil
}

// braidEnvelope's field order is the wire order: v, kid, keys, sig.
type braidEnvelope struct {
	V    int      `json:"v"`
	Kid  string   `json:"kid"`
	Keys []string `json:"keys"`
	Sig  string   `json:"sig"`
}

// ComputeBraidSignature returns the langwatch.signature value for these entries in this trace.
func ComputeBraidSignature(signingKey, traceID string, entries map[string]string) (string, error) {
	kid, err := braidPublicID(signingKey)
	if err != nil {
		return "", err
	}
	if len(entries) == 0 {
		return "", &BraidSigningError{Code: BraidErrEmptyEntries, Message: "a braid signature needs at least one entry"}
	}
	keys := make([]string, 0, len(entries))
	for key, value := range entries {
		if err := checkBraidEntryKey(key); err != nil {
			return "", err
		}
		if strings.ContainsAny(value, "\r\n") {
			return "", &BraidSigningError{Code: BraidErrInvalidEntryValue, Message: fmt.Sprintf("braid entry %s must not hold a line break", key)}
		}
		keys = append(keys, key)
	}
	// Byte order of UTF-8 strings is code-point order, as wire format v1 requires.
	sort.Strings(keys)
	lines := []string{BraidSignatureDomain, strings.ToLower(traceID)}
	for _, key := range keys {
		lines = append(lines, key+"="+entries[key])
	}
	mac := hmac.New(sha256.New, []byte(signingKey))
	mac.Write([]byte(strings.Join(lines, "\n")))
	sig := base64.RawURLEncoding.EncodeToString(mac.Sum(nil))

	var envelope bytes.Buffer
	encoder := json.NewEncoder(&envelope)
	encoder.SetEscapeHTML(false)
	if err := encoder.Encode(braidEnvelope{V: 1, Kid: kid, Keys: keys, Sig: sig}); err != nil {
		return "", fmt.Errorf("encode braid signature: %w", err)
	}
	return base64.RawURLEncoding.EncodeToString(bytes.TrimSuffix(envelope.Bytes(), []byte("\n"))), nil
}

// SignBaggage puts each entry in ctx's baggage under its own key, plus
// langwatch.signature over the trace id of the span in ctx.
func SignBaggage(ctx context.Context, signingKey string, entries map[string]string) (context.Context, error) {
	spanContext := trace.SpanContextFromContext(ctx)
	if !spanContext.IsValid() {
		return ctx, &BraidSigningError{
			Code:    BraidErrNoActiveTrace,
			Message: "SignBaggage needs a context holding a valid span: the signature covers its trace id",
		}
	}
	signature, err := ComputeBraidSignature(signingKey, spanContext.TraceID().String(), entries)
	if err != nil {
		return ctx, err
	}
	bag := baggage.FromContext(ctx)
	for key, value := range entries {
		if bag, err = setBraidMember(bag, key, value); err != nil {
			return ctx, err
		}
	}
	if bag, err = setBraidMember(bag, BraidSignatureKey, signature); err != nil {
		return ctx, err
	}
	return baggage.ContextWithBaggage(ctx, bag), nil
}

func setBraidMember(bag baggage.Baggage, key, value string) (baggage.Baggage, error) {
	member, err := baggage.NewMemberRaw(key, value)
	if err == nil {
		bag, err = bag.SetMember(member)
	}
	if err != nil {
		return bag, &BraidSigningError{Code: BraidErrInvalidEntryValue, Message: fmt.Sprintf("braid entry %s: %v", key, err)}
	}
	return bag, nil
}

// BraidBaggageSpanProcessor copies the named baggage entries, and
// langwatch.signature when present, onto every span as attributes of the same names.
type BraidBaggageSpanProcessor struct {
	keys []string
}

var _ sdktrace.SpanProcessor = (*BraidBaggageSpanProcessor)(nil)

// NewBraidBaggageSpanProcessor builds the called side's copy processor; add it to
// your TracerProvider with sdktrace.WithSpanProcessor.
func NewBraidBaggageSpanProcessor(copyEntries ...string) (*BraidBaggageSpanProcessor, error) {
	for _, key := range copyEntries {
		if err := checkBraidEntryKey(key); err != nil {
			return nil, err
		}
	}
	keys := append(append([]string{}, copyEntries...), BraidSignatureKey)
	return &BraidBaggageSpanProcessor{keys: keys}, nil
}

// OnStart copies the named entries from the parent context's baggage onto the span.
func (p *BraidBaggageSpanProcessor) OnStart(parent context.Context, span sdktrace.ReadWriteSpan) {
	bag := baggage.FromContext(parent)
	for _, key := range p.keys {
		if member := bag.Member(key); member.Key() != "" {
			span.SetAttributes(attribute.String(key, member.Value()))
		}
	}
}

// OnEnd does nothing.
func (p *BraidBaggageSpanProcessor) OnEnd(sdktrace.ReadOnlySpan) {}

// Shutdown does nothing.
func (p *BraidBaggageSpanProcessor) Shutdown(context.Context) error { return nil }

// ForceFlush does nothing.
func (p *BraidBaggageSpanProcessor) ForceFlush(context.Context) error { return nil }
