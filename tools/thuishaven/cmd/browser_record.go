package cmd

import (
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"
)

// `haven browser record|replay`: the daemon records a lane's actions as a
// script of stable locators and the app queries each one caused
// (apps/haven-web/scripts/browser-record.ts); this file is its CLI half.

const recordUsage = "usage: haven browser record <start|stop|export> --lane <name> | record export <script> --playwright <out.spec.ts>"

// recordVerb turns `record <sub> ...` into the daemon verb (or "export", which is local).
func recordVerb(inv invocation) (string, invocation, error) {
	if len(inv.args) < 2 {
		return "", inv, errors.New(recordUsage)
	}
	switch sub := inv.args[1]; sub {
	case "start", "stop":
		inv.args = append([]string{"record-" + sub}, inv.args[2:]...)
		return "record-" + sub, inv, nil
	case "export":
		inv.args = inv.args[1:]
		return "export", inv, nil
	}
	return "", inv, errors.New(recordUsage)
}

type recordedLocator struct {
	By    string `json:"by"`
	Value string `json:"value"`
	Name  string `json:"name,omitempty"`
	Nth   *int   `json:"nth,omitempty"`
}

type recordedStep struct {
	Verb    string           `json:"verb"`
	URL     string           `json:"url,omitempty"`
	Locator *recordedLocator `json:"locator,omitempty"`
	Target  *recordedLocator `json:"target,omitempty"`
	By      *struct {
		DX int `json:"dx"`
		DY int `json:"dy"`
	} `json:"by,omitempty"`
	Text   string `json:"text,omitempty"`
	Key    string `json:"key,omitempty"`
	Native bool   `json:"native,omitempty"`
	Expect struct {
		URL     string `json:"url"`
		Queries []struct {
			Method string `json:"method"`
			Path   string `json:"path"`
			Status int    `json:"status"`
		} `json:"queries"`
	} `json:"expect"`
}

type recordedScript struct {
	Version  int            `json:"version"`
	StartURL string         `json:"startUrl,omitempty"`
	Steps    []recordedStep `json:"steps"`
}

func readScript(path string) (recordedScript, error) {
	var script recordedScript
	data, err := os.ReadFile(path)
	if err != nil {
		return script, err
	}
	if err := json.Unmarshal(data, &script); err != nil || script.Version != 1 {
		return script, fmt.Errorf("%s is not a haven browser script (version 1)", path)
	}
	return script, nil
}

// writeScript saves the daemon's recorded script, indented so a diff reads line by line.
func writeScript(reply map[string]any, out any, asJSON bool) error {
	path, _ := out.(string)
	data := []byte(jsonText(reply["script"], "  "))
	if err := os.MkdirAll(filepath.Dir(path), 0o750); err != nil {
		return err
	}
	if err := os.WriteFile(path, data, 0o600); err != nil {
		return err
	}
	if asJSON {
		return json.NewEncoder(os.Stdout).Encode(map[string]any{"file": path})
	}
	fmt.Println(path)
	return nil
}

// printReplay reports a replay; a divergence is also the command's error, so the exit is non-zero.
func printReplay(reply map[string]any, asJSON bool) error {
	if asJSON {
		if err := json.NewEncoder(os.Stdout).Encode(reply); err != nil {
			return err
		}
	}
	if ok, _ := reply["ok"].(bool); ok {
		if !asJSON {
			fmt.Printf("replayed %v steps\n", reply["steps"])
		}
		return nil
	}
	div, _ := reply["divergence"].(map[string]any)
	return fmt.Errorf("replay diverged at step %v (%v): expected %v, got %v", div["step"], div["action"], div["expected"], div["got"])
}

func exportScript(inv invocation) error {
	out := inv.value("--playwright")
	if len(inv.args) < 2 || out == "" {
		return errors.New(recordUsage)
	}
	script, err := readScript(inv.args[1])
	if err != nil {
		return err
	}
	if err := os.MkdirAll(filepath.Dir(out), 0o750); err != nil {
		return err
	}
	if err := os.WriteFile(out, []byte(playwrightTest(script)), 0o600); err != nil {
		return err
	}
	fmt.Println(out)
	return nil
}

// q quotes s as a TypeScript string literal, leaving < and > readable.
func q(s string) string { return strings.TrimSpace(jsonText(s, "")) }

