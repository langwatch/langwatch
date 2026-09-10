package shapemod

import (
	"bytes"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestPlanFileFoldConvertsFullyAbstractClass(t *testing.T) {
	content := `/** Generates opaque identifiers. */
export abstract class ThingIdPort {
  abstract next(): string;
}
`
	plan := planFileFold("modules/thing/server/src/ports/thing-id.port.ts", content)
	if plan.Status != "FOLD" {
		t.Fatalf("status = %q, want FOLD (reason: %s)", plan.Status, plan.Reason)
	}
	if len(plan.Blocks) != 1 || plan.Blocks[0].Name != "ThingIdPort" {
		t.Fatalf("blocks = %+v", plan.Blocks)
	}
	if !strings.Contains(plan.Blocks[0].Text, "export interface ThingIdPort {") {
		t.Fatalf("block text does not declare an interface:\n%s", plan.Blocks[0].Text)
	}
	if strings.Contains(plan.Blocks[0].Text, "abstract") {
		t.Fatalf("block text still carries the abstract keyword:\n%s", plan.Blocks[0].Text)
	}
	if !strings.Contains(plan.Blocks[0].Text, "Generates opaque identifiers") {
		t.Fatalf("block text dropped the JSDoc:\n%s", plan.Blocks[0].Text)
	}
}

func TestPlanFileFoldCopiesInterfaceAndTypeAsIs(t *testing.T) {
	content := `export type ThingMessage = {
  id: string;
};

export abstract class ThingPublisherPort {
  abstract publish(message: ThingMessage): Promise<void>;
}

export abstract class ThingSubscriberPort {
  abstract subscribe(onMessage: (message: ThingMessage) => void): Promise<() => Promise<void>>;
}
`
	plan := planFileFold("modules/thing/server/src/ports/thing-channel.port.ts", content)
	if plan.Status != "FOLD" {
		t.Fatalf("status = %q, want FOLD (reason: %s)", plan.Status, plan.Reason)
	}
	if len(plan.Blocks) != 3 {
		t.Fatalf("blocks = %d, want 3: %+v", len(plan.Blocks), plan.Blocks)
	}
	kinds := map[string]string{}
	for _, b := range plan.Blocks {
		kinds[b.Name] = b.Kind
	}
	if kinds["ThingMessage"] != "type" || kinds["ThingPublisherPort"] != "classToInterface" || kinds["ThingSubscriberPort"] != "classToInterface" {
		t.Fatalf("kinds = %+v", kinds)
	}
}

func TestPlanFileFoldSkipsConcreteClass(t *testing.T) {
	content := `export abstract class ThingActivityPort {
  abstract track(event: string): void;
}

export class SilentThingActivity extends ThingActivityPort {
  track(): void {}
}
`
	plan := planFileFold("modules/thing/server/src/ports/thing-activity.port.ts", content)
	if plan.Status != "SKIP" {
		t.Fatalf("status = %q, want SKIP", plan.Status)
	}
	if !strings.Contains(plan.Reason, "SilentThingActivity") {
		t.Fatalf("reason = %q, want it to name the concrete class", plan.Reason)
	}
}

func TestPlanFileFoldSkipsConstructorOrConcreteMethod(t *testing.T) {
	cases := []struct {
		name    string
		content string
		want    string
	}{
		{
			name: "constructor",
			content: `export abstract class ThingPort {
  constructor(private readonly value: string) {}
  abstract get(): string;
}
`,
			want: "constructor",
		},
		{
			name: "concrete method",
			content: `export abstract class ThingPort extends Base {
  helper(): string { return "x"; }
}
`,
			want: "extends",
		},
		{
			name: "initialised field",
			content: `export abstract class ThingPort {
  private readonly cache = new Map<string, string>();
  abstract get(key: string): string | undefined;
}
`,
			want: "initialised field",
		},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			plan := planFileFold("modules/thing/server/src/ports/thing.port.ts", c.content)
			if plan.Status != "SKIP" {
				t.Fatalf("status = %q, want SKIP", plan.Status)
			}
			if !strings.Contains(plan.Reason, c.want) {
				t.Fatalf("reason = %q, want it to mention %q", plan.Reason, c.want)
			}
		})
	}
}

func TestExtractCarriedImportsDropsSiblingFoldReferencesKeepsOthers(t *testing.T) {
	root := t.TempDir()
	portsDir := filepath.Join(root, "modules/thing/server/src/ports")
	if err := os.MkdirAll(portsDir, 0o755); err != nil {
		t.Fatal(err)
	}
	content := `import type { Logger } from "@langwatch/observability";
import type { ThingHttpPort } from "./thing-http.port.ts";

export abstract class ThingFactoryPort {
  abstract build(logger: Logger, http: ThingHttpPort): unknown;
}
`
	folded := map[string]bool{filepath.Join(portsDir, "thing-http.port.ts"): true}
	carried := extractCarriedImports(content, portsDir, folded)
	if len(carried) != 1 || carried[0].Specifier != "@langwatch/observability" {
		t.Fatalf("carried = %+v, want only the observability import kept", carried)
	}
}

