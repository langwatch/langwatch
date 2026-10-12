package apidiff

import (
	"encoding/json"
	"fmt"
	"net/http"
	"net/url"
	"reflect"
	"strings"
	"sync"
	"time"
)

// roundTrip walks one resource through create, read back, list, update,
// delete and a read that must miss, on each side on its own. It reuses the
// curated create's body (body adds or overrides keys) under a name of its own,
// so the walk never touches what the main pass created. update is the method
// that renames it.
type roundTrip struct {
	create string
	update string
	body   map[string]any
}

// roundTrips are the resources the curated creates make that also serve a
// read by id, a list, an update and a delete on both sides.
var roundTrips = []roundTrip{
	{create: "POST /api/evaluators", update: http.MethodPut},
	{create: "POST /api/monitors", update: http.MethodPatch},
	{create: "POST /api/agents", update: http.MethodPatch},
	{create: "POST /api/scenarios", update: http.MethodPatch, body: map[string]any{
		"situation": "apidiff round trip", "criteria": []any{"it answers"},
	}},
	{create: "POST /api/suites", update: http.MethodPatch},
	{create: "POST /api/roles", update: http.MethodPatch},
	{create: "POST /api/groups", update: http.MethodPatch},
}

// Round-trip steps, in the order each side walks them.
const (
	stepCreate = "create"
	stepRead   = "read"
	stepList   = "list"
	stepUpdate = "update"
	stepDelete = "delete"
	stepGone   = "gone"
)

var roundTripSteps = []string{stepCreate, stepRead, stepList, stepUpdate, stepDelete, stepGone}

// Effect values: the step did its job, did not, or never ran because an
// earlier step left nothing to act on.
const (
	effectOK     = "ok"
	effectBroken = "broken"
	effectNotRun = "not-run"
)

// FindingEffectBroken is a round-trip step that did its job on the base and
// not on the candidate.
const FindingEffectBroken = "effect_broken"

// EffectSide is one side's outcome for one round-trip step.
type EffectSide struct {
	Effect string `json:"effect"`
	Detail string `json:"detail,omitempty"`
}

// Effect is one round-trip step on both sides: A the candidate, B the base.
type Effect struct {
	Resource string     `json:"resource"`
	Step     string     `json:"step"`
	Method   string     `json:"method"`
	Path     string     `json:"path"`
	A        EffectSide `json:"a"`
	B        EffectSide `json:"b"`
}

func (trip roundTrip) collection() string {
	_, path, _ := strings.Cut(trip.create, " ")
	return path
}

func (trip roundTrip) name() string {
	return "apidiff round trip " + strings.TrimPrefix(trip.collection(), "/api/")
}

// bodyFor merges the curated body, the trip's own keys and its name.
func (trip roundTrip) bodyFor(curated any) map[string]any {
	merged := map[string]any{}
	if base, ok := curated.(map[string]any); ok {
		for key, value := range base {
			merged[key] = value
		}
	}
	for key, value := range trip.body {
		merged[key] = value
	}
	merged["name"] = trip.name()
	return merged
}

// stepRoute is the method and path template one step sends.
func (trip roundTrip) stepRoute(step string) (string, string) {
	item := trip.collection() + "/{id}"
	switch step {
	case stepCreate:
		return http.MethodPost, trip.collection()
	case stepList:
		return http.MethodGet, trip.collection()
	case stepUpdate:
		return trip.update, item
	case stepDelete:
		return http.MethodDelete, item
	default:
		return http.MethodGet, item
	}
}

// roundTripPass walks every round trip whose create the run probes on both
// sides, records the effects and answers a finding per step that broke on
// the candidate alone.
func (engine *probeEngine) roundTripPass(selected []Operation) []Finding {
	findings := make([]Finding, 0)
	for _, trip := range roundTrips {
		create, ok := findOperation(selected, trip.create)
		if !ok || !create.InA || !create.InB || notProbed(create, engine.options.ExcludePrefixes) != "" {
			continue
		}
		effects := engine.walkRoundTrip(trip, create)
		engine.effects = append(engine.effects, effects...)
		findings = append(findings, effectFindings(effects, selected)...)
	}
	return findings
}

