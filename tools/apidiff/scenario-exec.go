package apidiff

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/url"
	"slices"
	"strings"
	"time"
)

func encodeBody(body any) []byte {
	if body == nil {
		return nil
	}
	encoded, _ := json.Marshal(body)
	return encoded
}

const (
	scenarioPollStart = 100 * time.Millisecond
	scenarioPollCap   = 2 * time.Second
	scenarioMailWait  = 10 * time.Second
)

// stepError is a step that did not hold. harness marks the ones that say
// nothing about the API (a transport error, the rate limiter, a placeholder
// that names nothing): they end the scenario as ERROR, not as a failure.
type stepError struct {
	harness bool
	step    string
	detail  string
}

func (failure *stepError) Error() string { return failure.step + ": " + failure.detail }

func harnessFailure(step, format string, args ...any) *stepError {
	return &stepError{harness: true, step: step, detail: fmt.Sprintf(format, args...)}
}

func heldFailure(step, detail string) *stepError { return &stepError{step: step, detail: detail} }

// stepRecord is one request a scenario sent on one side, for the report.
type stepRecord struct {
	Step   string `json:"step"`
	Method string `json:"method,omitempty"`
	Path   string `json:"path,omitempty"`
	Status int    `json:"status,omitempty"`
	Body   string `json:"body,omitempty"`
	Detail string `json:"detail,omitempty"`
}

// sideOutcome is one scenario on one side: every request, the first step that
// did not hold, and the main response the two sides are compared on.
type sideOutcome struct {
	Steps      []stepRecord `json:"steps"`
	Failure    string       `json:"failure,omitempty"`
	Error      string       `json:"error,omitempty"`
	DurationMS int64        `json:"durationMs"`
	main       SideResult
	mainSent   bool
}

// scenarioExec runs one scenario on one side.
type scenarioExec struct {
	runner *scenarioRunner
	side   *scenarioSide
	item   *scenario
	shard  *shardContext
	vars   map[string]string
	out    *sideOutcome
	counts []int
}

func (exec *scenarioExec) context() context.Context { return exec.runner.ctx }

// run walks setup, the request and the verify steps in order, stopping at the
// first that does not hold, and files that step on the outcome.
func (exec *scenarioExec) run() {
	started := time.Now()
	defer func() { exec.out.DurationMS = time.Since(started).Milliseconds() }()
	failure := exec.steps()
	exec.teardown()
	if failure != nil {
		exec.out.Failure = failure.Error()
		if failure.harness {
			exec.out.Error, exec.out.Failure = failure.Error(), ""
		}
	}
}

// teardown sends each cleanup request once the steps are over, whatever they
// found. A step that cannot be built (its capture never came) or is refused is
// on the record and nothing more: it never fails the scenario.
func (exec *scenarioExec) teardown() {
	if exec.shard.err != "" {
		return
	}
	for index := range exec.item.Teardown {
		step := &exec.item.Teardown[index]
		_ = exec.requestStep(fmt.Sprintf("teardown[%d]", index), step)
	}
}

func (exec *scenarioExec) steps() *stepError {
	if exec.shard.err != "" {
		return harnessFailure("shard", "%s", exec.shard.err)
	}
	for index := range exec.item.Setup {
		if failure := exec.setupStep(index); failure != nil {
			return failure
		}
	}
	if failure := exec.snapshotCounts(); failure != nil {
		return failure
	}
	if failure := exec.mainStep(); failure != nil {
		return failure
	}
	for index := range exec.item.Verify {
		if failure := exec.verifyStep(index); failure != nil {
			return failure
		}
	}
	return nil
}

func (exec *scenarioExec) setupStep(index int) *stepError {
	label := fmt.Sprintf("setup[%d]", index)
	step := &exec.item.Setup[index]
	if step.Request == nil {
		return heldFailure(label, "only request steps run in setup")
	}
	return exec.requestStep(label, step)
}

func (exec *scenarioExec) verifyStep(index int) *stepError {
	label := fmt.Sprintf("verify[%d]", index)
	step := &exec.item.Verify[index]
	switch {
	case step.CountDelta != nil:
		return exec.poll(step.Eventually, func() *stepError { return exec.countStep(label, step, index) })
	case step.Mail != nil:
		return exec.mailStep(label, step)
	case step.Analytics != nil:
		return exec.analyticsStep(label, step)
	}
	return exec.requestStep(label, step)
}

