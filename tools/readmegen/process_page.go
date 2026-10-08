package readmegen

import (
	"encoding/json"
	"fmt"
	"path"
	"strconv"
	"strings"
)

// processPage is a module's process half: installation, Api, doors, workers, configuration.
func (g *generator) processPage(entry catalogueEntry, pkg *workspacePackage) page {
	facts := g.facts[entry.ID]
	dir := pkg.Dir
	process := &facts.Process
	schemas := g.schemas.forPage()
	sections := []string{
		g.installation(entry, dir, process),
		moduleAPI(dir, facts),
		restSection(dir, process.Rest, schemas),
		trpcSection(dir, process.Trpc, schemas),
		socketSection(dir, process.Sockets),
		g.workerSection(entry, dir, process),
		configSection(dir, facts),
	}
	return page{Path: path.Join(dir, "README.md"), Title: pkg.Name, Body: strings.Join(sections, "\n")}
}

func (g *generator) installation(entry catalogueEntry, dir string, process *ProcessFacts) string {
	out := "## Installation\n\n"
	if process.Installation == nil {
		return out + "≈ No `defineProcessModule(...)` read in `src/`.\n"
	}
	out += code(process.Installation.Text) + ", " + at(dir, process.Installation.At) + ".\n"
	if pkg := g.ws.half(entry, "process"); pkg != nil && len(g.ws.installed[pkg.Name]) > 0 {
		out += "\nInstalled by " + strings.Join(g.ws.installed[pkg.Name], ", ") +
			", from each app's generated module list (`pnpm generate:modules`).\n"
	}
	return out
}

func moduleAPI(dir string, facts ModuleFacts) string {
	if facts.API == nil {
		return "## Module API\n\nNone: this module exports no `*Api` token of its own.\n"
	}
	api := facts.API
	out := "## Module API (" + code(api.Name) + ")\n\n"
	if api.Doc != "" {
		out += oneLine(api.Doc) + "\n\n"
	}
	out += "Peers call these through the token, declared at " + at(dir, api.At) + "; nothing else in this package is public.\n"
	if len(api.Extends) > 0 {
		out += "It extends " + strings.Join(codes(api.Extends), ", ") + ".\n"
	}
	for _, operation := range api.Operations {
		out += "\n#### " + code(operation.Name) + "\n\n"
		if operation.Doc != "" {
			out += oneLine(operation.Doc) + "\n\n"
		}
		out += "```typescript\n" + operation.Name + "(" + operation.Params + "): " + operation.Returns + ";\n```\n"
	}
	return out
}

func restSection(dir string, families []RestFamily, schemas schemaIndex) string {
	if len(families) == 0 {
		return "## REST transport\n\nNone: this module declares no REST family.\n"
	}
	out := "## REST transport\n"
	for index := range families {
		out += "\n" + restFamily(dir, &families[index], schemas)
	}
	return out
}

func restFamily(dir string, family *RestFamily, schemas schemaIndex) string {
	title := family.Name
	if title == "" {
		title = family.Namespace.String()
	}
	rows := [][]string{{"Declared at", at(dir, family.At)}, {"Base URL", baseURL(family)},
		{"Addressing", family.Addressing}, {"Credential", family.Credential}}
	if versions := familyVersions(family); versions != "" {
		rows = append(rows, []string{"Versions", versions})
	}
	if family.Deprecated {
		rows = append(rows, []string{"Deprecated", "yes"})
	}
	for index := range rows {
		rows[index][1] = cell(rows[index][1])
	}
	out := "### " + code(title) + "\n\n" + table([]string{"", ""}, rows)
	for index := range family.Routes {
		out += "\n" + schemas.restRoute(dir, family, &family.Routes[index])
	}
	return out
}

func baseURL(family *RestFamily) string {
	if !familyResolved(family) {
		return "≈ namespace " + code(family.Namespace.String())
	}
	base := basePathOf(family)
	if base == "" {
		return "none: each route's path is its address"
	}
	if alias := canonicalV1Path(base); family.V1Twin && alias != "" {
		return code(base) + ", twin " + code(alias)
	}
	return code(base)
}

func familyVersions(family *RestFamily) string {
	versions := []string{}
	if family.Addressing == "dated" {
		versions = append(versions, code(family.Version.String()))
	}
	for index := range family.Routes {
		version := family.Routes[index].Version
		if version != "" && !contains(versions, code(version)) {
			versions = append(versions, code(version))
		}
	}
	return strings.Join(versions, ", ")
}