func findOperation(operations []Operation, key string) (Operation, bool) {
	for index := range operations {
		if operationKeyOf(operations[index]) == key {
			return operations[index], true
		}
	}
	return Operation{}, false
}

// walkRoundTrip runs both sides' walks at once; the sides share no state and
// each only ever touches the entity it created itself.
func (engine *probeEngine) walkRoundTrip(trip roundTrip, create Operation) []Effect {
	curated, _ := curatedFor(create)
	bodyA, bodyB, missing := curatedBodies(curatedCreate{key: trip.create, body: trip.bodyFor(curated.body)}, engine.symbolsA, engine.symbolsB)
	var sidesA, sidesB []EffectSide
	if missing != "" {
		sidesA, sidesB = notRunSides(missing), notRunSides(missing)
	} else {
		headers := userBoundHeaders(create, authHeaders(create, engine.options.Schemes, engine.options.Keys), engine.options.Keys)
		headersA, headersB := engine.sideHeaders(create, headers)
		pathA, pathB := create.SidePaths()
		walkA := sideWalk{engine: engine, trip: trip, baseURL: engine.options.A, collection: pathA, headers: headersA, body: bodyA}
		walkB := sideWalk{engine: engine, trip: trip, baseURL: engine.options.B, collection: pathB, headers: headersB, body: bodyB}
		var group sync.WaitGroup
		group.Go(func() { sidesA = walkA.run() })
		sidesB = walkB.run()
		group.Wait()
	}
	effects := make([]Effect, 0, len(roundTripSteps))
	for index, step := range roundTripSteps {
		method, path := trip.stepRoute(step)
		effects = append(effects, Effect{
			Resource: trip.collection(), Step: step, Method: method, Path: path,
			A: sidesA[index], B: sidesB[index],
		})
	}
	engine.progress("round trip %s: candidate %s, base %s\n", trip.collection(), walkSummary(sidesA), walkSummary(sidesB))
	return effects
}

func notRunSides(detail string) []EffectSide {
	sides := make([]EffectSide, len(roundTripSteps))
	for index := range sides {
		sides[index] = EffectSide{Effect: effectNotRun, Detail: detail}
	}
	return sides
}

// walkSummary is "ok" or the first step that did not do its job.
func walkSummary(sides []EffectSide) string {
	for index, side := range sides {
		if side.Effect != effectOK {
			return roundTripSteps[index] + " " + side.Effect
		}
	}
	return effectOK
}

// effectFindings files a finding for each step broken on the candidate and ok
// on the base, attributed to the operation that step sent.
func effectFindings(effects []Effect, operations []Operation) []Finding {
	findings := make([]Finding, 0)
	for index := range effects {
		effect := &effects[index]
		if effect.A.Effect != effectBroken || effect.B.Effect != effectOK {
			continue
		}
		path, operationID := effect.Path, ""
		if operation, ok := operationOfShape(operations, effect.Method, effect.Path); ok {
			path, operationID = operation.Path, operation.OperationID
		}
		findings = append(findings, Finding{
			Kind: FindingEffectBroken, Method: effect.Method, Path: path, OperationID: operationID,
			Case:   "round-trip " + effect.Step,
			Fields: map[string][2]any{"effect": {effect.B.Effect, effect.A.Effect}},
			Reason: effect.A.Detail,
		})
	}
	return findings
}

func operationOfShape(operations []Operation, method, path string) (Operation, bool) {
	for index := range operations {
		if operations[index].Method == method && routeShape(operations[index].Path) == routeShape(path) {
			return operations[index], true
		}
	}
	return Operation{}, false
}

// sideWalk is one side's walk of one round trip.
type sideWalk struct {
	engine     *probeEngine
	trip       roundTrip
	baseURL    string
	collection string
	headers    map[string]string
	body       any
}

