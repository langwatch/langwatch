package lanediff

import (
	"encoding/json"
	"fmt"
	"os"
	"sort"
	"strings"
)

// Rule classifies the base-only items whose key it matches.
type Rule struct {
	// Match is an exact key, or a prefix ending in "*".
	Match string `json:"match"`
	// Class is one of the classes in Classes.
	Class string `json:"class"`
	// Ref cites the inventory row, ruling or code that decides it.
	Ref  string `json:"ref"`
	Note string `json:"note,omitempty"`
}

// Classes a removed or moved item may take.
var Classes = map[string]string{
	"drained":   "head declares a drain from the former lane to a current one",
	"catch-up":  "replaced by a step or poll that covers what the lost jobs would have done",
	"accepted":  "jobs queued at the cut are lost; ruled or recommended as acceptable",
	"tombstone": "old rows or jobs must be acknowledged and cleared, not left to retry",
	"none":      "nothing is queued on it in practice; the reason is cited",
	"pending":   "awaits the decision named in Ref; not classified until it is ruled",
}

// Expansion names the lanes one unresolved declaration registers, read by
// hand from the code it cites.
type Expansion struct {
	Names []string `json:"names"`
	Ref   string   `json:"ref"`
}

// Classification is the reviewed input: where anchorless declarations
// belong, what dynamic declarations expand to, and a class per base-only item.
type Classification struct {
	// Pipelines maps an unresolved pipeline token (a file with no pipeline
	// anchor, or a registerJob receiver) to the pipeline it builds.
	Pipelines map[string]string `json:"pipelines"`
	// Names maps an unresolved lane key, after Pipelines applies, to names.
	Names map[string]Expansion `json:"names"`
	Rules []Rule               `json:"rules"`
}

// LoadClassification reads a classification file.
func LoadClassification(path string) (Classification, error) {
	var c Classification
	data, err := os.ReadFile(path)
	if err != nil {
		return c, err
	}
	if err := json.Unmarshal(data, &c); err != nil {
		return c, fmt.Errorf("%s: %w", path, err)
	}
	for _, r := range c.Rules {
		if _, ok := Classes[r.Class]; !ok {
			return c, fmt.Errorf("%s: rule %q has unknown class %q", path, r.Match, r.Class)
		}
	}
	return c, nil
}

// Apply resolves a registry's anchorless and dynamic lanes from c.
func Apply(reg Registry, c Classification) Registry {
	var lanes []Lane
	for _, l := range reg.Lanes {
		lanes = append(lanes, applyLane(l, c)...)
	}
	reg.Lanes = lanes
	for i, pm := range reg.ProcessManagers {
		if expansion, ok := c.Names["process:"+pm.Pipeline+":"+pm.Name]; ok && len(expansion.Names) == 1 {
			reg.ProcessManagers[i].Name = expansion.Names[0]
		}
	}
	return reg
}

// applyLane attributes one unresolved lane to its pipeline and expands it.
func applyLane(l Lane, c Classification) []Lane {
	if !l.Unresolved {
		return []Lane{l}
	}
	for token, pipeline := range c.Pipelines {
		if l.Pipeline == "?"+token {
			l.Pipeline = pipeline
		}
		l.Name = strings.ReplaceAll(l.Name, "?"+token+".", pipeline+".")
	}
	l.Unresolved = strings.HasPrefix(l.Pipeline, "?") || strings.Contains(l.Name, "?")
	expansion, ok := c.Names[l.Key()]
	if !l.Unresolved || !ok {
		return []Lane{l}
	}
	out := make([]Lane, 0, len(expansion.Names))
	for _, name := range expansion.Names {
		expanded := l
		expanded.Name, expanded.Unresolved = name, false
		out = append(out, expanded)
	}
	return out
}

func (r Rule) matches(key string) bool {
	if prefix, ok := strings.CutSuffix(r.Match, "*"); ok {
		return strings.HasPrefix(key, prefix)
	}
	return r.Match == key
}

// Item is one base-only lane, process manager or pipeline.
type Item struct {
	Key   string
	Where string
	// Successor names where the work went on head, when it can be seen.
	Successor string
	Class     string
	Ref       string
	Note      string
}

