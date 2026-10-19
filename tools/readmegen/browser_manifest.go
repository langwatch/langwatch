package readmegen

// Screen is one `withScreens({ key: { path, within, label, requires, flags } })` entry.
type Screen struct {
	Key      string   `json:"key"`
	Path     *Scalar  `json:"path"`
	Within   *Scalar  `json:"within"`
	Label    *Scalar  `json:"label"`
	Requires *Scalar  `json:"requires"`
	Flags    []Scalar `json:"flags"`
	At       Location `json:"at"`
}

// Drawer is a `withDrawers` key or a `.drawer(Token, …)` registration.
type Drawer struct {
	Name  Scalar   `json:"name"`
	Opens string   `json:"opens"`
	Token string   `json:"token"`
	At    Location `json:"at"`
}

// Lend is one `.lends(Token, …)`.
type Lend struct {
	Token string   `json:"token"`
	At    Location `json:"at"`
}

// BrowserFacts is a browser half's `defineBrowserModule(...)` chain as read.
type BrowserFacts struct {
	Name         Scalar   `json:"name"`
	ExportName   string   `json:"exportName"`
	Doc          string   `json:"doc"`
	At           Location `json:"at"`
	Screens      []Screen `json:"screens"`
	Drawers      []Drawer `json:"drawers"`
	Lends        []Lend   `json:"lends"`
	Hosts        []Scalar `json:"hosts"`
	Capabilities []string `json:"capabilities"`
	API          string   `json:"api"`
	Contracts    []Scalar `json:"contracts"`
	Config       []string `json:"config"`
}

// UIRoute is a page key of `uiRouteTable` and the URL it is routed at.
type UIRoute struct {
	Page string `json:"page"`
	Path string `json:"path"`
}

// browserUnresolved counts the browser-half values the extractor could not fold.
func browserUnresolved(facts *BrowserFacts, counts map[string]int) {
	if facts == nil {
		return
	}
	values := []Scalar{facts.Name}
	values = append(append(values, facts.Hosts...), facts.Contracts...)
	for index := range facts.Screens {
		screen := &facts.Screens[index]
		for _, value := range []*Scalar{screen.Path, screen.Within, screen.Label, screen.Requires} {
			if value != nil {
				values = append(values, *value)
			}
		}
		values = append(values, screen.Flags...)
	}
	for index := range facts.Drawers {
		values = append(values, facts.Drawers[index].Name)
	}
	for _, value := range values {
		counts["browser"] += unresolved(value.Resolved)
	}
}
