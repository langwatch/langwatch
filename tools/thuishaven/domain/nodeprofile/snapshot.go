package nodeprofile

import (
	"errors"
	"regexp"
	"slices"
	"sort"
	"strings"
	"unicode/utf8"
)

// StringRow is a group of heap strings sharing their first characters: how
// much they hold, how many there are, and whether V8 stores them two-byte
// (a character above U+00FF makes the whole string two bytes per character).
type StringRow struct {
	Preview string  `json:"preview"`
	MB      float64 `json:"mb"`
	Count   int     `json:"count"`
	TwoByte bool    `json:"twoByte"`
}

// StringStats sums the heap's strings, and the two-byte ones apart.
type StringStats struct {
	Count        int         `json:"count"`
	MB           float64     `json:"mb"`
	TwoByteCount int         `json:"twoByteCount"`
	TwoByteMB    float64     `json:"twoByteMb"`
	Biggest      []StringRow `json:"biggest"`
}

// Retained is one object holding a lot alive, and the chain of dominators
// above it, nearest first.
type Retained struct {
	Name string  `json:"name"`
	Type string  `json:"type"`
	MB   float64 `json:"mb"`
	Path string  `json:"path"`
}

// DuplicatePackage is an npm package whose modules load from more than one
// pnpm directory: two versions (or two peer sets) of it in one process.
type DuplicatePackage struct {
	Name    string   `json:"name"`
	Modules int      `json:"modules"`
	Dirs    []string `json:"dirs"`
}

// SnapshotAnalysis is a heap snapshot rolled up. Self size is what an object
// is; retained size is what would be freed with it.
type SnapshotAnalysis struct {
	Nodes                 int                `json:"nodes"`
	TotalMB               float64            `json:"totalMb"`
	ByType                []SizeRow          `json:"byType"`
	ByConstructor         []SizeRow          `json:"byConstructor"`
	RetainedByConstructor []SizeRow          `json:"retainedByConstructor"`
	TopRetained           []Retained         `json:"topRetained"`
	Strings               StringStats        `json:"strings"`
	DuplicatePackages     []DuplicatePackage `json:"duplicatePackages"`
}

// snapshotView indexes a snapshot's flat tables.
type snapshotView struct {
	s                        *HeapSnapshot
	nf, ef                   int
	iType, iName, iSize, iEC int
	eType, eName, eTo        int
	n                        int
	firstEdge                []uint32
	weakEdge                 uint32
	total                    float64
}

func newView(s *HeapSnapshot) (*snapshotView, error) {
	v := &snapshotView{s: s, nf: len(s.NodeFields), ef: len(s.EdgeFields)}
	v.iType, v.iName = slices.Index(s.NodeFields, "type"), slices.Index(s.NodeFields, "name")
	v.iSize, v.iEC = slices.Index(s.NodeFields, "self_size"), slices.Index(s.NodeFields, "edge_count")
	v.eType, v.eName, v.eTo = slices.Index(s.EdgeFields, "type"), slices.Index(s.EdgeFields, "name_or_index"), slices.Index(s.EdgeFields, "to_node")
	if min(v.iType, v.iName, v.iSize, v.iEC, v.eType, v.eName, v.eTo) < 0 {
		return nil, errors.New("heap snapshot meta lacks a field this reader needs")
	}
	v.n = len(s.Nodes) / v.nf
	v.weakEdge = ^uint32(0)
	if w := slices.Index(s.EdgeTypes, "weak"); w >= 0 {
		v.weakEdge = uint32(w)
	}
	v.firstEdge = make([]uint32, v.n+1)
	e := uint32(0)
	for i := 0; i < v.n; i++ {
		v.firstEdge[i] = e
		e += s.Nodes[i*v.nf+v.iEC] * uint32(v.ef)
	}
	v.firstEdge[v.n] = e
	if int(e) > len(s.Edges) {
		return nil, errors.New("heap snapshot edge table is shorter than its nodes say")
	}
	return v, nil
}

func (v *snapshotView) typeOf(i int) string {
	t := int(v.s.Nodes[i*v.nf+v.iType])
	if t < len(v.s.NodeTypes) {
		return v.s.NodeTypes[t]
	}
	return "?"
}

func (v *snapshotView) nameOf(i int) string {
	n := int(v.s.Nodes[i*v.nf+v.iName])
	if n < len(v.s.Strings) {
		return v.s.Strings[n]
	}
	return "?"
}

func (v *snapshotView) sizeOf(i int) float64 { return float64(v.s.Nodes[i*v.nf+v.iSize]) }

func (v *snapshotView) edgeType(e uint32) string {
	t := int(v.s.Edges[int(e)+v.eType])
	if t < len(v.s.EdgeTypes) {
		return v.s.EdgeTypes[t]
	}
	return "?"
}

func (v *snapshotView) isWeak(e uint32) bool { return v.s.Edges[int(e)+v.eType] == v.weakEdge }

func (v *snapshotView) edgeTarget(e uint32) int { return int(v.s.Edges[int(e)+v.eTo]) / v.nf }