func (exec *scenarioExec) mainStep() *stepError {
	request := exec.item.Request
	result, failure := exec.send("request", request, exec.item.Auth, exec.item.Expect.Status)
	if failure != nil {
		return failure
	}
	exec.out.main, exec.out.mainSent = result, true
	return exec.judge("request", &exec.item.Expect, result, exec.item.Capture)
}

// requestStep sends a setup or verify request, polling when it says
// eventually, and holds it to its expect (a setup without one must be 2xx).
func (exec *scenarioExec) requestStep(label string, step *scenarioStep) *stepError {
	return exec.poll(step.Eventually, func() *stepError {
		var allowed intList
		if step.Expect != nil {
			allowed = step.Expect.Status
		}
		result, failure := exec.send(label, *step.Request, exec.stepAuth(), allowed)
		if failure != nil {
			return failure
		}
		return exec.judge(label, step.Expect, result, step.Capture)
	})
}

// judge holds a response to an expect and, when it holds, files the captures.
func (exec *scenarioExec) judge(label string, expect *scenarioExpect, result SideResult, captures map[string]string) *stepError {
	detail := ""
	if expect == nil || expect.empty() {
		detail = successDetail(result)
	} else {
		expanded, err := exec.expandExpect(*expect)
		if err != nil {
			return harnessFailure(label, "%v", err)
		}
		detail = checkExpect(expanded, result)
	}
	if detail != "" {
		exec.annotate(label, detail)
		return heldFailure(label, detail)
	}
	return exec.capture(label, captures, result)
}

func (exec *scenarioExec) expandExpect(expect scenarioExpect) (scenarioExpect, error) {
	var err error
	if expect.Body != nil {
		if expect.Body, err = expandValue(expect.Body, exec.vars); err != nil {
			return expect, err
		}
	}
	if expect.Contains, err = exec.expandList(expect.Contains); err != nil {
		return expect, err
	}
	if expect.NotContains, err = exec.expandList(expect.NotContains); err != nil {
		return expect, err
	}
	expect.Path, err = expandText(expect.Path, exec.vars)
	return expect, err
}

func (exec *scenarioExec) expandList(list stringList) (stringList, error) {
	out := make(stringList, len(list))
	for index, text := range list {
		expanded, err := expandText(text, exec.vars)
		if err != nil {
			return nil, err
		}
		out[index] = expanded
	}
	return out, nil
}

func (exec *scenarioExec) capture(label string, captures map[string]string, result SideResult) *stepError {
	if len(captures) == 0 {
		return nil
	}
	decoded, _ := decodeJSONBody(result.Body)
	decoded = unwrapTRPCData(exec.side.trpc, decoded)
	for _, name := range sortedStringKeys(captures) {
		value, ok := lookupPath(decoded, captures[name])
		if !ok {
			detail := fmt.Sprintf("capture %s: path %q is not in the body: %s", name, captures[name], excerpt(result.Body))
			exec.annotate(label, detail)
			return heldFailure(label, detail)
		}
		exec.vars[name] = captureText(value)
	}
	return nil
}

// snapshotCounts reads every countDelta list before the scenario's request.
func (exec *scenarioExec) snapshotCounts() *stepError {
	exec.counts = make([]int, len(exec.item.Verify))
	for index := range exec.item.Verify {
		count := exec.item.Verify[index].CountDelta
		if count == nil {
			continue
		}
		length, failure := exec.listLength(fmt.Sprintf("verify[%d] before", index), count)
		if failure != nil {
			return failure
		}
		exec.counts[index] = length
	}
	return nil
}

func (exec *scenarioExec) countStep(label string, step *scenarioStep, index int) *stepError {
	length, failure := exec.listLength(label, step.CountDelta)
	if failure != nil {
		return failure
	}
	if delta := length - exec.counts[index]; delta != *step.CountDelta.By {
		detail := fmt.Sprintf("%s changed by %d (%d -> %d), expected %d", step.CountDelta.Request.Path, delta, exec.counts[index], length, *step.CountDelta.By)
		exec.annotate(label, detail)
		return heldFailure(label, detail)
	}
	return nil
}

