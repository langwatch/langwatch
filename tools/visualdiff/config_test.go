package visualdiff

import (
	"os"
	"path/filepath"
	"testing"
)

const sampleConfig = `viewport: 1440x900
settle:
  quietMillis: 500
  deadlineMillis: 20000
routes:
  - /{slug}/traces
  - /settings
flows:
  - id: automation-create
    title: Create an automation
    steps:
      - action: createAutomation
        with:
          name: VD Automation
  - id: prompt-create
    title: Add a prompt
    steps:
      - action: createPrompt
`

// @scenario An unknown action in visualdiff.yaml is refused before anything boots
func TestUnknownActionIsRefused(t *testing.T) {
	path := filepath.Join(t.TempDir(), ConfigFile)
	mustWrite(t, path, `routes: ["/"]
flows:
  - id: broken
    title: Broken
    steps:
      - action: teleport
`)

	_, err := LoadConfig(path)

	if err == nil {
		t.Fatal("an unknown action was accepted")
	}
	mustContain(t, err.Error(), `unknown action "teleport"`)
}

func TestLoadConfigReadsRoutesAndFlows(t *testing.T) {
	path := filepath.Join(t.TempDir(), ConfigFile)
	mustWrite(t, path, sampleConfig)

	config, err := LoadConfig(path)

	if err != nil {
		t.Fatal(err)
	}
	if len(config.Routes) != 2 || config.Routes[0] != "/{slug}/traces" {
		t.Fatalf("routes: %v", config.Routes)
	}
	if len(config.Flows) != 2 || config.Flows[0].Steps[0].Action != "createAutomation" {
		t.Fatalf("flows: %+v", config.Flows)
	}
	if config.Settle.QuietMillis != 500 || config.Settle.DeadlineMillis != 20000 {
		t.Fatalf("settle: %+v", config.Settle)
	}
}

// @scenario "-routes and -flows re-check only what they name"
func TestSelectNarrowsAndRefusesUnknownNames(t *testing.T) {
	config := &Config{Routes: []string{"/", "/x"}, Flows: []Flow{
		{ID: "a", Steps: []Step{{Action: "go"}}},
		{ID: "b", Steps: []Step{{Action: "go"}}},
	}}

	narrowed, err := config.Select(nil, []string{"b"})

	if err != nil {
		t.Fatal(err)
	}
	if len(narrowed.Flows) != 1 || narrowed.Flows[0].ID != "b" || len(narrowed.Routes) != 0 {
		t.Fatalf("naming a flow runs only that flow: %+v", narrowed)
	}
	if len(narrowed.DeclaredRoutes()) != 2 {
		t.Fatalf("coverage still sees every route: %v", narrowed.DeclaredRoutes())
	}
	routes, err := config.Select([]string{"/x"}, nil)
	if err != nil || len(routes.Routes) != 1 || routes.Routes[0] != "/x" || len(routes.Flows) != 0 {
		t.Fatalf("naming a route runs only that route: %+v %v", routes, err)
	}
	if kept, _ := config.Select(nil, nil); kept != config {
		t.Fatal("naming nothing keeps everything")
	}
	if _, err := config.Select(nil, []string{"nope"}); err == nil {
		t.Fatal("an unknown flow name was accepted")
	}
	if _, err := config.Select([]string{"/nope"}, nil); err == nil {
		t.Fatal("an unknown route was accepted")
	}
}

func TestValidateRefusesAnEmptyOrDuplicatedConfiguration(t *testing.T) {
	if err := (&Config{}).Validate(); err == nil {
		t.Fatal("a configuration with nothing to capture was accepted")
	}
	duplicate := &Config{Routes: []string{"/"}, Flows: []Flow{
		{ID: "a", Steps: []Step{{Action: "go"}}},
		{ID: "a", Steps: []Step{{Action: "go"}}},
	}}
	if err := duplicate.Validate(); err == nil {
		t.Fatal("a flow declared twice was accepted")
	}
}

func TestParseViewportRefusesNonsense(t *testing.T) {
	viewport, err := ParseViewport("390x844")
	if err != nil || viewport.Width != 390 || viewport.Height != 844 {
		t.Fatalf("390x844: %+v %v", viewport, err)
	}
	for _, bad := range []string{"", "1440", "1440x", "axb", "0x900", "-1x900"} {
		if _, err := ParseViewport(bad); err == nil {
			t.Fatalf("%q was accepted as a viewport", bad)
		}
	}
}

