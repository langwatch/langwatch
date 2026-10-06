package readmegen

// Manifest is what the embedded extractor prints: the facts a syntactic read
// of the TypeScript tree yields, one entry per module in the catalogue, plus the
// architecture enforcer's classification of every workspace package.
type Manifest struct {
	Modules  []ModuleFacts `json:"modules"`
	Packages []PackageKind `json:"packages"`
	Mounted  Mounted       `json:"mounted"`
}

// Location is a file, relative to the workspace root, and a 1-based line.
type Location struct {
	File string `json:"file"`
	Line int    `json:"line"`
}

// ModuleFacts is one module as the extractor reads it. Later steps add
// routes, procedures, sockets, pipelines and the browser declaration.
type ModuleFacts struct {
	ID               string        `json:"id"`
	Tokens           []Token       `json:"tokens"`
	API              *APIInterface `json:"api"`
	Peers            []Peer        `json:"peers"`
	Secrets          []Leaf        `json:"secrets"`
	Config           []Leaf        `json:"config"`
	Stores           []Stores      `json:"stores"`
	PrismaClaims     []Claim       `json:"prismaClaims"`
	PrismaDelegates  []Delegate    `json:"prismaDelegates"`
	ClickhouseWrites []TableWrite  `json:"clickhouseWrites"`
	Process          ProcessFacts  `json:"process"`
}

// Token is one `moduleApi<Type>()("module")` call and the constant it names.
type Token struct {
	Name   string   `json:"name"`
	Type   string   `json:"type"`
	Module string   `json:"module"`
	At     Location `json:"at"`
}

// APIInterface is the interface a module's own token is typed by.
type APIInterface struct {
	Name       string      `json:"name"`
	Doc        string      `json:"doc"`
	Extends    []string    `json:"extends"`
	Operations []Operation `json:"operations"`
	At         Location    `json:"at"`
}

// Operation is one interface member with its printed signature.
type Operation struct {
	Name    string   `json:"name"`
	Params  string   `json:"params"`
	Returns string   `json:"returns"`
	Doc     string   `json:"doc"`
	At      Location `json:"at"`
}

// Peer is one entry of a process class's `static dependencies`.
type Peer struct {
	Name     string   `json:"name"`
	Token    string   `json:"token"`
	Module   string   `json:"module"`
	Resolved bool     `json:"resolved"`
	At       Location `json:"at"`
}

// Leaf is a secret or config leaf; Value is the environment variable it reads
// when Resolved, else Text is the source the folder could not resolve.
type Leaf struct {
	Name     string   `json:"name"`
	Value    string   `json:"value"`
	Text     string   `json:"text"`
	Resolved bool     `json:"resolved"`
	At       Location `json:"at"`
}

// Stores is a live repository registry's `static requires`.
type Stores struct {
	Requires []string `json:"requires"`
	Resolved bool     `json:"resolved"`
	At       Location `json:"at"`
}

// Claim is a Prisma model a module claims through `prismaTables` or `PrismaRepository.for`.
type Claim struct {
	Model string   `json:"model"`
	At    Location `json:"at"`
}

// Delegate is a Prisma client delegate a module reaches by `Pick<PrismaClient, …>`.
type Delegate struct {
	Delegate string   `json:"delegate"`
	At       Location `json:"at"`
}

// TableWrite is a ClickHouse table a module writes.
type TableWrite struct {
	Table string   `json:"table"`
	At    Location `json:"at"`
}

// PackageKind is the enforcer's classification of one workspace package.
type PackageKind struct {
	Name    string `json:"name"`
	Root    string `json:"root"`
	Kind    string `json:"kind"`
	Feature string `json:"feature"`
}

// unresolvedCounts counts every value the extractor could not fold, by kind.
func unresolvedCounts(manifest Manifest) map[string]int {
	counts := map[string]int{}
	for index := range manifest.Modules {
		module := &manifest.Modules[index]
		for _, peer := range module.Peers {
			counts["peer"] += unresolved(peer.Resolved)
		}
		counts["secret"] += unresolvedLeaves(module.Secrets)
		counts["config"] += unresolvedLeaves(module.Config)
		for _, stores := range module.Stores {
			counts["stores"] += unresolved(stores.Resolved)
		}
		processUnresolved(&module.Process, counts)
	}
	for kind, count := range counts {
		if count == 0 {
			delete(counts, kind)
		}
	}
	return counts
}

func unresolved(resolved bool) int {
	if resolved {
		return 0
	}
	return 1
}

func unresolvedLeaves(leaves []Leaf) int {
	count := 0
	for _, leaf := range leaves {
		count += unresolved(leaf.Resolved)
	}
	return count
}