// Result is the classified difference between two registries.
type Result struct {
	Kept              int
	RemovedLanes      []Item
	AddedLanes        []Lane
	RemovedPipelines  []Item
	AddedPipelines    []string
	RemovedProcesses  []Item
	AddedProcesses    []ProcessManager
	RemovedEventTypes []string
	AddedEventTypes   []string
	UnresolvedBase    []Item
	UnresolvedHead    []Lane
	Drains            []Drain
	UnusedRules       []Rule
}

// classifier applies rules in order and remembers which ones matched.
type classifier struct {
	rules []Rule
	used  map[int]bool
}

func (c classifier) classify(item *Item) {
	for i, r := range c.rules {
		if r.matches(item.Key) {
			c.used[i] = true
			item.Class, item.Ref, item.Note = r.Class, r.Ref, r.Note
			return
		}
	}
	if item.Class == "" {
		item.Class = "UNCLASSIFIED"
	}
}

func (c classifier) unused() []Rule {
	var out []Rule
	for i, r := range c.rules {
		if !c.used[i] {
			out = append(out, r)
		}
	}
	return out
}

// Diff compares base (the running release) with head (the release to deploy).
func Diff(base, head Registry, rules []Rule) Result {
	d := differ{base: base, head: head, headKeys: resolvedKeys(head), c: classifier{rules: rules, used: map[int]bool{}}}
	d.lanes()
	d.pipelines()
	d.processes()
	d.res.RemovedEventTypes = missingFrom(base.EventTypes, head.EventTypes)
	d.res.AddedEventTypes = missingFrom(head.EventTypes, base.EventTypes)
	d.res.Drains = head.Drains
	d.res.UnusedRules = d.c.unused()
	sortResult(&d.res)
	return d.res
}

// differ holds one comparison while it is built.
type differ struct {
	base, head Registry
	headKeys   map[string]Lane
	c          classifier
	res        Result
}

func resolvedKeys(reg Registry) map[string]Lane {
	keys := map[string]Lane{}
	for _, l := range reg.Lanes {
		if !l.Unresolved {
			keys[l.Key()] = l
		}
	}
	return keys
}

func where(file string, line int) string { return fmt.Sprintf("%s:%d", file, line) }

func (d *differ) lanes() {
	seen := map[string]bool{}
	for _, l := range d.base.Lanes {
		if l.Unresolved {
			d.res.UnresolvedBase = append(d.res.UnresolvedBase, d.unresolvedItem(l))
			continue
		}
		if seen[l.Key()] {
			continue
		}
		seen[l.Key()] = true
		if _, ok := d.headKeys[l.Key()]; ok {
			d.res.Kept++
			continue
		}
		d.res.RemovedLanes = append(d.res.RemovedLanes, d.removedItem(l))
	}
	for _, l := range d.head.Lanes {
		switch {
		case l.Unresolved:
			d.res.UnresolvedHead = append(d.res.UnresolvedHead, l)
		case !seen[l.Key()]:
			d.res.AddedLanes = append(d.res.AddedLanes, l)
			seen[l.Key()] = true
		}
	}
}

func (d *differ) unresolvedItem(l Lane) Item {
	item := Item{Key: l.Key(), Where: where(l.File, l.Line)}
	for _, h := range d.head.Lanes {
		if h.Unresolved && h.Key() == l.Key() {
			item.Successor = "the same unresolved expression at " + where(h.File, h.Line)
		}
	}
	d.c.classify(&item)
	return item
}

func (d *differ) removedItem(l Lane) Item {
	item := Item{Key: l.Key(), Where: where(l.File, l.Line)}
	if target, ok := drainTarget(d.head, d.headKeys, l); ok {
		item.Successor = "drains into " + target
		item.Class, item.Ref = "drained", "head .withUpcasts drain"
	} else {
		item.Successor = successor(d.head, l)
	}
	d.c.classify(&item)
	return item
}