func (walk sideWalk) run() []EffectSide {
	sides := notRunSides("")
	created := walk.send(http.MethodPost, walk.collection, walk.body)
	id, detail := createdID(created)
	if detail != "" {
		sides[0] = EffectSide{Effect: effectBroken, Detail: detail}
		return sides
	}
	sides[0] = EffectSide{Effect: effectOK}
	item := walk.collection + "/" + url.PathEscape(id)
	sides[1] = walk.await(item, func(read SideResult) string { return readBackDiff(walk.body, read) })
	sides[2] = walk.await(walk.collection, func(list SideResult) string { return listedDiff(list, id) })
	sides[3] = walk.updateEffect(item)
	deleted := walk.send(http.MethodDelete, item, nil)
	sides[4] = statusEffect(deleted)
	if sides[4].Effect == effectOK {
		sides[5] = walk.await(item, goneDiff)
	}
	return sides
}

func (walk sideWalk) updateEffect(item string) EffectSide {
	renamed := map[string]any{"name": walk.trip.name() + " updated"}
	if effect := statusEffect(walk.send(walk.trip.update, item, renamed)); effect.Effect != effectOK {
		return effect
	}
	return walk.await(item, func(read SideResult) string { return readBackDiff(renamed, read) })
}

func (walk sideWalk) send(method, path string, body any) SideResult {
	return walk.engine.execute(probeRequest{method: method, baseURL: walk.baseURL, path: path, headers: walk.headers, body: body})
}

// await re-reads path until check passes or the settle deadline ends it: a
// projection that has not run yet is a wait, the deadline makes it broken.
func (walk sideWalk) await(path string, check func(SideResult) string) EffectSide {
	deadline := time.Now().Add(walk.engine.settleTimeout())
	for {
		detail := check(walk.send(http.MethodGet, path, nil))
		if detail == "" {
			return EffectSide{Effect: effectOK}
		}
		if time.Now().After(deadline) {
			return EffectSide{Effect: effectBroken, Detail: detail}
		}
		select {
		case <-walk.engine.ctx.Done():
			return EffectSide{Effect: effectBroken, Detail: detail}
		case <-time.After(settlePollInterval):
		}
	}
}

func statusEffect(result SideResult) EffectSide {
	if detail := statusDetail(result); detail != "" {
		return EffectSide{Effect: effectBroken, Detail: detail}
	}
	return EffectSide{Effect: effectOK}
}

// statusDetail is empty for a 2xx, else the status and a body excerpt.
func statusDetail(result SideResult) string {
	if result.Error != "" {
		return result.Error
	}
	if result.Status < 200 || result.Status >= 300 {
		return fmt.Sprintf("status %d: %s", result.Status, excerpt(result.Body))
	}
	return ""
}

func createdID(result SideResult) (string, string) {
	if detail := statusDetail(result); detail != "" {
		return "", detail
	}
	decoded, _ := decodeJSONBody(result.Body)
	entity, ok := entityIn(decoded)
	if !ok {
		return "", "create answered no id: " + excerpt(result.Body)
	}
	id, _ := entity["id"].(string)
	return id, ""
}

// entityIn finds the shallowest object carrying a string "id": the entity
// itself, or the one a response wraps ({"data": {...}}, {"group": {...}}).
func entityIn(value any) (map[string]any, bool) {
	level := []any{value}
	for len(level) > 0 {
		next := make([]any, 0)
		for _, node := range level {
			object, ok := node.(map[string]any)
			if id, hasID := object["id"].(string); ok && hasID && id != "" {
				return object, true
			}
			next = append(next, childrenOf(object)...)
		}
		level = next
	}
	return nil, false
}

// childrenOf lists an object's values in key order (none for a nil map).
func childrenOf(object map[string]any) []any {
	children := make([]any, 0, len(object))
	for _, key := range sortedKeys(object) {
		children = append(children, object[key])
	}
	return children
}