// AnalyseSnapshot rolls a heap snapshot up; limit bounds each table.
func AnalyseSnapshot(s *HeapSnapshot, limit int) (SnapshotAnalysis, error) {
	v, err := newView(s)
	if err != nil {
		return SnapshotAnalysis{}, err
	}
	out := SnapshotAnalysis{Nodes: v.n}
	byType, byCtor := map[string]*SizeRow{}, map[string]*SizeRow{}
	for i := 0; i < v.n; i++ {
		t, size := v.typeOf(i), v.sizeOf(i)
		v.total += size
		addSize(byType, SizeRow{Name: t, Count: 1}, size)
		if isObjectLike(t) {
			addSize(byCtor, SizeRow{Name: clip(v.nameOf(i), 80), Count: 1}, size)
		}
	}
	out.TotalMB = v.total / mib
	out.ByType = head(rankedSizes(byType, v.total), limit)
	out.ByConstructor = head(rankedSizes(byCtor, v.total), limit)
	out.Strings = stringStats(v, limit)
	tree := dominators(v)
	out.RetainedByConstructor, out.TopRetained = v.retainers(tree, limit)
	out.DuplicatePackages = head(duplicatePackages(s.Strings), limit)
	return out, nil
}

func isObjectLike(t string) bool {
	return t == "object" || t == "closure" || t == "native"
}

func isStringType(t string) bool {
	return t == "string" || t == "concatenated string" || t == "sliced string"
}

func stringStats(v *snapshotView, limit int) StringStats {
	var st StringStats
	groups := map[string]*StringRow{}
	for i := 0; i < v.n; i++ {
		if isStringType(v.typeOf(i)) {
			st.add(groups, v.nameOf(i), v.sizeOf(i))
		}
	}
	rows := make([]StringRow, 0, len(groups))
	for _, g := range groups {
		rows = append(rows, *g)
	}
	sort.Slice(rows, func(i, j int) bool {
		if rows[i].MB != rows[j].MB {
			return rows[i].MB > rows[j].MB
		}
		return rows[i].Preview < rows[j].Preview
	})
	st.Biggest = head(rows, limit)
	return st
}

// add books one string into the totals and the group its preview names.
func (st *StringStats) add(groups map[string]*StringRow, name string, size float64) {
	two := isTwoByte(name)
	st.Count++
	st.MB += size / mib
	if two {
		st.TwoByteCount++
		st.TwoByteMB += size / mib
	}
	preview := previewOf(name, 60)
	g, ok := groups[preview]
	if !ok {
		g = &StringRow{Preview: preview}
		groups[preview] = g
	}
	g.MB += size / mib
	g.Count++
	g.TwoByte = g.TwoByte || two
}

// isTwoByte reports a character V8 cannot store in one byte (above U+00FF),
// which makes it store the whole string at two bytes a character.
func isTwoByte(s string) bool {
	for _, r := range s {
		if r > 0xFF {
			return true
		}
	}
	return false
}

// previewOf is the first n characters of s with whitespace runs collapsed.
func previewOf(s string, n int) string {
	var b strings.Builder
	space := false
	count := 0
	for _, r := range s {
		if count >= n {
			break
		}
		isWS := r == ' ' || r == '\n' || r == '\t' || r == '\r'
		if isWS && space {
			continue
		}
		if isWS {
			r = ' '
		}
		space = isWS
		b.WriteRune(r)
		count++
	}
	return b.String()
}

func clip(s string, n int) string {
	if utf8.RuneCountInString(s) <= n {
		return s
	}
	return string([]rune(s)[:n])
}

var pnpmModule = regexp.MustCompile(`/node_modules/\.pnpm/([^/]+)/node_modules/((?:@[^/]+/)?[^/]+)/`)

// duplicatePackages finds packages whose module files load from more than one
// pnpm directory, from the script URLs in the snapshot's string table.
func duplicatePackages(stringsTable []string) []DuplicatePackage {
	out := []DuplicatePackage{}
	for name, dirs := range pnpmDirsByPackage(stringsTable) {
		if len(dirs) < 2 {
			continue
		}
		dp := DuplicatePackage{Name: name}
		for dir, n := range dirs {
			dp.Modules += n
			dp.Dirs = append(dp.Dirs, dir)
		}
		sort.Strings(dp.Dirs)
		out = append(out, dp)
	}
	sort.Slice(out, func(i, j int) bool {
		if out[i].Modules != out[j].Modules {
			return out[i].Modules > out[j].Modules
		}
		return out[i].Name < out[j].Name
	})
	return out
}

// pnpmDirsByPackage counts each package's distinct module URLs per pnpm directory.
func pnpmDirsByPackage(stringsTable []string) map[string]map[string]int {
	dirs := map[string]map[string]int{}
	seen := map[string]bool{}
	for _, s := range stringsTable {
		if !strings.HasPrefix(s, "file:///") || seen[s] {
			continue
		}
		seen[s] = true
		m := pnpmModule.FindStringSubmatch(s)
		if m == nil {
			continue
		}
		if dirs[m[2]] == nil {
			dirs[m[2]] = map[string]int{}
		}
		dirs[m[2]][m[1]]++
	}
	return dirs
}
