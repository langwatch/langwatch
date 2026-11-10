package access

import (
	"bufio"
	"bytes"
	"errors"
	"fmt"
	"io/fs"
	"os"
	"path/filepath"
	"strings"
	"sync"
)

// CatalogueDir holds the server's setting and privilege names, dumped from
// ClickHouse at image build (Dockerfile). A var so tests can point it elsewhere.
var CatalogueDir = "/usr/share/ch-config"

// Catalogue is what the server knows: each setting's type, and every privilege.
// An empty catalogue (no files, outside the image) checks nothing.
type Catalogue struct {
	settings   map[string]string
	privileges map[string]bool
}

var (
	catalogueOnce sync.Once
	catalogue     Catalogue
	catalogueErr  error
)

// ServerCatalogue loads CatalogueDir once per process.
func ServerCatalogue() (Catalogue, error) {
	catalogueOnce.Do(func() { catalogue, catalogueErr = LoadCatalogue(CatalogueDir) })
	return catalogue, catalogueErr
}

// LoadCatalogue reads settings.tsv (name, type) and privileges.tsv from dir.
func LoadCatalogue(dir string) (Catalogue, error) {
	c := Catalogue{settings: map[string]string{}, privileges: map[string]bool{}}
	if err := readTSV(filepath.Join(dir, "settings.tsv"), func(cols []string) {
		if len(cols) == 2 {
			c.settings[cols[0]] = cols[1]
		}
	}); err != nil {
		return Catalogue{}, err
	}
	if err := readTSV(filepath.Join(dir, "privileges.tsv"), func(cols []string) {
		c.privileges[strings.ToUpper(cols[0])] = true
	}); err != nil {
		return Catalogue{}, err
	}
	return c, nil
}

func readTSV(path string, row func([]string)) error {
	data, err := os.ReadFile(path)
	if errors.Is(err, fs.ErrNotExist) {
		return nil
	}
	if err != nil {
		return err
	}
	sc := bufio.NewScanner(bytes.NewReader(data))
	for sc.Scan() {
		if line := sc.Text(); line != "" {
			row(strings.Split(line, "\t"))
		}
	}
	return sc.Err()
}

func (c Catalogue) known() bool { return len(c.settings) > 0 }

// checkSettingValue refuses a name the server does not know, and a value it
// would fail to parse: either stops every reload of the users config.
func (c Catalogue) checkSettingValue(name string, value any) error {
	if !c.known() || strings.HasPrefix(name, "custom_") {
		return nil
	}
	typ, ok := c.settings[name]
	if !ok {
		return fmt.Errorf("setting %q is not a ClickHouse setting", name)
	}
	numeric := strings.HasPrefix(typ, "UInt") || strings.HasPrefix(typ, "Int") || strings.HasPrefix(typ, "NonZeroUInt") ||
		typ == "Float" || typ == "Double" || typ == "Seconds" || typ == "Milliseconds" || typ == "MaxThreads"
	switch v := value.(type) {
	case bool:
		if typ != "Bool" && typ != "BoolAuto" {
			return fmt.Errorf("setting %q is %s, not a boolean", name, typ)
		}
	case string:
		if numeric || typ == "Bool" {
			return fmt.Errorf("setting %q is %s: give a number, not %q", name, typ, v)
		}
	case int, float64:
		if typ == "Bool" && v != 0 && v != 1 && v != 0.0 && v != 1.0 {
			return fmt.Errorf("setting %q is Bool: give true, false, 0 or 1", name)
		}
	}
	return nil
}

// knowsPrivilege reports whether the server has privilege p (any case).
func (c Catalogue) knowsPrivilege(p string) bool {
	return len(c.privileges) == 0 || c.privileges[strings.ToUpper(p)]
}