func TestMergeImportsIntoFileUnionsExistingSpecifier(t *testing.T) {
	content := `import type { A } from "@langwatch/x";

export interface ThingInfrastructure {}
`
	merged := mergeImportsIntoFile(content, []carriedImport{
		{Specifier: "@langwatch/x", TypeOnly: true, Names: []string{"B"}},
		{Specifier: "@langwatch/y", TypeOnly: true, Names: []string{"C"}},
	})
	if !strings.Contains(merged, `import type { A, B } from "@langwatch/x";`) {
		t.Fatalf("existing specifier not unioned:\n%s", merged)
	}
	if !strings.Contains(merged, `import type { C } from "@langwatch/y";`) {
		t.Fatalf("new specifier not added:\n%s", merged)
	}
}

func TestAddMembersToInterfaceInsertsBeforeClosingBrace(t *testing.T) {
	content := `export interface ThingInfrastructure {
  pepper: string;
}
`
	updated, err := addMembersToInterface(content, "ThingInfrastructure", []string{"clock: ThingClock;"})
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(updated, "pepper: string;") || !strings.Contains(updated, "clock: ThingClock;") {
		t.Fatalf("updated = %s", updated)
	}
}

func TestRewriteHeritageAndImportsRepointsImportAndHeritage(t *testing.T) {
	root := t.TempDir()
	moduleDir := "modules/thing"
	oldPath := filepath.Join(moduleDir, "server/src/ports/thing-id.port.ts")
	infraPath := filepath.Join(moduleDir, "server/src/app/thing.infrastructure.ts")
	adapterPath := filepath.Join(moduleDir, "server/src/adapters/thing-id.adapter.ts")

	writeFixture(t, root, oldPath, `export abstract class ThingIdPort {
  abstract next(): string;
}
`)
	writeFixture(t, root, infraPath, `export interface ThingInfrastructure {
  export interface ThingIdPort { next(): string; }
}
`)
	writeFixture(t, root, adapterPath, `import { ThingIdPort } from "../ports/thing-id.port.ts";

export class ThingIdAdapter extends ThingIdPort {
  private constructor() {
    super();
  }

  next(): string {
    return "x";
  }
}
`)

	if err := rewriteHeritageAndImports(root, moduleDir, oldPath, infraPath, "ThingIdPort"); err != nil {
		t.Fatal(err)
	}

	data, err := os.ReadFile(filepath.Join(root, adapterPath))
	if err != nil {
		t.Fatal(err)
	}
	got := string(data)
	if !strings.Contains(got, `from "../app/thing.infrastructure.ts"`) {
		t.Fatalf("import not repointed:\n%s", got)
	}
	if !strings.Contains(got, "implements ThingIdPort") {
		t.Fatalf("heritage not rewritten to implements:\n%s", got)
	}
	if strings.Contains(got, "super();") {
		t.Fatalf("bare super() call was not removed:\n%s", got)
	}
}

func TestFindInfraFileReusesExistingInterface(t *testing.T) {
	root := t.TempDir()
	moduleDir := "modules/thing"
	appPath := filepath.Join(moduleDir, "server/src/app/thing.app.ts")
	writeFixture(t, root, appPath, `export interface ThingInfrastructure {
  pepper: string;
}

export class ThingApp {}
`)
	path, name, found := findInfraFile(root, moduleDir)
	if !found {
		t.Fatal("found = false, want true")
	}
	if path != appPath || name != "ThingInfrastructure" {
		t.Fatalf("path = %q name = %q", path, name)
	}
}

func TestFindInfraFileCreatesDefaultWhenNoneExists(t *testing.T) {
	root := t.TempDir()
	moduleDir := "modules/thing"
	path, name, found := findInfraFile(root, moduleDir)
	if found {
		t.Fatal("found = true, want false")
	}
	want := filepath.Join(moduleDir, "server/src/app/thing.infrastructure.ts")
	if path != want || name != "ThingInfrastructure" {
		t.Fatalf("path = %q name = %q, want %q ThingInfrastructure", path, name, want)
	}
}

