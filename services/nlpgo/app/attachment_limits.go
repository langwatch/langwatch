package app

const mebibyte int64 = 1024 * 1024

const (
	// DefaultMaxAttachmentBytes caps a single attachment when the request names
	// no limit. Large enough for real photos, audio and PDFs, small enough to
	// refuse a runaway download.
	DefaultMaxAttachmentBytes int64 = 20 * mebibyte
	// MaxAttachmentBytesCeiling is the highest per-file limit an organization
	// can hold. A request asking for more is served at this ceiling.
	MaxAttachmentBytesCeiling int64 = 1024 * mebibyte
	// AttachmentsPerDatasetRow is how many attachments one dataset row may
	// carry inline.
	AttachmentsPerDatasetRow int64 = 10
	// DefaultMaxRequestBodyBytes is the largest request body the engine reads:
	// one dataset row with every attachment inline at the default per-file
	// limit, plus 1 MiB for its other cells and the rest of the envelope.
	//
	//	base64len(n) = ceil(n/3) * 4
	//	10 * base64len(20 MiB) + 1 MiB = 10 * 27,962,028 + 1,048,576
	//	                               = 280,668,856 bytes (about 267.7 MiB)
	//
	// The application derives the same number as `datasetRowBytes` in
	// packages/plans/src/dataset-bounds.ts (deriveDatasetBounds), so a row it
	// accepts is a row the engine can read. TestDefaultMaxRequestBodyBytes
	// recomputes it from the two inputs.
	DefaultMaxRequestBodyBytes int64 = 280668856
	// MaxAttachmentBytesHeader carries the per-request attachment limit when
	// the payload does not, and is how the engine hands the limit to a nested
	// workflow run it starts through the application.
	MaxAttachmentBytesHeader = "X-LangWatch-Max-Attachment-Bytes"
)

// ResolveMaxAttachmentBytes returns the per-file attachment limit one request
// runs under. A request that names no limit (zero, or a negative value) gets
// DefaultMaxAttachmentBytes, and one that names more than an organization can
// hold is clamped to MaxAttachmentBytesCeiling.
func ResolveMaxAttachmentBytes(requested int64) int64 {
	if requested <= 0 {
		return DefaultMaxAttachmentBytes
	}
	if requested > MaxAttachmentBytesCeiling {
		return MaxAttachmentBytesCeiling
	}
	return requested
}

// Base64Len is the length of the padded base64 encoding of n bytes.
func Base64Len(n int64) int64 {
	return (n + 2) / 3 * 4
}
