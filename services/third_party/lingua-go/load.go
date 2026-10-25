package lingua

import (
	"fmt"
	"sync"
)

var loadOnce struct {
	sync.Once
	err error
}

// LoadModels maps cmd/genmodels' models.bin from path, read in place, and
// builds the index. It runs once per process; later calls answer the first
// call's error. Until it succeeds every lookup misses.
func LoadModels(path string) error {
	loadOnce.Do(func() {
		blob, err := mapFile(path)
		if err != nil {
			loadOnce.err = fmt.Errorf("lingua models %s: %w", path, err)
			return
		}
		modelsBin = blob
		modelIndex = buildModelIndex(blob)
	})
	return loadOnce.err
}
