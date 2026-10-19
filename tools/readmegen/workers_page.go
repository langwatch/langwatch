package readmegen

import (
	"regexp"
	"strings"
)

func (g *generator) workerSection(entry catalogueEntry, dir string, process *ProcessFacts) string {
	var tasks []Task
	if process.Installation != nil {
		tasks = process.Installation.Tasks
	}
	if len(process.Pipelines) == 0 && len(tasks) == 0 {
		return "## Workers\n\nNone: " + entry.ID + " declares no pipeline, process manager, subscriber or task.\n"
	}
	out := "## Workers\n"
	for index := range process.Pipelines {
		out += "\n" + g.pipelineSection(dir, &process.Pipelines[index])
	}
	if len(tasks) > 0 {
		var rows [][]string
		for index := range tasks {
			task := &tasks[index]
			rows = append(rows, []string{code(task.Name.String()), code(task.ClassName), at(dir, task.At)})
		}
		out += "\n### Tasks\n\nRun by the tasks process, before serve.\n\n" + table([]string{"Task", "Class", "Declared at"}, rows)
	}
	return out
}

// pipelineRows collects a pipeline's table; Built shows only when the chain splits.
type pipelineRows struct {
	dir   string
	split bool
	rows  [][]string
}

// pipelineRow is one declared part of a pipeline as its table shows it.
type pipelineRow struct {
	kind, name, handles string
	gated               bool
	at                  Location
}

func (p *pipelineRows) add(item pipelineRow) {
	row := []string{item.kind, cell(item.name), cell(orDash(item.handles)), at(p.dir, item.at)}
	if p.split {
		built := "always"
		if item.gated {
			built = "past the early build"
		}
		row = append(row, built)
	}
	p.rows = append(p.rows, row)
}

func (p *pipelineRows) table() string {
	header := []string{"Kind", "Name", "Handles", "Declared at"}
	if p.split {
		header = append(header, "Built")
	}
	return table(header, p.rows)
}

func (g *generator) pipelineSection(dir string, pipeline *Pipeline) string {
	out := "### Pipeline " + code(pipeline.Name.String()) + " (aggregate " + code(pipeline.Aggregate.String()) + ")\n\n"
	out += "Declared at " + at(dir, pipeline.At) + "."
	if len(pipeline.Events) > 0 {
		out += " Events: " + strings.Join(codes(pipeline.Events), ", ") + "."
	}
	out += "\n"
	rows := &pipelineRows{dir: dir, split: pipeline.Split != ""}
	if rows.split {
		out += "\nThe chain builds early when " + code(pipeline.Split) + " (" + at(dir, *pipeline.SplitAt) +
			"); the rows built only past that return say so. The caller's arguments decide which role gets which build.\n"
	}
	for index := range pipeline.Commands {
		command := &pipeline.Commands[index]
		rows.add(pipelineRow{"command", named(command.Name), "", command.Gated, command.At})
	}
	for index := range pipeline.ProcessManagers {
		manager := &pipeline.ProcessManagers[index]
		rows.add(pipelineRow{"process manager", code(manager.Name.String()), managerHandles(manager), manager.Gated, manager.At})
	}
	for index := range pipeline.Subscribers {
		subscriber := &pipeline.Subscribers[index]
		rows.add(pipelineRow{subscriber.Kind, code(subscriber.Name.String()), g.subscriberHandles(dir, subscriber), subscriber.Gated, subscriber.At})
	}
	for index := range pipeline.Others {
		other := &pipeline.Others[index]
		rows.add(pipelineRow{splitWords(other.Kind), named(other.Name), "", other.Gated, other.At})
	}
	if len(rows.rows) == 0 {
		return out
	}
	return out + "\n" + rows.table()
}

func managerHandles(manager *ProcessManager) string {
	if !manager.Read {
		return "≈ applier " + code(manager.Applier)
	}
	var parts []string
	if manager.Schedule != nil {
		parts = append(parts, period(manager.Schedule))
	}
	if len(manager.Intents) > 0 {
		intents := "intents " + strings.Join(codes(manager.Intents), ", ")
		if manager.Outbox {
			intents += " (outbox)"
		}
		parts = append(parts, intents)
	}
	return strings.Join(parts, "; ")
}

func (g *generator) subscriberHandles(dir string, subscriber *Subscriber) string {
	if subscriber.EventType == nil {
		if subscriber.Kind == "peer subscriber" {
			return "≈ event type not read"
		}
		return ""
	}
	if !subscriber.EventType.Resolved {
		return "≈ " + code(subscriber.EventType.Text)
	}
	out := strings.Join(codes(strings.Split(subscriber.EventType.Value, ", ")), ", ")
	if subscriber.Publisher != "" && g.pageRoot[subscriber.Publisher] != "" {
		out += " from " + link(subscriber.Publisher, relativeLink(dir, g.pageRoot[subscriber.Publisher]))
	}
	return out
}

var wordBoundary = regexp.MustCompile(`([a-z])([A-Z])`)

// splitWords turns a builder suffix such as `ClickHouseFoldProjection` into words.
func splitWords(name string) string {
	words := strings.Fields(wordBoundary.ReplaceAllString(strings.ReplaceAll(name, "ClickHouse", "Clickhouse"), "$1 $2"))
	for index, word := range words {
		switch word {
		case "Clickhouse":
			words[index] = "ClickHouse"
		case "Postgres":
		default:
			words[index] = strings.ToLower(word)
		}
	}
	return strings.Join(words, " ")
}

// named is a folded name in code, or an en dash when the declaration names nothing.
func named(name Scalar) string {
	if name.Resolved && name.Value == "" || !name.Resolved && name.Text == "" {
		return "–"
	}
	return code(name.String())
}
