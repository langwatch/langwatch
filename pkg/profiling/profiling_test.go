package profiling

import (
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"testing"
	"time"
)

// The whole cost argument for gating on the address rests on this: no address
// means no profiler object, so nothing samples and nothing uploads.
//
// @scenario "A process with no profiling endpoint does not profile"
func TestStartWithoutAServerAddressStartsNothing(t *testing.T) {
	p := Start(Options{ServiceName: "langwatch-app", Environment: "development"})
	if p.p != nil {
		t.Fatal("no server address must mean no profiler")
	}
	// Callers defer Stop unconditionally rather than guarding every call site.
	p.Stop()
}

// A profile nobody can attribute to a service is not worth the upload, and
// Pyroscope has no useful default to fall back on.
//
// @scenario "A process with no profiling endpoint does not profile"
func TestStartWithoutAServiceNameStartsNothing(t *testing.T) {
	p := Start(Options{ServerAddress: "http://127.0.0.1:4040"})
	if p.p != nil {
		t.Fatal("an unnameable profile must not be pushed")
	}
}

// Pyroscope label names follow the Prometheus grammar, which rejects a dot. An
// OTel attribute copied across verbatim is dropped along with the tag it
// carried, and the drop is silent — the push still succeeds, the label is just
// not there when someone goes looking for it.
//
// @scenario "Profiles carry the worktree label in local development"
func TestTagsFromOTelResourceAttributesNormalizesDottedKeys(t *testing.T) {
	tags := TagsFromOTelResourceAttributes("langwatch.worktree=portless,deployment.environment.name=development")

	if got, want := tags["langwatch_worktree"], "portless"; got != want {
		t.Errorf("langwatch_worktree = %q, want %q", got, want)
	}
	if got, want := tags["deployment_environment_name"], "development"; got != want {
		t.Errorf("deployment_environment_name = %q, want %q", got, want)
	}
	if _, present := tags["langwatch.worktree"]; present {
		t.Error("the dotted key must not survive — Pyroscope would reject it")
	}
}

// @scenario "Profiles carry the worktree label in local development"
func TestTagsFromOTelResourceAttributesToleratesJunk(t *testing.T) {
	cases := map[string]string{
		"":                    "empty",
		"   ":                 "blank",
		"novalue":             "no separator",
		"=orphan":             "no key",
		"langwatch.worktree=": "no value",
		",,,":                 "separators only",
	}
	for input, name := range cases {
		if tags := TagsFromOTelResourceAttributes(input); len(tags) != 0 {
			t.Errorf("%s (%q): want no tags, got %v", name, input, tags)
		}
	}

	// A junk pair must not take the good ones down with it.
	tags := TagsFromOTelResourceAttributes("novalue,langwatch.worktree=portless,=orphan")
	if got, want := len(tags), 1; got != want {
		t.Fatalf("got %d tags, want %d: %v", got, want, tags)
	}
	if got := tags["langwatch_worktree"]; got != "portless" {
		t.Errorf("langwatch_worktree = %q, want portless", got)
	}
}

// A leading digit is as invalid a Prometheus label name as a dot is, so the
// substitution has to produce a letter-or-underscore first character rather
// than simply dropping the offending rune.
//
// @scenario "Profiles carry the worktree label in local development"
func TestNormalizeTagKeyProducesValidLabelNames(t *testing.T) {
	for input, want := range map[string]string{
		"langwatch.worktree": "langwatch_worktree",
		"service.name":       "service_name",
		"9lives":             "_lives",
		"a1":                 "a1",
		"host-name":          "host_name",
		"":                   "",
	} {
		if got := normalizeTagKey(input); got != want {
			t.Errorf("normalizeTagKey(%q) = %q, want %q", input, got, want)
		}
	}
}

// The binding for "a process with a profiling endpoint profiles itself". The
// other tests here prove the gate stays shut; this one proves it opens — that a
// configured process really does sample itself and put the samples on the wire,
// rather than merely constructing a profiler object and reporting success.
//
// It asserts on an upload actually arriving, and on the identity it carries,
// because those are the two ways this quietly fails in production: a profiler
// that starts and never uploads, and an upload that lands unattributable.
//
// @scenario "A process with a profiling endpoint profiles itself"
func TestStartPushesProfilesCarryingTheServiceIdentity(t *testing.T) {
	uploads := make(chan url.Values, 8)
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		select {
		case uploads <- r.URL.Query():
		default:
		}
		w.WriteHeader(http.StatusOK)
	}))
	defer srv.Close()

	p := Start(Options{
		ServerAddress: srv.URL,
		ServiceName:   "langwatch-test",
		Environment:   "test",
		Tags:          map[string]string{"langwatch.worktree": "portless"},
		// The SDK's 15s default would make this a 15-second unit test.
		UploadRate: 100 * time.Millisecond,
	})
	if p.p == nil {
		t.Fatal("a configured profiler must start")
	}
	defer p.Stop()

	// Give the profiler something to find, so the upload is not an empty one.
	burnCPU(200 * time.Millisecond)

	select {
	case query := <-uploads:
		// Pyroscope encodes the application name and its tags into one
		// `name` parameter: app{key=value,...}.
		name := query.Get("name")
		if !strings.HasPrefix(name, "langwatch-test") {
			t.Errorf("upload name = %q, want it to start with the service name", name)
		}
		if !strings.Contains(name, "langwatch_worktree=portless") {
			t.Errorf("upload name = %q, want the normalized worktree tag", name)
		}
		if !strings.Contains(name, "environment=test") {
			t.Errorf("upload name = %q, want the environment tag", name)
		}
	case <-time.After(20 * time.Second):
		t.Fatal("a started profiler never uploaded anything")
	}
}

func burnCPU(d time.Duration) {
	deadline := time.Now().Add(d)
	x := 0.0
	for time.Now().Before(deadline) {
		for i := range 100_000 {
			x += float64(i%7) * 1.000001
		}
	}
	_ = x
}

// @scenario "Profiles carry the service identity"
func TestBuildTagsCarriesTheEnvironment(t *testing.T) {
	tags := buildTags(Options{
		Environment: "production",
		Tags:        map[string]string{"langwatch.worktree": "portless", "empty": ""},
	})

	if got, want := tags["environment"], "production"; got != want {
		t.Errorf("environment = %q, want %q", got, want)
	}
	if got, want := tags["langwatch_worktree"], "portless"; got != want {
		t.Errorf("langwatch_worktree = %q, want %q", got, want)
	}
	// An empty value is a label that matches nothing and clutters every
	// autocomplete; it is not the same as an absent one.
	if _, present := tags["empty"]; present {
		t.Error("an empty tag value must not be sent")
	}
}
