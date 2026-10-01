package apidiff

import (
	"encoding/json"
	"fmt"
	"net/http"
	"net/url"
	"strings"
	"time"

	"github.com/langwatch/langwatch/services/analyticssim"
)

// scenarioAnalyticsWait is how long an analytics step polls by default: the
// calls leave through eventing subscribers and the PostHog client's flush.
const scenarioAnalyticsWait = 30 * time.Second

// scenarioAnalytics asserts the side's analyticssim caught a matching call:
// provider and kind, optionally the distinct id, the event name and properties
// (an empty property value asks only that the key is there).
type scenarioAnalytics struct {
	Provider   string            `yaml:"provider"`
	Kind       string            `yaml:"kind"`
	ID         string            `yaml:"id"`
	Name       string            `yaml:"name"`
	Properties map[string]string `yaml:"properties"`
	Absent     bool              `yaml:"absent"`
}

func validateAnalytics(where string, step *scenarioAnalytics, verify bool) []string {
	var problems []string
	if !verify {
		problems = append(problems, where+": analytics belongs in verify")
	}
	if step.Provider != analyticssim.ProviderPostHog && step.Provider != analyticssim.ProviderCustomerIO {
		problems = append(problems, where+": analytics.provider must be posthog or customerio")
	}
	if step.Kind == "" {
		problems = append(problems, where+": analytics needs kind (identify, event, alias or group)")
	}
	return problems
}

// analyticsURL is the analyticssim haven routes beside the side's app, as
// visualdiff derives the mail sink: analytics.<slug> for app.<slug>.
func analyticsURL(baseURL string) string {
	parsed, err := url.Parse(baseURL)
	if err != nil || !strings.HasPrefix(parsed.Host, "app.") {
		return ""
	}
	return parsed.Scheme + "://analytics." + strings.TrimPrefix(parsed.Host, "app.")
}

func (exec *scenarioExec) analyticsStep(label string, step *scenarioStep) *stepError {
	base := analyticsURL(exec.side.baseURL)
	if base == "" {
		return harnessFailure(label, "no analyticssim known for the %s stack: run it under haven with +analytics", exec.side.name)
	}
	limit := step.Eventually
	if limit == 0 && !step.Analytics.Absent {
		limit = scenarioAnalyticsWait
	}
	return exec.poll(limit, func() *stepError { return exec.analyticsAttempt(label, base, step.Analytics) })
}

func (exec *scenarioExec) analyticsAttempt(label, base string, want *scenarioAnalytics) *stepError {
	id, err := expandText(want.ID, exec.vars)
	if err != nil {
		return harnessFailure(label, "%v", err)
	}
	properties := map[string]string{}
	for key, value := range want.Properties {
		if properties[key], err = expandText(value, exec.vars); err != nil {
			return harnessFailure(label, "%v", err)
		}
	}
	query := url.Values{"provider": {want.Provider}, "kind": {want.Kind}}
	for key, value := range map[string]string{"id": id, "name": want.Name} {
		if value != "" {
			query.Set(key, value)
		}
	}
	list := exec.runner.engine.executeOnce(probeRequest{baseURL: base, method: http.MethodGet, path: "/_sim/api/records", query: query}, nil)
	if list.Error != "" || list.Status != http.StatusOK {
		return harnessFailure(label, "analyticssim %s answered %d %s", base, list.Status, list.Error)
	}
	var answer struct {
		Records []analyticssim.Record `json:"records"`
	}
	if err := json.Unmarshal([]byte(list.Body), &answer); err != nil {
		return harnessFailure(label, "analyticssim %s answered no record list: %v", base, err)
	}
	found := false
	for _, record := range answer.Records {
		found = found || analyticssim.HasProperties(record, properties)
	}
	what := fmt.Sprintf("%s %s %q for %q with %v", want.Provider, want.Kind, want.Name, id, properties)
	if want.Absent && found {
		return heldFailure(label, "analytics call "+what+" reached the sim, expected none")
	}
	if !want.Absent && !found {
		return heldFailure(label, "no analytics call "+what+" reached the sim")
	}
	return nil
}
