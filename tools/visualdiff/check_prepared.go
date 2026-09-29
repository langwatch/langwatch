package visualdiff

import (
	"fmt"
	"io/fs"
	"path/filepath"
	"slices"
	"strings"
	"time"
)

// checkoutPrepare is one thing `haven up` (install, codegen) or the ui lane (ensure-built)
// would write into the checkout when output is missing or older than its inputs.
type checkoutPrepare struct {
	output  string
	inputs  []string
	command string
}

// checkoutPrepares are what check never writes into the shared checkout itself: a
// stale one is refused with the command that brings it up to date.
var checkoutPrepares = []checkoutPrepare{
	{output: "node_modules/.modules.yaml", inputs: []string{"pnpm-lock.yaml"}, command: "pnpm install"},
	{output: "packages/prisma-client/src/generated", inputs: []string{"packages/prisma-client/prisma/schema.prisma"}, command: "pnpm start:prepare:files"},
	{output: "packages/installed-server-modules/src/server-modules.generated.ts", inputs: []string{"modules/catalogue.json"}, command: "pnpm generate:modules"},
	{output: "packages/installed-web-modules/src/web-modules.generated.ts", inputs: []string{"modules/catalogue.json"}, command: "pnpm generate:modules"},
	{output: "sdks/typescript/dist/index.mjs", inputs: []string{"sdks/typescript/src"}, command: "pnpm ensure:built"},
	{output: "mcp/typescript/dist/index.js", inputs: []string{"mcp/typescript/src"}, command: "pnpm ensure:built"},
	{output: "packages/ksuid/dist/index.d.ts", inputs: []string{"packages/ksuid/src"}, command: "pnpm ensure:built"},
	{output: "packages/mail/dist/index.js", inputs: []string{"packages/mail/src"}, command: "pnpm ensure:built"},
}

// checkoutUnprepared refuses a checkout whose install, generated files or built
// packages are missing or older than their inputs, in one line naming the commands to run.
func checkoutUnprepared(root string, prepares []checkoutPrepare) error {
	var stale, commands []string
	for _, prepare := range prepares {
		written := newestUnder(filepath.Join(root, prepare.output))
		fresh := !written.IsZero()
		for _, input := range prepare.inputs {
			fresh = fresh && !newestUnder(filepath.Join(root, input)).After(written)
		}
		if fresh {
			continue
		}
		stale = append(stale, prepare.output)
		if !slices.Contains(commands, prepare.command) {
			commands = append(commands, prepare.command)
		}
	}
	if len(stale) == 0 {
		return nil
	}
	return fmt.Errorf("check does not install or generate in the shared checkout; %s missing or stale: run %s",
		strings.Join(stale, ", "), strings.Join(commands, " && "))
}

// newestUnder is the newest modification time of a file, or of any file under a directory; zero when absent.
func newestUnder(path string) time.Time {
	var newest time.Time
	_ = filepath.WalkDir(path, func(_ string, entry fs.DirEntry, err error) error {
		if err != nil || entry.IsDir() {
			return nil
		}
		if info, err := entry.Info(); err == nil && info.ModTime().After(newest) {
			newest = info.ModTime()
		}
		return nil
	})
	return newest
}