func (d *differ) pipelines() {
	for name, file := range d.base.Pipelines {
		if _, ok := d.head.Pipelines[name]; ok {
			continue
		}
		item := Item{Key: "pipeline:" + name, Where: file, Successor: drainedInto(d.head, name)}
		d.c.classify(&item)
		d.res.RemovedPipelines = append(d.res.RemovedPipelines, item)
	}
	for name := range d.head.Pipelines {
		if _, ok := d.base.Pipelines[name]; !ok {
			d.res.AddedPipelines = append(d.res.AddedPipelines, name)
		}
	}
}

// drainedInto names the pipeline a head drain routes a former pipeline into.
func drainedInto(head Registry, former string) string {
	for _, dr := range head.Drains {
		if dr.Former == former {
			return "drains into pipeline " + dr.Current
		}
	}
	return ""
}

func (d *differ) processes() {
	headPM := map[string]bool{}
	headPMByName := map[string]ProcessManager{}
	for _, pm := range d.head.ProcessManagers {
		headPM[pm.Pipeline+":"+pm.Name] = true
		headPMByName[pm.Name] = pm
	}
	basePM := map[string]bool{}
	for _, pm := range d.base.ProcessManagers {
		key := pm.Pipeline + ":" + pm.Name
		basePM[key] = true
		if headPM[key] {
			continue
		}
		item := Item{Key: "process:" + key, Where: where(pm.File, pm.Line)}
		if moved, ok := headPMByName[pm.Name]; ok {
			item.Successor = "same process name on pipeline " + moved.Pipeline
		}
		d.c.classify(&item)
		d.res.RemovedProcesses = append(d.res.RemovedProcesses, item)
	}
	for _, pm := range d.head.ProcessManagers {
		if !basePM[pm.Pipeline+":"+pm.Name] {
			d.res.AddedProcesses = append(d.res.AddedProcesses, pm)
		}
	}
}

// missingFrom lists the keys of a that b lacks.
func missingFrom(a, b map[string]bool) []string {
	var out []string
	for k := range a {
		if !b[k] {
			out = append(out, k)
		}
	}
	return out
}

// drainTarget finds the head lane a drain routes a base lane's jobs to.
func drainTarget(head Registry, headKeys map[string]Lane, l Lane) (string, bool) {
	for _, d := range head.Drains {
		if d.Former != l.Pipeline {
			continue
		}
		name := l.Name
		if renamed, ok := d.JobNames[name]; ok {
			name = renamed
		}
		key := d.Current + ":" + l.JobType + ":" + name
		if _, ok := headKeys[key]; ok {
			return key, true
		}
	}
	return "", false
}

// successor names head lanes that carry the same name elsewhere.
func successor(head Registry, l Lane) string {
	var found []string
	for _, h := range head.Lanes {
		if h.Unresolved {
			continue
		}
		same := h.Name == l.Name || strings.HasSuffix(h.Name, "."+l.Name)
		if same && h.Key() != l.Key() {
			found = append(found, h.Key())
		}
	}
	sort.Strings(found)
	return strings.Join(dedupe(found), ", ")
}

func dedupe(s []string) []string {
	out := s[:0]
	for i, v := range s {
		if i == 0 || v != s[i-1] {
			out = append(out, v)
		}
	}
	return out
}

func sortResult(res *Result) {
	byKey := func(items []Item) {
		sort.Slice(items, func(i, j int) bool { return items[i].Key < items[j].Key })
	}
	byKey(res.RemovedLanes)
	byKey(res.RemovedPipelines)
	byKey(res.RemovedProcesses)
	byKey(res.UnresolvedBase)
	sort.Slice(res.AddedLanes, func(i, j int) bool { return res.AddedLanes[i].Key() < res.AddedLanes[j].Key() })
	sort.Slice(res.AddedProcesses, func(i, j int) bool {
		return res.AddedProcesses[i].Pipeline+res.AddedProcesses[i].Name < res.AddedProcesses[j].Pipeline+res.AddedProcesses[j].Name
	})
	sort.Strings(res.AddedPipelines)
	sort.Strings(res.RemovedEventTypes)
	sort.Strings(res.AddedEventTypes)
}
