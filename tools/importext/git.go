package importext

import (
	"context"
	"os/exec"
	"strings"
)

// dirtyPaths returns every path git reports as changed in the working tree,
// relative to the repository root, including both sides of a rename.
func dirtyPaths(root string) (map[string]bool, error) {
	command := exec.CommandContext(context.Background(), "git", "status", "--porcelain=v1", "-z")
	command.Dir = root
	output, err := command.Output()
	if err != nil {
		return nil, err
	}
	return parsePorcelain(string(output)), nil
}

func parsePorcelain(output string) map[string]bool {
	dirty := make(map[string]bool)
	entries := strings.Split(output, "\x00")
	for index := 0; index < len(entries); index++ {
		entry := entries[index]
		if len(entry) < 4 {
			continue
		}
		dirty[entry[3:]] = true
		if entry[0] == 'R' || entry[0] == 'C' {
			index++
			if index < len(entries) && entries[index] != "" {
				dirty[entries[index]] = true
			}
		}
	}
	return dirty
}
