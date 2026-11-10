package access

import (
	"bufio"
	"bytes"
	"context"
	"errors"
	"fmt"
	"io/fs"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"sync"
	"time"
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
	if value == nil {
		return nil
	}
	return checkWithServerParser(name, fmt.Sprint(value))
}

// checkWithServerParser parses value with the server's own parser, so a value
// ClickHouse would refuse on loading users.d (an unknown enum, an out-of-range
// number) refuses the access file instead. Its answer is cached per value.
var checkWithServerParser = func(name, value string) error {
	key := name + "\x00" + value
	if err, ok := parsedValues.Load(key); ok {
		return errOrNil(err)
	}
	err := clickhouseLocalParses(name, value)
	if !errors.Is(err, context.DeadlineExceeded) {
		parsedValues.Store(key, err)
	}
	return err
}

var (
	parsedValues sync.Map
	localOnce    sync.Once
	localBinary  string // empty when clickhouse local cannot run here
)

func errOrNil(v any) error {
	if err, ok := v.(error); ok {
		return err
	}
	return nil
}

// clickhouseLocalParses hands the setting to clickhouse local as an argument,
// never as SQL text. Where it cannot run at all (outside the image, no writable
// /tmp) it checks nothing, so only the setting itself can refuse a file.
func clickhouseLocalParses(name, value string) error {
	localOnce.Do(func() {
		if bin, err := exec.LookPath("clickhouse"); err == nil && runLocal(bin) == nil {
			localBinary = bin
		}
	})
	if localBinary == "" {
		return nil
	}
	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
	defer cancel()
	out, err := exec.CommandContext(ctx, localBinary, "local", "--query", "SELECT 1", "--"+name+"="+value).CombinedOutput()
	if err == nil {
		return nil
	}
	if ctx.Err() != nil {
		return fmt.Errorf("checking setting %q: %w", name, ctx.Err())
	}
	reason, _, _ := strings.Cut(strings.TrimSpace(string(out)), "\n")
	return fmt.Errorf("setting %q = %q is refused by ClickHouse: %s", name, value, reason)
}

// knowsPrivilege reports whether the server has privilege p (any case).
func (c Catalogue) knowsPrivilege(p string) bool {
	return len(c.privileges) == 0 || c.privileges[strings.ToUpper(p)]
}

func runLocal(bin string, args ...string) error {
	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
	defer cancel()
	return exec.CommandContext(ctx, bin, append([]string{"local", "--query", "SELECT 1"}, args...)...).Run()
}
