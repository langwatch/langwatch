//go:build lingua_models

package lingua

import _ "embed"

// modelsBin is cmd/genmodels' output: every language model as flat sorted
// records, read in place from the binary's read-only data.
//
//go:embed models.bin
var modelsBin string
