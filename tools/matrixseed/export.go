package matrixseed

import (
	"fmt"
	"io"
	"strings"
)

// WriteExports masks every value on log, then appends NAME=value lines to env
// (the job's $GITHUB_ENV file). The mask goes first, so a value can never reach
// the job environment, and from there a later step's log, unmasked.
func WriteExports(log, env io.Writer, exports []Export) error {
	for _, e := range exports {
		if strings.ContainsAny(e.Value, "\r\n") {
			return fmt.Errorf("%s holds a line break, which $GITHUB_ENV cannot carry on one line", e.Name)
		}
	}
	for _, e := range exports {
		if _, err := fmt.Fprintf(log, "::add-mask::%s\n", e.Value); err != nil {
			return err
		}
	}
	for _, e := range exports {
		if _, err := fmt.Fprintf(env, "%s=%s\n", e.Name, e.Value); err != nil {
			return err
		}
	}
	return nil
}

// Report writes what the run seeded and skipped, naming variables, never values.
func Report(w io.Writer, r Result) {
	for _, e := range r.Exports {
		_, _ = fmt.Fprintf(w, "seeded   %s\n", e.Name)
	}
	for _, s := range r.Skipped {
		_, _ = fmt.Fprintf(w, "skipped  %s: no %s, so its cells skip\n", s.Provider.Export, strings.Join(s.Missing, ", "))
	}
	for _, f := range r.Failures {
		_, _ = fmt.Fprintf(w, "::error::the control plane refused to seed %s: %v\n", f.Provider.Name, f.Err)
	}
	for _, warning := range r.Warnings {
		_, _ = fmt.Fprintf(w, "::warning::%s\n", warning)
	}
}