// readBackDiff is empty when the read answers everything sent, or names the
// first field that differs. Volatile keys (ids, times, urls) are masked.
func readBackDiff(sent any, read SideResult) string {
	if detail := statusDetail(read); detail != "" {
		return detail
	}
	decoded, _ := decodeJSONBody(read.Body)
	entity, ok := entityIn(decoded)
	if !ok {
		return "read answered no entity: " + excerpt(read.Body)
	}
	return subsetDiff("", jsonTyped(sent), entity)
}

// jsonTyped gives a Go value the types a decoded body has (float64
// numbers), so a sent 3 equals a read 3.
func jsonTyped(value any) any {
	encoded, err := json.Marshal(value)
	if err != nil {
		return value
	}
	decoded, _ := decodeJSONBody(string(encoded))
	return decoded
}

// subsetDiff checks that got holds everything in sent: every sent key, and
// every sent array element somewhere in got's array.
func subsetDiff(pointer string, sent, got any) string {
	switch typed := sent.(type) {
	case map[string]any:
		return objectSubsetDiff(pointer, typed, got)
	case []any:
		return arraySubsetDiff(pointer, typed, got)
	default:
		if reflect.DeepEqual(sent, got) || sameNumber(sent, got) || IsMintedIdentifier(sent) {
			return ""
		}
		return fmt.Sprintf("%s: sent %s, read %s", pointerOrRoot(pointer), excerptValue(sent), excerptValue(got))
	}
}

func objectSubsetDiff(pointer string, sent map[string]any, got any) string {
	object, ok := got.(map[string]any)
	if !ok {
		return fmt.Sprintf("%s: sent an object, read %s", pointerOrRoot(pointer), excerptValue(got))
	}
	for _, key := range sortedKeys(sent) {
		if IsVolatileKey(key) {
			continue
		}
		child, present := object[key]
		if !present {
			return pointer + "/" + escapeSegment(key) + ": sent, not read back"
		}
		if detail := subsetDiff(pointer+"/"+escapeSegment(key), sent[key], child); detail != "" {
			return detail
		}
	}
	return ""
}

// sameNumber compares two decoded numbers by value, so 3 equals 3.0.
func sameNumber(sent, got any) bool {
	left, leftOK := sent.(json.Number)
	right, rightOK := got.(json.Number)
	if !leftOK || !rightOK {
		return false
	}
	leftValue, leftErr := left.Float64()
	rightValue, rightErr := right.Float64()
	return leftErr == nil && rightErr == nil && leftValue == rightValue
}

func arraySubsetDiff(pointer string, sent []any, got any) string {
	elements, ok := got.([]any)
	if !ok {
		return fmt.Sprintf("%s: sent an array, read %s", pointerOrRoot(pointer), excerptValue(got))
	}
	for index, want := range sent {
		found := false
		for _, candidate := range elements {
			if subsetDiff("", want, candidate) == "" {
				found = true
				break
			}
		}
		if !found {
			return fmt.Sprintf("%s/%d: sent %s, not read back", pointer, index, excerptValue(want))
		}
	}
	return ""
}

func pointerOrRoot(pointer string) string {
	if pointer == "" {
		return "/"
	}
	return pointer
}

func listedDiff(list SideResult, id string) string {
	if detail := statusDetail(list); detail != "" {
		return detail
	}
	if !containsID(list.Body, id) {
		return "created id not in the list"
	}
	return ""
}

// goneDiff passes when a read after the delete misses (404 or 410).
func goneDiff(read SideResult) string {
	if read.Status == http.StatusNotFound || read.Status == http.StatusGone {
		return ""
	}
	if read.Error != "" {
		return read.Error
	}
	return fmt.Sprintf("read after delete answered %d", read.Status)
}

// effectResources lists the round-trip resources in run order.
func effectResources(effects []Effect) []string {
	seen := map[string]bool{}
	resources := make([]string, 0)
	for index := range effects {
		if resource := effects[index].Resource; !seen[resource] {
			seen[resource] = true
			resources = append(resources, resource)
		}
	}
	return resources
}
