package importext

// Change is one rewritten specifier.
type Change struct {
	Line int    `json:"line"`
	From string `json:"from"`
	To   string `json:"to"`
}

// FileRewrite is every change importext made, or would make, in one file.
type FileRewrite struct {
	File    string   `json:"file"`
	Changes []Change `json:"changes"`
}

// Finding is one specifier importext reports rather than rewrites.
type Finding struct {
	File      string `json:"file"`
	Line      int    `json:"line"`
	Specifier string `json:"specifier"`
}

// Report is the whole result of a run, as written by -report.
type Report struct {
	Roots               []string      `json:"roots"`
	DryRun              bool          `json:"dryRun"`
	OnlyClean           bool          `json:"onlyClean"`
	FilesScanned        int           `json:"filesScanned"`
	FilesRewritten      int           `json:"filesRewritten"`
	SpecifiersRewritten int           `json:"specifiersRewritten"`
	Rewritten           []FileRewrite `json:"rewritten"`
	SkippedDirty        []string      `json:"skippedDirty"`
	Unresolved          []Finding     `json:"unresolved"`
	JSONImports         []Finding     `json:"jsonImports"`
	AliasImports        []Finding     `json:"aliasImports"`
}

func newReport() *Report {
	return &Report{
		Rewritten:    []FileRewrite{},
		SkippedDirty: []string{},
		Unresolved:   []Finding{},
		JSONImports:  []Finding{},
		AliasImports: []Finding{},
	}
}
