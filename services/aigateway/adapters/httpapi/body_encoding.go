package httpapi

import (
	"compress/gzip"
	"compress/zlib"
	"errors"
	"fmt"
	"io"
	"net/http"
	"strings"

	"github.com/andybalholm/brotli"
	"github.com/klauspost/compress/zstd"

	"github.com/langwatch/langwatch/pkg/herr"
	"github.com/langwatch/langwatch/services/aigateway/domain"
)

// errDecodedBodyTooLarge stops a compression bomb: a few KiB on the wire can
// expand to gigabytes, so the decoded stream carries the same ceiling as the
// raw one instead of inheriting only the network-side cap.
var errDecodedBodyTooLarge = errors.New("decoded request body exceeds the size limit")

// prepareRequestBody caps the request stream at maxBytes and, when the client
// compressed the payload, swaps r.Body for a reader that yields the decoded
// bytes. Every lane past this point (model peek, stream detection, guardrails,
// the provider adapters) reads plain JSON off r.Body, so a compressed body has
// to be decoded at the transport edge or none of them see a parsable payload.
//
// Coding-agent clients do send compressed request bodies: codex 0.145 posts
// `Content-Encoding: zstd` to /v1/responses once the user is signed in with an
// OpenAI account.
func prepareRequestBody(w http.ResponseWriter, r *http.Request, maxBytes int64) error {
	r.Body = http.MaxBytesReader(w, r.Body, maxBytes)

	encodings := contentEncodings(r.Header.Get("Content-Encoding"))
	if len(encodings) == 0 {
		return nil
	}

	// Content-Encoding lists the transforms in the order they were applied,
	// so undo them from the outside in.
	raw := r.Body
	var reader io.Reader = raw
	var decoders []io.Closer
	for i := len(encodings) - 1; i >= 0; i-- {
		decoded, closer, err := decodeStream(encodings[i], reader, maxBytes)
		if err != nil {
			// The decoders already built for the outer layers hold buffers and,
			// for zstd, a decode goroutine. Nothing installs decodedRequestBody
			// on this path, so they have to be released here or a stream of
			// malformed chained requests leaks them.
			_ = closeAll(decoders)
			return herr.New(r.Context(), domain.ErrBadRequest, herr.M{"message": err.Error()})
		}
		reader = decoded
		if closer != nil {
			decoders = append(decoders, closer)
		}
	}

	// The header described the bytes on the wire, not the body the rest of the
	// gateway now reads. Dropping it keeps the passthrough lanes from
	// forwarding an encoding claim that no longer matches the payload.
	r.Header.Del("Content-Encoding")
	r.ContentLength = -1
	r.Body = &decodedRequestBody{
		Reader:  &boundedReader{r: reader, remaining: maxBytes},
		closers: append([]io.Closer{raw}, decoders...),
	}
	return nil
}

// contentEncodings splits a Content-Encoding header into the transforms that
// actually need undoing. `identity` is the explicit no-op spelling.
func contentEncodings(header string) []string {
	if header == "" {
		return nil
	}
	var out []string
	for _, part := range strings.Split(header, ",") {
		enc := strings.ToLower(strings.TrimSpace(part))
		if enc == "" || enc == "identity" {
			continue
		}
		out = append(out, enc)
	}
	return out
}

// decodeStream wraps r with the decoder for one content coding. The returned
// closer, when non-nil, releases the decoder's own resources and is closed
// along with the request body.
func decodeStream(encoding string, r io.Reader, maxBytes int64) (io.Reader, io.Closer, error) {
	switch encoding {
	case "gzip", "x-gzip":
		zr, err := gzip.NewReader(r)
		if err != nil {
			return nil, nil, fmt.Errorf("malformed gzip request body")
		}
		return zr, zr, nil
	case "deflate":
		zr, err := zlib.NewReader(r)
		if err != nil {
			return nil, nil, fmt.Errorf("malformed deflate request body")
		}
		return zr, zr, nil
	case "br":
		return brotli.NewReader(r), nil, nil
	case "zstd":
		// One decode goroutine and an explicit output ceiling: the default
		// decoder spins up a worker per core and will happily allocate for
		// whatever the frame header claims.
		zr, err := zstd.NewReader(r,
			zstd.WithDecoderConcurrency(1),
			zstd.WithDecoderMaxMemory(uint64(maxBytes)),
		)
		if err != nil {
			return nil, nil, fmt.Errorf("malformed zstd request body")
		}
		rc := zr.IOReadCloser()
		return rc, rc, nil
	default:
		return nil, nil, fmt.Errorf("unsupported content-encoding: %s", encoding)
	}
}

// decodedRequestBody is the io.ReadCloser installed on the request in place of
// the raw stream. Closing it closes the decoders and then the original body.
type decodedRequestBody struct {
	io.Reader
	closers []io.Closer
}

func (d *decodedRequestBody) Close() error {
	return closeAll(d.closers)
}

// closeAll releases closers in reverse of the order they were built, so an
// inner decoder is done with its source before that source is closed.
func closeAll(closers []io.Closer) error {
	var firstErr error
	for i := len(closers) - 1; i >= 0; i-- {
		if err := closers[i].Close(); err != nil && firstErr == nil {
			firstErr = err
		}
	}
	return firstErr
}

// boundedReader fails the read once the decoded stream passes remaining bytes.
type boundedReader struct {
	r         io.Reader
	remaining int64
}

func (b *boundedReader) Read(p []byte) (int, error) {
	if b.remaining < 0 {
		return 0, errDecodedBodyTooLarge
	}
	// Read one byte past the budget so going over is detectable rather than
	// silently truncating the payload.
	if int64(len(p)) > b.remaining+1 {
		p = p[:b.remaining+1]
	}
	n, err := b.r.Read(p)
	b.remaining -= int64(n)
	if b.remaining < 0 {
		return n, errDecodedBodyTooLarge
	}
	return n, err
}

// bodyReadErrorCode classifies a failure to read the (possibly decoded)
// request body: over either ceiling is 413, anything else is a bad request.
func bodyReadErrorCode(err error) herr.Code {
	var mbe *http.MaxBytesError
	if errors.As(err, &mbe) ||
		errors.Is(err, errDecodedBodyTooLarge) ||
		errors.Is(err, zstd.ErrDecoderSizeExceeded) {
		return domain.ErrPayloadTooLarge
	}
	return domain.ErrBadRequest
}