func (schemas schemaIndex) restRoute(dir string, family *RestFamily, route *RestRoute) string {
	out := "#### " + code(strings.Join(routeMethods(route), ",")+" "+route.Path.String()) + " · " + code(route.Operation.String()) + "\n\n"
	if route.Summary != "" {
		out += oneLine(route.Summary) + "\n\n"
	}
	facts := []string{gateText(route.Gate)}
	if route.Entitlement != nil {
		facts = append(facts, entitlementText(*route.Entitlement))
	}
	if route.Credential != "" {
		facts = append(facts, "Credential "+code(route.Credential)+".")
	}
	if route.Hidden {
		facts = append(facts, "Hidden from the OpenAPI document.")
	}
	if route.Deprecated {
		facts = append(facts, "Deprecated.")
	}
	facts = append(facts, "Declared at "+at(dir, route.At)+".")
	out += strings.Join(facts, " ") + "\n"
	if familyResolved(family) {
		out += "\n" + addressLine(route, family) + "\n"
	}
	if len(route.Schemas) > 0 {
		out += "\n```typescript\n"
		for _, schema := range route.Schemas {
			out += schemas.line(dir, schema, schemas.restSchema(family, route, schema.Role))
		}
		out += "```\n"
	}
	return out
}

func addressLine(route *RestRoute, family *RestFamily) string {
	var shown, hidden []string
	for _, address := range addressesOf(route, family) {
		paths := []string{code(address.path)}
		if address.alias != "" {
			paths = append(paths, code(address.alias))
		}
		if address.documented {
			shown = append(shown, paths...)
		} else {
			hidden = append(hidden, paths...)
		}
	}
	line := "Answers at " + strings.Join(shown, ", ")
	if len(hidden) > 0 {
		line += "; also, undocumented, " + strings.Join(hidden, ", ")
	}
	return line + "."
}

// schemaLine prints a schema as TypeScript when it was converted and is short,
// else names it and links to where it is declared.
func schemaLine(dir string, schema SchemaRef, raw json.RawMessage) string {
	label := strings.ToUpper(schema.Role[:1]) + strings.ReplaceAll(schema.Role[1:], " ", "")
	where := strings.Trim(at(dir, schema.At), "`")
	if printed := declaration(label, raw); printed != "" {
		name := schema.Name
		if schema.Inline {
			name = "inline"
		}
		return "// " + label + ": " + name + ", " + where + "\n" + printed
	}
	if schema.Inline {
		return "// " + label + ": " + schema.Name + " (inline, " + where + ")\n"
	}
	return "type " + label + " = z.infer<typeof " + schema.Name + ">; // " + where + "\n"
}

func gateText(gate Gate) string {
	if !gate.Resolved {
		return "Gate ≈ " + code(gate.Detail) + "."
	}
	switch gate.Kind {
	case "permission":
		return "Permission " + code(gate.Detail) + "."
	case "platform permission":
		return "Platform permission " + code(gate.Detail) + "."
	case "none":
		return "No gate declared."
	}
	label := strings.ToUpper(gate.Kind[:1]) + gate.Kind[1:]
	if gate.Detail == "" {
		return label + "."
	}
	return label + ": " + strings.TrimSuffix(oneLine(gate.Detail), ".") + "."
}

func entitlementText(entitlement Entitlement) string {
	out := "Entitlement " + code(entitlement.Entitlement)
	if entitlement.Feature != "" {
		out += " (feature " + code(entitlement.Feature) + ")"
	}
	return out + "."
}

func trpcSection(dir string, routers []TrpcRouter, schemas schemaIndex) string {
	if len(routers) == 0 {
		return "## tRPC transport\n\nNone: this module declares no tRPC router.\n"
	}
	out := "## tRPC transport\n"
	for index := range routers {
		router := &routers[index]
		out += "\n### " + code(router.Namespace.String()) + "\n\nContract " + at(dir, router.ContractAt) +
			", router " + at(dir, router.At) + ".\n\n"
		var rows [][]string
		for inner := range router.Procedures {
			procedure := &router.Procedures[inner]
			gate := strings.TrimSuffix(gateText(procedure.Gate), ".")
			if !procedure.Implemented {
				gate = "≈ not implemented by this router"
			}
			if procedure.Entitlement != nil {
				gate += "; " + strings.TrimSuffix(entitlementText(*procedure.Entitlement), ".")
			}
			rows = append(rows, []string{
				code(router.Namespace.Value + "." + procedure.Name), procedure.Kind, cell(gate),
				schemaCell(procedure.Input), schemaCell(procedure.Output),
			})
		}
		out += table([]string{"Procedure", "Kind", "Gate", "Input", "Output"}, rows)
		out += trpcContracts(dir, router, schemas)
	}
	return out
}

