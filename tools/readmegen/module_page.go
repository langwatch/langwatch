package readmegen

import (
	"fmt"
	"path"
	"sort"
	"strings"
)

// at is a location as a page shows it: relative to the page's directory.
func at(pageDir string, location Location) string {
	if location.File == "" {
		return ""
	}
	file := location.File
	if strings.HasPrefix(file, pageDir+"/") {
		file = strings.TrimPrefix(file, pageDir+"/")
	} else {
		file = strings.TrimSuffix(relativeLink(pageDir, file), "/README.md")
	}
	return code(fmt.Sprintf("%s:%d", file, location.Line))
}

// leaves renders secret or config leaves as `name` (VARIABLE), an unfolded one with ≈.
func leaves(list []Leaf) string {
	parts := make([]string, 0, len(list))
	for _, leaf := range list {
		value := leaf.Value
		if !leaf.Resolved {
			value = "≈ " + code(leaf.Text)
		}
		if leaf.Name == "" || (!leaf.Resolved && leaf.Name == leaf.Text) {
			parts = append(parts, value)
			continue
		}
		parts = append(parts, code(leaf.Name)+" ("+value+")")
	}
	return strings.Join(parts, ", ")
}

func (g *generator) installedBy(entry catalogueEntry) string {
	var parts []string
	for _, half := range []string{"process", "browser"} {
		pkg := g.ws.half(entry, half)
		if pkg == nil || len(g.ws.installed[pkg.Name]) == 0 {
			continue
		}
		parts = append(parts, strings.Join(g.ws.installed[pkg.Name], ", ")+" ("+half+")")
	}
	return strings.Join(parts, "; ")
}

func (g *generator) glance(entry catalogueEntry, facts ModuleFacts) string {
	dir := entry.Root
	rows := [][]string{
		{"Classification", entry.Classification + " (`modules/catalogue.json`)"},
		{"Subjects", strings.Join(entry.Subjects, ", ")},
		{"Halves", g.halves(entry, true)},
	}
	for _, token := range facts.Tokens {
		label := "Other token"
		value := code(token.Name) + ", " + at(dir, token.At)
		if token.Module == entry.ID && facts.API != nil && token.Type == facts.API.Name {
			label = "Api token"
			value = code(token.Name) + " = " + code(fmt.Sprintf("moduleApi<%s>()(%q)", token.Type, token.Module)) +
				", " + at(dir, token.At) + " (" + plural(len(facts.API.Operations), "operation") + ")"
		}
		rows = append(rows, []string{label, cell(value)})
	}
	if facts.API == nil {
		rows = append(rows, []string{"Api token", "none"})
	}
	rows = append(rows, []string{"Installed by", orDash(g.installedBy(entry))})
	return "## At a glance\n\n" + table([]string{"", ""}, rows)
}

// accessedRow lists the models a module reaches by type but does not claim.
func (g *generator) accessedRow(dir string, facts *ModuleFacts, claimed map[string]bool) []string {
	var accessed []string
	var first Location
	for _, delegate := range facts.PrismaDelegates {
		model := g.ws.modelOfDelegate(delegate.Delegate)
		switch {
		case strings.HasPrefix(delegate.Delegate, "$"), claimed[model]:
			continue
		case model == "":
			model = "≈" + delegate.Delegate
		}
		if len(accessed) == 0 {
			first = delegate.At
		}
		accessed = append(accessed, code(model))
	}
	if len(accessed) == 0 {
		return nil
	}
	return []string{"Postgres, accessed not claimed", strings.Join(accessed, ", "), at(dir, first)}
}

// postgresRows are the models a module claims, then those it reaches by type without a claim.
func (g *generator) postgresRows(dir string, facts *ModuleFacts) [][]string {
	var rows [][]string
	claimed := map[string]bool{}
	for _, claim := range facts.PrismaClaims {
		name := code(claim.Model)
		if table := g.ws.models[claim.Model]; table != "" && table != claim.Model {
			name += " (" + code(table) + ")"
		}
		claimed[claim.Model] = true
		rows = append(rows, []string{"Postgres table", name, at(dir, claim.At)})
	}
	if row := g.accessedRow(dir, facts, claimed); row != nil {
		rows = append(rows, row)
	}
	return rows
}

func (g *generator) owns(entry catalogueEntry, facts ModuleFacts) string {
	dir := entry.Root
	rows := g.postgresRows(dir, &facts)
	for _, write := range facts.ClickhouseWrites {
		rows = append(rows, []string{"ClickHouse table (writes)", code(write.Table), at(dir, write.At)})
	}
	for _, stores := range facts.Stores {
		value := strings.Join(stores.Requires, ", ")
		if !stores.Resolved {
			value = "≈ " + code(value)
		}
		rows = append(rows, []string{"Stores required", value, at(dir, stores.At)})
	}
	if len(facts.Secrets) > 0 {
		rows = append(rows, []string{"Secrets", leaves(facts.Secrets), at(dir, facts.Secrets[0].At)})
	}
	if len(facts.Config) > 0 {
		rows = append(rows, []string{"Config", leaves(facts.Config), at(dir, facts.Config[0].At)})
	}
	for index := range rows {
		rows[index] = []string{cell(rows[index][0]), cell(rows[index][1]), cell(rows[index][2])}
	}
	heading := "## What " + entry.ID + " owns\n\n"
	closing := "\nAnything else " + entry.ID + " needs belongs to another module and is reached through its `*Api`.\n"
	if len(rows) == 0 {
		return heading + "No table, store, secret or config: " + entry.ID + " declares none.\n" + closing
	}
	return heading + table([]string{"Kind", "Name", "Declared at"}, rows) + closing
}

func (g *generator) peers(entry catalogueEntry, facts ModuleFacts) string {
	heading := "## Peers (static dependencies)\n\n"
	if len(facts.Peers) == 0 {
		return heading + "None: " + entry.ID + " declares no peers.\n"
	}
	list := append([]Peer(nil), facts.Peers...)
	sort.SliceStable(list, func(i, j int) bool { return list[i].Name < list[j].Name })
	var rows [][]string
	for _, peer := range list {
		module := "≈ unresolved"
		if peer.Resolved {
			module = link(peer.Module, relativeLink(entry.Root, g.pageRoot[peer.Module]))
		}
		token := orDash(peer.Token)
		if token != "–" {
			token = code(token)
		}
		rows = append(rows, []string{code(peer.Name), token, module})
	}
	return heading + table([]string{"Name", "Token", "Module"}, rows)
}

func (g *generator) dependants(entry catalogueEntry) string {
	heading := "## Who depends on " + entry.ID + "\n\n"
	users := g.reverse[entry.ID]
	if len(users) == 0 {
		return heading + "No module names " + entry.ID + " as a peer.\n"
	}
	parts := make([]string, 0, len(users))
	for _, id := range users {
		parts = append(parts, link(id, relativeLink(entry.Root, g.pageRoot[id])))
	}
	return heading + strings.Join(parts, ", ") + " (as a peer).\n"
}

func (g *generator) modulePage(entry catalogueEntry) page {
	facts := g.facts[entry.ID]
	body := strings.Join([]string{
		g.glance(entry, facts),
		g.owns(entry, facts),
		g.peers(entry, facts),
		g.dependants(entry),
	}, "\n")
	return page{Path: path.Join(entry.Root, "README.md"), Title: entry.ID, Body: body}
}

func plural(count int, noun string) string {
	if count == 1 {
		return "1 " + noun
	}
	return fmt.Sprintf("%d %ss", count, noun)
}