func TestInfraDryRunReportsFoldAndSkipWithoutWriting(t *testing.T) {
	root := t.TempDir()
	moduleDir := "modules/thing"
	writeFixture(t, root, filepath.Join(moduleDir, "server/src/app/thing.app.ts"), `export interface ThingInfrastructure {
  pepper: string;
}
`)
	writeFixture(t, root, filepath.Join(moduleDir, "server/src/ports/thing-id.port.ts"), `export abstract class ThingIdPort {
  abstract next(): string;
}
`)
	writeFixture(t, root, filepath.Join(moduleDir, "server/src/ports/thing-activity.port.ts"), `export abstract class ThingActivityPort {
  abstract track(event: string): void;
}

export class SilentThingActivity extends ThingActivityPort {
  track(): void {}
}
`)

	runner := &fakeRunner{}
	var stdout, stderr bytes.Buffer
	result, code := Infra(root, moduleDir, false, runner, &stdout, &stderr)
	if code != 0 {
		t.Fatalf("code = %d, want 0; stderr:\n%s", code, stderr.String())
	}
	if result.Applied {
		t.Fatal("Applied = true on a dry run")
	}
	if runner.diagnosticsCalls != 0 || runner.renameFileCalls != 0 || len(runner.renameCalls) != 0 {
		t.Fatal("dry run must not touch the runner")
	}
	byPath := map[string]InfraFileEntry{}
	for _, e := range result.Entries {
		byPath[filepath.Base(e.Path)] = e
	}
	if byPath["thing-id.port.ts"].Status != "FOLD" {
		t.Fatalf("thing-id.port.ts = %+v, want FOLD", byPath["thing-id.port.ts"])
	}
	// Two subjects in one file is a plan-time split, decided by Classify
	// before infra.go ever sees a tier - reported OUT-OF-SCOPE here, not
	// FOLD/SKIP, since it never reached the fold-eligibility check.
	if byPath["thing-activity.port.ts"].Status != "OUT-OF-SCOPE" {
		t.Fatalf("thing-activity.port.ts = %+v, want OUT-OF-SCOPE", byPath["thing-activity.port.ts"])
	}
	if _, err := os.Stat(filepath.Join(root, moduleDir, "server/src/ports/thing-id.port.ts")); err != nil {
		t.Fatal("dry run deleted the port file")
	}
}

func TestInfraApplyFoldsWritesInfraFileAndDeletesPort(t *testing.T) {
	root := t.TempDir()
	moduleDir := "modules/thing"
	appPath := filepath.Join(moduleDir, "server/src/app/thing.app.ts")
	portPath := filepath.Join(moduleDir, "server/src/ports/thing-id.port.ts")
	adapterPath := filepath.Join(moduleDir, "server/src/adapters/thing-id.adapter.ts")

	writeFixture(t, root, appPath, `export interface ThingInfrastructure {
  pepper: string;
}
`)
	writeFixture(t, root, portPath, `export abstract class ThingIdPort {
  abstract next(): string;
}
`)
	writeFixture(t, root, adapterPath, `import { ThingIdPort } from "../ports/thing-id.port.ts";

export class ThingIdAdapter extends ThingIdPort {
  next(): string {
    return "x";
  }
}
`)

	runner := &fakeRunner{}
	var stdout, stderr bytes.Buffer
	result, code := Infra(root, moduleDir, true, runner, &stdout, &stderr)
	if code != 0 {
		t.Fatalf("code = %d, want 0; stderr:\n%s", code, stderr.String())
	}
	if !result.Applied || result.Aborted {
		t.Fatalf("applied = %v aborted = %v", result.Applied, result.Aborted)
	}
	if _, err := os.Stat(filepath.Join(root, portPath)); !os.IsNotExist(err) {
		t.Fatal("port file was not deleted")
	}
	infraData, err := os.ReadFile(filepath.Join(root, appPath))
	if err != nil {
		t.Fatal(err)
	}
	infra := string(infraData)
	if !strings.Contains(infra, "export interface ThingIdPort {") {
		t.Fatalf("infra file missing folded interface:\n%s", infra)
	}
	if !strings.Contains(infra, "thingId: ThingIdPort;") {
		t.Fatalf("infra file missing added member:\n%s", infra)
	}
	adapterData, err := os.ReadFile(filepath.Join(root, adapterPath))
	if err != nil {
		t.Fatal(err)
	}
	adapter := string(adapterData)
	if !strings.Contains(adapter, `from "../app/thing.app.ts"`) {
		t.Fatalf("adapter import not repointed:\n%s", adapter)
	}
	if !strings.Contains(adapter, "implements ThingIdPort") {
		t.Fatalf("adapter heritage not rewritten:\n%s", adapter)
	}
	if runner.diagnosticsCalls == 0 {
		t.Fatal("diagnostics was never run")
	}
	if len(runner.renameCalls) != 1 || runner.renameCalls[0].symbol != "ThingIdPort" || runner.renameCalls[0].newName != "ThingId" {
		t.Fatalf("renameCalls = %+v", runner.renameCalls)
	}
}