// TestRepositoryConfigIsValid keeps the checked-in visualdiff.yaml honest: an
// unknown action or a duplicated flow in it would only surface at the start of
// a run that takes twenty minutes to get there.
func TestRepositoryConfigIsValid(t *testing.T) {
	path := filepath.Join("..", "..", ConfigFile)
	if _, err := os.Stat(path); err != nil {
		t.Skipf("no %s in the repository root", ConfigFile)
	}

	config, err := LoadConfig(path)

	if err != nil {
		t.Fatal(err)
	}
	if len(config.Routes) == 0 {
		t.Fatal("the repository configuration lists no routes")
	}
}

// @scenario Flows load from flows/*.yaml beside visualdiff.yaml
func TestFlowsLoadFromTheFlowsDirectoryAndMerge(t *testing.T) {
	dir := t.TempDir()
	mustWrite(t, filepath.Join(dir, ConfigFile), sampleConfig)
	mustWrite(t, filepath.Join(dir, filepath.Dir(ConfigFile), FlowsDir, "area.yaml"), `flows:
  - id: area-flow
    title: An area's flow
    isolated: true
    steps:
      - action: click
        with:
          testId: area-button
      - action: expect
        with:
          api: /api/things
          status: "401"
          auth: none
`)
	mustWrite(t, filepath.Join(dir, filepath.Dir(ConfigFile), FlowsDir, "serial.yaml"), `flows:
  - id: serial-flow
    title: Runs alone
    serial: true
    steps:
      - action: go
        with:
          path: /
`)

	config, err := LoadConfig(filepath.Join(dir, ConfigFile))

	if err != nil {
		t.Fatal(err)
	}
	ids := []string{}
	for _, flow := range config.Flows {
		ids = append(ids, flow.ID)
	}
	want := []string{"automation-create", "prompt-create", "area-flow", "serial-flow"}
	if len(ids) != len(want) {
		t.Fatalf("flows %v, want %v", ids, want)
	}
	for index, id := range want {
		if ids[index] != id {
			t.Fatalf("flows %v, want %v", ids, want)
		}
	}
	if !config.Flows[2].Isolated || !config.Flows[3].Serial || config.Flows[0].Isolated {
		t.Fatalf("isolated and serial did not parse: %+v", config.Flows)
	}
}

// @scenario A flow id defined in two files is refused
func TestAFlowIDInTwoFilesIsRefused(t *testing.T) {
	dir := t.TempDir()
	mustWrite(t, filepath.Join(dir, ConfigFile), sampleConfig)
	mustWrite(t, filepath.Join(dir, filepath.Dir(ConfigFile), FlowsDir, "again.yaml"), `flows:
  - id: prompt-create
    title: Again
    steps:
      - action: createPrompt
`)

	if _, err := LoadConfig(filepath.Join(dir, ConfigFile)); err == nil {
		t.Fatal("a flow id defined twice was accepted")
	}
}

// @scenario An expect with an unknown key is refused
func TestExpectKeysAreTheRunnersVocabulary(t *testing.T) {
	good := map[string]string{"testId": "row", "hasText": "VD", "min": "2"}
	if err := validateExpect(good); err != nil {
		t.Fatalf("testId with hasText and min: %v", err)
	}
	if err := validateExpect(map[string]string{"api": "/api/x", "status": "401", "auth": "none", "anonymous": "true"}); err != nil {
		t.Fatalf("api with status, auth and anonymous: %v", err)
	}
	if err := validateExpect(map[string]string{"testId": "row", "text": "x"}); err == nil {
		t.Fatal("two forms were accepted")
	}
	if err := validateExpect(map[string]string{"testId": "row", "colour": "red"}); err == nil {
		t.Fatal("an unknown option was accepted")
	}
}

// @scenario The shipped flows all validate
func TestTheShippedConfigLoadsWithItsCoreFlows(t *testing.T) {
	config, err := LoadConfig(filepath.Base(ConfigFile))

	if err != nil {
		t.Fatal(err)
	}
	if len(config.Flows) < 12 {
		t.Fatalf("the twelve core flows did not load: %d", len(config.Flows))
	}
}
