package cmd

import (
	"encoding/json"
	"fmt"
	"strconv"

	"github.com/langwatch/langwatch/tools/thuishaven/cmd/viewer/sources"
)

// simErrorFlag is the --error flag the analytics, mail and storage `set` verbs share.
var simErrorFlag = flagSpec{long: "--error", takesValue: true, value: "<status>", summary: "set: force this 4xx/5xx (0 turns it off)"}

// simSetForcedError is `haven sim <noun> fault <0|4xx|5xx|off>` over the sim's /_sim/api/settings.
func simSetForcedError(api sources.SimAPI, noun string, inv invocation, asJSON bool) error {
	if !inv.has("--error") {
		return fmt.Errorf("usage: haven sim %s fault <0|4xx|5xx|off>", noun)
	}
	status, err := strconv.Atoi(inv.value("--error"))
	if err != nil {
		return fmt.Errorf("--error %q is not a status code; use 0 to turn it off", inv.value("--error"))
	}
	var saved json.RawMessage
	if err := api.Put("/_sim/api/settings", map[string]int{"forcedError": status}, &saved); err != nil {
		return err
	}
	if asJSON {
		return printSimRaw(saved)
	}
	fmt.Printf("forced error: %d\n", status)
	return nil
}
