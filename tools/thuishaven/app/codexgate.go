package app

import (
	"bytes"
	"encoding/json"
	"io"
)

// GateCodex shares admission decisions with Gate and projects the Codex wire format.
func (o *Orchestrator) GateCodex(stdin io.Reader, stdout io.Writer) {
	var encoded bytes.Buffer
	o.Gate(stdin, &encoded)
	var reply hookReply
	if err := json.Unmarshal(encoded.Bytes(), &reply); err != nil {
		return
	}
	if reply.Specific.PermissionDecision == "defer" {
		reply.Specific.PermissionDecision = ""
	}
	// Codex preserves execution options around the rewritten command. Claude's
	// background/timeout fields are not part of its documented Bash rewrite.
	if reply.Specific.UpdatedInput["run_in_background"] == true {
		reply.SystemMessage = "haven: queued"
	}
	for field := range reply.Specific.UpdatedInput {
		if field != "command" {
			delete(reply.Specific.UpdatedInput, field)
		}
	}
	_ = json.NewEncoder(stdout).Encode(reply)
}
