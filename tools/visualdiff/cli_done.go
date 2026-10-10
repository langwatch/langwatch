package visualdiff

import (
	"errors"
	"flag"
	"fmt"
	"path/filepath"
	"time"
)

// doneCommand marks a section done, lists the ledger, or removes an entry.
func doneCommand(args []string, streams Streams) int {
	flags := flag.NewFlagSet("done", flag.ContinueOnError)
	flags.SetOutput(streams.Err)
	root := flags.String("root", ".", "repository root")
	runID := flags.String("run", "", "run id whose proof is kept (its .visualdiff/<runID> directory)")
	route := flags.String("route", "", "route path to mark done")
	flow := flags.String("flow", "", "flow id to mark done")
	edition := flags.String("edition", string(EditionEnterprise), "edition the section was captured in")
	note := flags.String("note", "", "why the section is done")
	force := flags.Bool("force", false, "mark a section done despite a failing class")
	list := flags.Bool("list", false, "print the ledger")
	undo := flags.String("undo", "", "remove the entry with this key (see -list)")
	if err := flags.Parse(args); err != nil {
		return ExitOperational
	}
	absoluteRoot, err := filepath.Abs(*root)
	if err == nil {
		err = runDone(absoluteRoot, doneInputs{
			runID: *runID, route: *route, flow: *flow, edition: *edition, note: *note,
			force: *force, list: *list, undo: *undo,
		}, streams)
	}
	if err != nil {
		fmt.Fprintln(streams.Err, "visualdiff:", err)
		return ExitOperational
	}
	return ExitClean
}

// doneInputs are one `visualdiff done` command line's raw values.
type doneInputs struct {
	runID, route, flow, edition, note, undo string
	force, list                             bool
}

func runDone(root string, inputs doneInputs, streams Streams) error {
	switch {
	case inputs.list:
		ledger, err := LoadDoneLedger(root)
		if err == nil {
			WriteDoneList(streams.Out, ledger)
		}
		return err
	case inputs.undo != "":
		if err := UndoDone(root, inputs.undo); err != nil {
			return err
		}
		fmt.Fprintf(streams.Out, "done: removed %s\n", inputs.undo)
		return nil
	}
	request, err := doneRequest(root, inputs)
	if err != nil {
		return err
	}
	entry, err := MarkDone(request)
	if err != nil {
		return err
	}
	fmt.Fprintf(streams.Out, "done: %s %v, proof in %s\n", entry.Key, entry.Classes, filepath.Join(doneRoot(root), filepath.FromSlash(entry.Key)))
	return nil
}

func doneRequest(root string, inputs doneInputs) (DoneRequest, error) {
	if inputs.runID == "" || (inputs.route == "") == (inputs.flow == "") {
		return DoneRequest{}, errors.New("done: want -run with exactly one of -route or -flow, or -list, or -undo KEY")
	}
	editions, err := ParseEditions(inputs.edition)
	if err != nil || len(editions) != 1 {
		return DoneRequest{}, errors.New("done: -edition wants exactly one of enterprise or free")
	}
	request := DoneRequest{
		Root: root, RunID: inputs.runID, Edition: editions[0], Kind: "route", Section: inputs.route,
		Note: inputs.note, Force: inputs.force, Now: time.Now(),
	}
	if inputs.flow != "" {
		request.Kind, request.Section = "flow", inputs.flow
	}
	return request, nil
}