// trpcContracts is one block of each procedure's input and output, printed from zod.
func trpcContracts(dir string, router *TrpcRouter, schemas schemaIndex) string {
	var blocks []string
	for inner := range router.Procedures {
		procedure := &router.Procedures[inner]
		block := ""
		for _, ref := range []*SchemaRef{procedure.Input, procedure.Output} {
			if ref != nil {
				block += schemas.line(dir, *ref, schemas.trpcSchema(router, procedure, ref.Role))
			}
		}
		if block != "" {
			blocks = append(blocks, "// "+router.Namespace.Value+"."+procedure.Name+"\n"+block)
		}
	}
	if len(blocks) == 0 {
		return ""
	}
	return "\n```typescript\n" + strings.Join(blocks, "\n") + "```\n"
}

func schemaCell(schema *SchemaRef) string {
	switch {
	case schema == nil:
		return "–"
	case schema.Inline:
		return "inline"
	default:
		return code(schema.Name)
	}
}

func socketSection(dir string, sockets []Socket) string {
	if len(sockets) == 0 {
		return "## Sockets\n\nNone: this module declares no websocket, rawsocket or rawhttp door.\n"
	}
	var rows [][]string
	for index := range sockets {
		socket := &sockets[index]
		rows = append(rows, []string{socket.Protocol, cell(scalars(socket.Paths)), cell(orDash(scalars(socket.Prefixes))), at(dir, socket.At)})
	}
	return "## Sockets\n\n" + table([]string{"Protocol", "Paths", "Prefixes", "Declared at"}, rows)
}

func scalars(values []Scalar) string {
	parts := make([]string, 0, len(values))
	for _, value := range values {
		if value.Resolved {
			parts = append(parts, code(value.Value))
		} else {
			parts = append(parts, "≈ "+code(value.Text))
		}
	}
	return strings.Join(parts, ", ")
}

func oneLine(text string) string {
	return strings.Join(strings.Fields(text), " ")
}

func codes(list []string) []string {
	out := make([]string, len(list))
	for index, item := range list {
		out[index] = code(item)
	}
	return out
}

// period is a schedule's interval in the largest whole unit, e.g. "every 60 s".
func period(schedule *Schedule) string {
	if !schedule.EveryMs.Resolved {
		return "every ≈ " + code(schedule.EveryMs.Text)
	}
	ms, err := strconv.ParseFloat(schedule.EveryMs.Value, 64)
	if err != nil {
		return "every " + schedule.EveryMs.Value + " ms"
	}
	text := fmt.Sprintf("every %g ms", ms)
	for _, unit := range []struct {
		size float64
		name string
	}{{86_400_000, "d"}, {3_600_000, "h"}, {60_000, "min"}, {1000, "s"}} {
		if ms >= unit.size && int64(ms)%int64(unit.size) == 0 {
			text = fmt.Sprintf("every %g %s", ms/unit.size, unit.name)
			break
		}
	}
	if schedule.Source != "" {
		text += " (" + code(schedule.Source) + ")"
	}
	return text
}

func configSection(dir string, facts ModuleFacts) string {
	var rows [][]string
	for _, group := range []struct {
		kind   string
		leaves []Leaf
	}{{"secret", facts.Secrets}, {"config", facts.Config}} {
		for _, leaf := range group.leaves {
			value := code(leaf.Value)
			if !leaf.Resolved {
				value = "≈ " + code(leaf.Text)
			}
			rows = append(rows, []string{group.kind, code(orDash(leaf.Name)), cell(value), at(dir, leaf.At)})
		}
	}
	if len(rows) == 0 {
		return "## Configuration\n\nNone: no `static secrets` or `static config` leaf.\n"
	}
	return "## Configuration\n\n" + table([]string{"Kind", "Leaf", "Environment variable", "Declared at"}, rows)
}