// jsonText encodes v as JSON without escaping HTML characters.
func jsonText(v any, indent string) string {
	var b strings.Builder
	enc := json.NewEncoder(&b)
	enc.SetEscapeHTML(false)
	enc.SetIndent("", indent)
	_ = enc.Encode(v)
	return b.String()
}

func (l recordedLocator) ts() string {
	var expr string
	switch l.By {
	case "role":
		expr = fmt.Sprintf("page.getByRole(%s, { name: %s, exact: true })", q(l.Value), q(l.Name))
	case "label":
		expr = fmt.Sprintf("page.getByLabel(%s, { exact: true })", q(l.Value))
	case "testid":
		expr = fmt.Sprintf("page.getByTestId(%s)", q(l.Value))
	case "placeholder":
		expr = fmt.Sprintf("page.getByPlaceholder(%s, { exact: true })", q(l.Value))
	case "text":
		expr = fmt.Sprintf("page.getByText(%s, { exact: true })", q(l.Value))
	default:
		expr = fmt.Sprintf("page.locator(%s)", q(l.Value))
	}
	if l.Nth != nil {
		expr += fmt.Sprintf(".nth(%d)", *l.Nth)
	}
	return expr
}

// playwrightTest writes the script as a test in dev/tests/agentic-e2e's style: the
// repo's own test fixture (already signed in by the config), paths not origins.
func playwrightTest(script recordedScript) string {
	var b strings.Builder
	b.WriteString("import { expect, test } from \"../test.ts\";\n\n")
	b.WriteString("test(\"recorded flow\", async ({ page }) => {\n")
	if script.StartURL != "" {
		fmt.Fprintf(&b, "  await page.goto(%s);\n", q(script.StartURL))
	}
	for _, step := range script.Steps {
		b.WriteString(step.ts())
		if step.Expect.URL != "" {
			fmt.Fprintf(&b, "  await expect.poll(() => new URL(page.url()).pathname).toBe(%s);\n", q(step.Expect.URL))
		}
	}
	b.WriteString("});\n")
	return b.String()
}

// ts is the Playwright statement for one step.
func (step recordedStep) ts() string {
	loc := ""
	if step.Locator != nil {
		loc = step.Locator.ts()
	}
	switch step.Verb {
	case "goto":
		return fmt.Sprintf("  await page.goto(%s);\n", q(step.URL))
	case "click":
		return fmt.Sprintf("  await %s.click();\n", loc)
	case "hover":
		return fmt.Sprintf("  await %s.hover();\n", loc)
	case "drag":
		return step.dragTS(loc)
	case "fill":
		return fmt.Sprintf("  await %s.fill(%s);\n", loc, q(step.Text))
	case "select":
		if step.Native {
			return fmt.Sprintf("  await %s.selectOption({ label: %s });\n", loc, q(step.Text))
		}
		return fmt.Sprintf("  await %s.click();\n  await page.getByRole(\"option\", { name: %s, exact: true }).click();\n", loc, q(step.Text))
	case "type":
		return fmt.Sprintf("  await page.keyboard.type(%s);\n", q(step.Text))
	case "press":
		return fmt.Sprintf("  await page.keyboard.press(%s);\n", q(step.Key))
	}
	return ""
}

// dragTS drags with real mouse moves: React Flow and sortable lists ignore a jump from down to up.
func (step recordedStep) dragTS(loc string) string {
	var b strings.Builder
	fmt.Fprintf(&b, "  {\n    const from = (await %s.boundingBox())!;\n", loc)
	b.WriteString("    await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);\n    await page.mouse.down();\n")
	if step.Target != nil {
		fmt.Fprintf(&b, "    const to = (await %s.boundingBox())!;\n", step.Target.ts())
		b.WriteString("    await page.mouse.move(to.x + to.width / 2, to.y + to.height / 2, { steps: 12 });\n")
	} else if step.By != nil {
		fmt.Fprintf(&b, "    await page.mouse.move(from.x + from.width / 2 + %d, from.y + from.height / 2 + %d, { steps: 12 });\n", step.By.DX, step.By.DY)
	}
	b.WriteString("    await page.mouse.up();\n  }\n")
	return b.String()
}