func (exec *scenarioExec) listLength(label string, count *scenarioCount) (int, *stepError) {
	result, failure := exec.send(label, count.Request, exec.stepAuth(), nil)
	if failure != nil {
		return 0, failure
	}
	if detail := successDetail(result); detail != "" {
		exec.annotate(label, detail)
		return 0, heldFailure(label, detail)
	}
	decoded, _ := decodeJSONBody(result.Body)
	found, ok := lookupPath(decoded, count.Path)
	length, hasLength := lengthOf(found)
	if !ok || !hasLength {
		detail := fmt.Sprintf("path %q is not a list in %s", count.Path, excerpt(result.Body))
		exec.annotate(label, detail)
		return 0, heldFailure(label, detail)
	}
	return length, nil
}

// send expands one request, sends it with the credential its auth names and
// files the record. A transport error and a 429 nobody expected are harness
// failures.
func (exec *scenarioExec) send(label string, request scenarioRequest, fallbackAuth string, allowed intList) (SideResult, *stepError) {
	built, err := exec.build(request, fallbackAuth)
	if err != nil {
		return SideResult{}, harnessFailure(label, "%v", err)
	}
	exec.runner.requests.Add(1)
	encoded := encodeBody(built.body)
	if built.raw != nil {
		encoded = []byte(*built.raw)
	}
	result := exec.runner.engine.executeOnce(built, encoded)
	exec.record(label, built, result)
	switch {
	case result.Error != "":
		return result, harnessFailure(label, "transport: %s", result.Error)
	case result.Status == http.StatusTooManyRequests && !slices.Contains(allowed, http.StatusTooManyRequests):
		return result, harnessFailure(label, "rate limited (429) by the API's limiter, not the scenario: raise API_RATE_LIMIT_REQUESTS on this stack; %s", excerpt(result.Body))
	}
	return result, nil
}

func (exec *scenarioExec) build(request scenarioRequest, fallbackAuth string) (probeRequest, error) {
	kind := request.Auth
	if kind == "" {
		kind = fallbackAuth
	}
	path, err := expandText(request.Path, exec.vars)
	if err != nil {
		return probeRequest{}, err
	}
	built := probeRequest{baseURL: exec.side.baseURL, method: request.Method, path: path, headers: map[string]string{}}
	switch {
	case isAbsoluteURL(path):
		built.baseURL = ""
	case strings.HasPrefix(path, "/"):
		if built.headers, err = exec.side.authHeaders(exec.shard, kind); err != nil {
			return built, err
		}
	default:
		return built, fmt.Errorf("request path %q is neither /path nor an absolute http(s) URL", excerpt(path))
	}
	for name, value := range request.Headers {
		if built.headers[name], err = expandText(value, exec.vars); err != nil {
			return built, err
		}
	}
	if request.ContentType != "" {
		if built.headers["Content-Type"], err = expandText(request.ContentType, exec.vars); err != nil {
			return built, err
		}
	}
	if built.query, err = exec.expandQuery(request.Query); err != nil {
		return built, err
	}
	if request.BodyRaw != nil {
		raw, rawErr := expandText(*request.BodyRaw, exec.vars)
		built.raw = &raw
		return built, rawErr
	}
	if request.Body != nil {
		built.body, err = expandValue(request.Body, exec.vars)
		if isTRPCPath(path) {
			built.body = wrapTRPCBody(exec.side.trpc, built.body)
		}
	}
	return built, err
}

// isAbsoluteURL is a request path taken from a capture (a presigned upload
// URL): it goes to that host as it is, with none of the side's credentials.
func isAbsoluteURL(path string) bool {
	return strings.HasPrefix(path, "http://") || strings.HasPrefix(path, "https://")
}

func (exec *scenarioExec) expandQuery(query map[string]any) (url.Values, error) {
	if len(query) == 0 {
		return nil, nil
	}
	values := url.Values{}
	for name, raw := range query {
		text, err := expandText(fmt.Sprint(raw), exec.vars)
		if err != nil {
			return nil, err
		}
		values.Set(name, text)
	}
	return values, nil
}

// stepAuth is the credential a setup or verify step uses by default: the
// scenario's own, unless that one is deliberately broken or absent.
func (exec *scenarioExec) stepAuth() string {
	switch exec.item.Auth {
	case authNone, authRestricted, authProjectB, authProjectC, authOrgC:
		return authProject
	case authOrgCOrg:
		return authOrg
	}
	return exec.item.Auth
}

