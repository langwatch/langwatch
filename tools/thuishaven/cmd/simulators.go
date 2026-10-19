package cmd

import (
	"encoding/json"
	"fmt"
	"os"

	"github.com/langwatch/langwatch/tools/thuishaven/cmd/viewer/sources"
)

func printSimulator(d deps, inv invocation, name string) error {
	slug, err := tabSlug(d, inv)
	if err != nil {
		return err
	}
	for _, service := range d.orch.SessionSnapshot(slug).Services {
		if service.Name != name || service.Port == 0 {
			continue
		}
		items, err := sources.ReadSimulator(service.Port, name)
		if err != nil {
			return err
		}
		return json.NewEncoder(os.Stdout).Encode(items)
	}
	return fmt.Errorf("%s is not running in %s; start it with haven up +%s", name, slug, name)
}
