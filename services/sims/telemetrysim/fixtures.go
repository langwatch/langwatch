package telemetrysim

import (
	"cmp"
	"embed"
	"encoding/json"
	"io/fs"
	"net/http"
	"strconv"
	"strings"
	"time"
)

// recordedSuffix ends every recording under fixtures/ (fixtures/README.md).
const recordedSuffix = ".otlp.json"

//go:embed fixtures
var fixtureFiles embed.FS

func embeddedFixtures() fs.FS {
	sub, err := fs.Sub(fixtureFiles, "fixtures")
	if err != nil {
		panic(err) // the path is a constant that go:embed has already resolved
	}
	return sub
}

// Fixture is one body the console can show and send: a preset, synthesized from
// a seed, or a scrubbed recording named <family>/<name> under fixtures/.
type Fixture struct {
	Name    string `json:"name"`
	Kind    string `json:"kind"` // "preset" or "recorded"
	Signal  Signal `json:"signal"`
	Service string `json:"service,omitempty"`
	Family  string `json:"family,omitempty"`
	Bytes   int    `json:"bytes,omitempty"`
}

// FixtureBody is a fixture with its OTLP JSON body.
type FixtureBody struct {
	Fixture
	Body json.RawMessage `json:"body"`
}

// fixtureList is every preset, then every recording; an unreadable recording is skipped.
func (s *Server) fixtureList() []Fixture {
	list := make([]Fixture, 0, len(presets))
	for i := range presets {
		p := &presets[i]
		list = append(list, Fixture{Name: p.Name, Kind: "preset", Signal: p.Signal, Service: p.Service})
	}
	_ = fs.WalkDir(s.fixtures, ".", func(path string, d fs.DirEntry, err error) error {
		if err != nil {
			return err // an unreadable directory ends the walk; what was listed stands
		}
		if d.IsDir() || !strings.HasSuffix(path, recordedSuffix) {
			return nil
		}
		f, ok := s.recordedFixture(strings.TrimSuffix(path, recordedSuffix))
		if ok {
			list = append(list, f.Fixture)
		}
		return nil
	})
	return list
}

func (s *Server) recordedFixture(name string) (FixtureBody, bool) {
	body, err := s.recorded(name)
	if err != nil {
		return FixtureBody{}, false
	}
	signal, _, err := otlpMessageOf(body)
	if err != nil {
		return FixtureBody{}, false
	}
	family, _, _ := strings.Cut(name, "/")
	return FixtureBody{Fixture: Fixture{Name: name, Kind: "recorded", Signal: signal, Family: family, Bytes: len(body)}, Body: body}, true
}

// handleFixtures is GET /_sim/api/fixtures.
func (s *Server) handleFixtures(w http.ResponseWriter, _ *http.Request) {
	writeJSON(w, http.StatusOK, map[string][]Fixture{"fixtures": s.fixtureList()})
}

// handleFixture is GET /_sim/api/fixtures/{name...}: a preset as uncompressed
// OTLP JSON from ?seed (default 1), or a recording as committed.
func (s *Server) handleFixture(w http.ResponseWriter, r *http.Request) {
	name := r.PathValue("name")
	if f, ok := s.recordedFixture(name); ok {
		writeJSON(w, http.StatusOK, f)
		return
	}
	preset, ok := presetByName(name)
	if !ok {
		writeError(w, http.StatusNotFound, "no fixture "+name+"; GET /_sim/api/fixtures lists them")
		return
	}
	seed, err := strconv.ParseUint(cmp.Or(r.URL.Query().Get("seed"), "1"), 10, 64)
	if err != nil {
		writeError(w, http.StatusBadRequest, "seed must be a whole number")
		return
	}
	payload, err := Build(BatchSpec{Preset: preset, Seed: seed, Start: time.Now().UTC(), Encoding: EncodingJSON})
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, FixtureBody{
		Fixture: Fixture{Name: preset.Name, Kind: "preset", Signal: preset.Signal, Service: preset.Service, Bytes: len(payload.Body)},
		Body:    payload.Body,
	})
}
