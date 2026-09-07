package bedrock

import (
	"mime"
	"testing"

	"github.com/aws/aws-sdk-go-v2/service/bedrockruntime/types"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// TestDocumentMimeType_MapsEachBedrockFormat pins every DocumentFormat the
// Bedrock Converse API accepts to its registered MIME type. The format name is
// not a MIME subtype, so a naive "application/"+format produced invalid types
// such as application/csv, application/txt and application/md.
func TestDocumentMimeType_MapsEachBedrockFormat(t *testing.T) {
	expected := map[types.DocumentFormat]string{
		types.DocumentFormatPdf:  "application/pdf",
		types.DocumentFormatCsv:  "text/csv",
		types.DocumentFormatDoc:  "application/msword",
		types.DocumentFormatDocx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
		types.DocumentFormatXls:  "application/vnd.ms-excel",
		types.DocumentFormatXlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
		types.DocumentFormatHtml: "text/html",
		types.DocumentFormatTxt:  "text/plain",
		types.DocumentFormatMd:   "text/markdown",
	}

	// Every format the SDK enumerates must be covered, so a new Bedrock format
	// cannot silently fall through to application/octet-stream.
	for _, format := range types.DocumentFormat("").Values() {
		t.Run(string(format), func(t *testing.T) {
			want, ok := expected[format]
			require.True(t, ok, "no MIME mapping asserted for Bedrock document format %q", format)
			got := documentMimeType(format)
			assert.Equal(t, want, got)

			parsed, _, err := mime.ParseMediaType(got)
			require.NoError(t, err, "%q must be a parseable media type", got)
			assert.Equal(t, got, parsed)
		})
	}

	t.Run("unknown", func(t *testing.T) {
		assert.Equal(t, "application/octet-stream", documentMimeType(""))
		assert.Equal(t, "application/octet-stream", documentMimeType(types.DocumentFormat("wat")))
	})
}
