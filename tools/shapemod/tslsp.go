package shapemod

import (
	"bytes"
	"fmt"
	"os/exec"
	"strconv"
)

// Runner shells out to tslsp-cli. A real Runner always runs from the
// module's server directory (the one holding tsconfig.json) so consumers in
// other workspace packages are found.
type Runner interface {
	RenameFile(dir, oldPath, newPath string) (string, error)
	Rename(dir, symbol, newName string) (string, error)
	// RenameAtLine renames the symbol declared at path:line, the fallback
	// when a plain --symbol rename comes back ambiguous. tslsp-cli's locator
	// needs the symbol alongside file+line to disambiguate a line that
	// itself carries more than one identifier.
	RenameAtLine(dir, path string, line int, symbol, newName string) (string, error)
	Diagnostics(dir, path string) (string, error)
}

// TslspRunner shells out to `npx --no-install @0xdeafcafe/tslsp-cli`.
type TslspRunner struct{}

func (TslspRunner) run(dir string, args ...string) (string, error) {
	cmd := exec.Command("npx", append([]string{"--no-install", "@0xdeafcafe/tslsp-cli"}, args...)...)
	cmd.Dir = dir
	var out bytes.Buffer
	cmd.Stdout = &out
	cmd.Stderr = &out
	err := cmd.Run()
	if err != nil {
		return out.String(), fmt.Errorf("tslsp-cli %v: %w\n%s", args, err, out.String())
	}
	return out.String(), nil
}

func (r TslspRunner) RenameFile(dir, oldPath, newPath string) (string, error) {
	return r.run(dir, "rename-file", oldPath, newPath)
}

func (r TslspRunner) Rename(dir, symbol, newName string) (string, error) {
	return r.run(dir, "rename", "--symbol", symbol, "--new-name", newName)
}

func (r TslspRunner) RenameAtLine(dir, path string, line int, symbol, newName string) (string, error) {
	return r.run(dir, "rename", "--file", path, "--line", strconv.Itoa(line), "--symbol", symbol, "--new-name", newName)
}

func (r TslspRunner) Diagnostics(dir, path string) (string, error) {
	return r.run(dir, "diagnostics", "--file", path)
}