func (exec *scenarioExec) record(label string, request probeRequest, result SideResult) {
	entry := stepRecord{Step: label, Method: request.method, Path: request.path, Status: result.Status, Body: excerpt(result.Body)}
	if last := len(exec.out.Steps) - 1; last >= 0 && exec.out.Steps[last].Step == label {
		exec.out.Steps[last] = entry
		return
	}
	exec.out.Steps = append(exec.out.Steps, entry)
}

func (exec *scenarioExec) annotate(label, detail string) {
	for index := len(exec.out.Steps) - 1; index >= 0; index-- {
		if exec.out.Steps[index].Step == label {
			exec.out.Steps[index].Detail = detail
			return
		}
	}
	exec.out.Steps = append(exec.out.Steps, stepRecord{Step: label, Detail: detail})
}

// poll runs attempt once, and again with growing waits until it holds or the
// limit ends. The waits give the pool slot back.
func (exec *scenarioExec) poll(limit time.Duration, attempt func() *stepError) *stepError {
	deadline := time.Now().Add(limit)
	delay := scenarioPollStart
	for {
		failure := attempt()
		remaining := time.Until(deadline)
		if failure == nil || failure.harness || remaining <= 0 {
			return failure
		}
		exec.yield(min(delay, remaining))
		delay = min(delay*2, scenarioPollCap)
	}
}

// yield sleeps without holding the side's pool slot.
func (exec *scenarioExec) yield(wait time.Duration) {
	exec.side.release()
	started := time.Now()
	select {
	case <-time.After(wait):
	case <-exec.context().Done():
	}
	exec.runner.waitNanos.Add(int64(time.Since(started)))
	exec.side.acquire(exec.context())
}

// mailStep waits for the side's mail sink to catch a matching message (or,
// with absent, to hold none).
func (exec *scenarioExec) mailStep(label string, step *scenarioStep) *stepError {
	if exec.side.mailURL == "" {
		return harnessFailure(label, "no mail sink known for the %s stack: pass -mail-a and -mail-b", exec.side.name)
	}
	limit := step.Eventually
	if limit == 0 && !step.Mail.Absent {
		limit = scenarioMailWait
	}
	return exec.poll(limit, func() *stepError { return exec.mailAttempt(label, step.Mail) })
}

func (exec *scenarioExec) mailAttempt(label string, mail *scenarioMail) *stepError {
	to, err := expandText(mail.To, exec.vars)
	if err != nil {
		return harnessFailure(label, "%v", err)
	}
	found, failure := exec.mailMatches(label, to, mail)
	if failure != nil {
		return failure
	}
	if mail.Absent && found {
		return heldFailure(label, fmt.Sprintf("mail to %q arrived, expected none", to))
	}
	if !mail.Absent && !found {
		return heldFailure(label, fmt.Sprintf("no mail to %q with subject %q and body %q", to, mail.SubjectContains, mail.BodyContains))
	}
	return nil
}

func (exec *scenarioExec) mailMatches(label, to string, mail *scenarioMail) (bool, *stepError) {
	query := url.Values{"to": {to}, "subject": {mail.SubjectContains}}
	list := exec.runner.engine.executeOnce(probeRequest{baseURL: exec.side.mailURL, method: http.MethodGet, path: "/api/messages", query: query}, nil)
	if list.Error != "" || list.Status != http.StatusOK {
		return false, harnessFailure(label, "mail sink %s answered %d %s", exec.side.mailURL, list.Status, list.Error)
	}
	decoded, _ := decodeJSONBody(list.Body)
	messages, _ := lookupPath(decoded, "messages")
	summaries, _ := messages.([]any)
	if mail.BodyContains == "" {
		return len(summaries) > 0, nil
	}
	return exec.anyBodyContains(summaries, mail.BodyContains), nil
}

func (exec *scenarioExec) anyBodyContains(summaries []any, text string) bool {
	for _, summary := range summaries {
		object, _ := summary.(map[string]any)
		id, _ := object["id"].(string)
		full := exec.runner.engine.executeOnce(probeRequest{baseURL: exec.side.mailURL, method: http.MethodGet, path: "/api/messages/" + url.PathEscape(id)}, nil)
		if strings.Contains(full.Body, text) {
			return true
		}
	}
	return false
}
