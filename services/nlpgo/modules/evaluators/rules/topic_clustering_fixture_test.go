package rules_test

import (
	"encoding/json"
	"fmt"
	"math"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/langwatch/langwatch/services/nlpgo/modules/evaluators/contract"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/langwatch/langwatch/services/nlpgo/modules/evaluators/rules"
)

// Fixtures come from services/langevals/evaluators/topic_clustering/scripts/record_go_fixtures.py.

const syntheticDim = 1536

// syntheticNoise mirrors the recorder's noise(): SplitMix64, Irwin-Hall(4).
func syntheticNoise(seed uint64) []float64 {
	out := make([]float64, syntheticDim)
	state := seed
	next := func() float64 {
		state += 0x9E3779B97F4A7C15
		z := state
		z = (z ^ (z >> 30)) * 0xBF58476D1CE4E5B9
		z = (z ^ (z >> 27)) * 0x94D049BB133111EB
		z ^= z >> 31
		return float64(z>>11) * 0x1p-53
	}
	for j := range out {
		u0, u1, u2, u3 := next(), next(), next(), next()
		out[j] = u0 + u1 + u2 + u3 - 2
	}
	return out
}

// syntheticVector mirrors the recorder's vector_for("tNN sM qQQQ").
func syntheticVector(t *testing.T, text string) []float64 {
	t.Helper()
	var topic, sub, q uint64
	_, err := fmt.Sscanf(text, "t%d s%d q%d", &topic, &sub, &q)
	require.NoError(t, err)
	b, c := 0.5, 0.3
	switch {
	case sub >= 7:
		b, c = 0.3, 0.2
	case topic >= 8:
		b, c = 0.4, 0.2
	}
	base, offset := syntheticNoise(1000+topic), syntheticNoise(2_000_000+topic*1000+sub)
	point := syntheticNoise(3_000_000_000 + topic*1_000_000 + sub*10_000 + q)
	v := make([]float64, syntheticDim)
	var squares float64
	for j := range v {
		v[j] = base[j] + float64(b*offset[j])
		v[j] += float64(c * point[j])
		squares += float64(v[j] * v[j])
	}
	norm := math.Sqrt(squares)
	for j := range v {
		v[j] = float64(float32(v[j] / norm))
	}
	return v
}

type syntheticTrace struct{ id, input string }

// syntheticTraces mirrors traces_for: (topic, subtopic, first q, count, distinct).
func syntheticTraces(spec [][5]int) []syntheticTrace {
	var out []syntheticTrace
	for _, s := range spec {
		for i := range s[3] {
			out = append(out, syntheticTrace{
				id:    fmt.Sprintf("tr-%02d-%d-%03d", s[0], s[1], s[2]+i),
				input: fmt.Sprintf("t%02d s%d q%03d", s[0], s[1], s[2]+i%s[4]),
			})
		}
	}
	return out
}

func embedded(t *testing.T, spec [][5]int) []rules.EmbeddedTrace {
	t.Helper()
	var out []rules.EmbeddedTrace
	for _, s := range syntheticTraces(spec) {
		out = append(out, rules.EmbeddedTrace{ClusteringTrace: contract.ClusteringTrace{TraceID: s.id, Input: s.input}, Vector: syntheticVector(t, s.input)})
	}
	return out
}

func loadFixture(tb testing.TB, name string, into any) {
	tb.Helper()
	raw, err := os.ReadFile(filepath.Join("testdata", "clustering", name))
	require.NoError(tb, err)
	require.NoError(tb, json.Unmarshal(raw, into))
}

type linkageCase struct {
	Name        string       `json:"name"`
	Spec        [][5]int     `json:"spec"`
	VectorProbe [][3]float64 `json:"vector_probe"`
	Z           [][4]float64 `json:"z"`
	Labels4     []int        `json:"labels4"`
	Labels2     []int        `json:"labels2"`
	Clusters4   []struct {
		Label         int       `json:"label"`
		P95           float64   `json:"p95"`
		CentroidProbe []float64 `json:"centroid_probe"`
	} `json:"clusters4"`
}

func linkageCases(t *testing.T) []linkageCase {
	t.Helper()
	var cases []linkageCase
	loadFixture(t, "linkage.json", &cases)
	require.NotEmpty(t, cases)
	return cases
}

func linkageOf(t *testing.T, c linkageCase) ([]rules.EmbeddedTrace, []rules.Merge) {
	t.Helper()
	traces := embedded(t, c.Spec)
	for _, p := range c.VectorProbe {
		require.Equal(t, math.Float64bits(p[2]), math.Float64bits(traces[int(p[0])].Vector[int(p[1])]), "the Go generator must reproduce the recorder's vectors")
	}
	vectors := make([][]float64, len(traces))
	for i, tr := range traces {
		vectors[i] = tr.Vector
	}
	dist, err := rules.Pdist(vectors)
	require.NoError(t, err)
	z, err := rules.WardLinkage(len(vectors), dist)
	require.NoError(t, err)
	return traces, z
}

func requireClose(t *testing.T, want, got float64, what string) {
	t.Helper()
	require.LessOrEqual(t, math.Abs(want-got), 1e-12*math.Max(1, math.Abs(want)), "%s: want %v got %v", what, want, got)
}

// @scenario "Ward linkage reproduces scipy's merge order, heights and cluster ids"
func TestWardLinkageMatchesScipy(t *testing.T) {
	for _, c := range linkageCases(t) {
		t.Run(c.Name, func(t *testing.T) {
			_, z := linkageOf(t, c)
			require.Len(t, z, len(c.Z))
			for i, row := range c.Z {
				require.Equal(t, [3]int{int(row[0]), int(row[1]), int(row[3])}, [3]int{z[i].A, z[i].B, z[i].Size}, "row %d", i)
				requireClose(t, row[2], z[i].Height, fmt.Sprintf("height of row %d", i))
			}
		})
	}
}

// @scenario "Flat clusters at distance 4 and 2 match scipy's labels"
func TestFlatClustersByDistanceMatchesScipy(t *testing.T) {
	for _, c := range linkageCases(t) {
		t.Run(c.Name, func(t *testing.T) {
			_, z := linkageOf(t, c)
			assert.Equal(t, c.Labels4, rules.FlatClustersByDistance(z, rules.TopicDistance))
			assert.Equal(t, c.Labels2, rules.FlatClustersByDistance(z, rules.SubtopicDistance))
		})
	}
}

// @scenario "Centroids and p95 distances match numpy"
func TestCentroidAndP95MatchNumpy(t *testing.T) {
	for _, c := range linkageCases(t) {
		t.Run(c.Name, func(t *testing.T) {
			traces := embedded(t, c.Spec)
			for _, cluster := range c.Clusters4 {
				var vectors [][]float64
				for i, l := range c.Labels4 {
					if l == cluster.Label {
						vectors = append(vectors, traces[i].Vector)
					}
				}
				centroid, p95 := rules.CentroidAndP95(vectors)
				requireClose(t, cluster.P95, p95, "p95")
				for k, want := range cluster.CentroidProbe {
					require.Equal(t, math.Float64bits(want), math.Float64bits(centroid[k*64]), "centroid dim %d of cluster %d", k*64, cluster.Label)
				}
			}
		})
	}
	var means []struct {
		Values []float64 `json:"values"`
		Mean   float64   `json:"mean"`
	}
	loadFixture(t, "means.json", &means)
	for _, m := range means {
		assert.Equal(t, math.Float64bits(m.Mean), math.Float64bits(rules.Mean(m.Values)), "mean of %d values", len(m.Values))
	}
}

// @scenario "A cluster with too few distinct inputs, a p95 over the ceiling or no surviving subtopic is dropped"
func TestBuildTopicHierarchyMatchesPython(t *testing.T) {
	var cases []struct {
		Name       string   `json:"name"`
		Spec       [][5]int `json:"spec"`
		MaximumP95 float64  `json:"maximum_p95"`
		Topics     []struct {
			Key       string `json:"key"`
			Subtopics []struct {
				Key      string   `json:"key"`
				TraceIDs []string `json:"trace_ids"`
			} `json:"subtopics"`
		} `json:"topics"`
	}
	loadFixture(t, "hierarchy.json", &cases)
	for _, c := range cases {
		t.Run(c.Name, func(t *testing.T) {
			hierarchy, err := rules.BuildTopicHierarchy(embedded(t, c.Spec), c.MaximumP95)
			require.NoError(t, err)
			var want, got []string
			for _, topic := range c.Topics {
				for _, sub := range topic.Subtopics {
					want = append(want, topic.Key+"/"+sub.Key+": "+strings.Join(sub.TraceIDs, ","))
				}
			}
			for _, topic := range hierarchy {
				for _, sub := range topic.Subtopics {
					ids := make([]string, len(sub.Traces))
					for i, tr := range sub.Traces {
						ids[i] = tr.TraceID
					}
					got = append(got, fmt.Sprintf("Topic %d/Subtopic %d: %s", topic.Label, sub.Label, strings.Join(ids, ",")))
				}
			}
			assert.Equal(t, want, got)
		})
	}
}

// BenchmarkWardLinkage2000 is pdist plus Ward on one full TS page.
func BenchmarkWardLinkage2000(b *testing.B) {
	vectors := make([][]float64, 2000)
	for i := range vectors {
		vectors[i] = syntheticNoise(uint64(i % 40))
		point := syntheticNoise(uint64(100_000 + i))
		for j := range vectors[i] {
			vectors[i][j] += float64(point[j] * 0.3)
		}
	}
	b.ReportAllocs()
	b.ResetTimer()
	for range b.N {
		dist, err := rules.Pdist(vectors)
		if err != nil {
			b.Fatal(err)
		}
		z, err := rules.WardLinkage(len(vectors), dist)
		if err != nil || len(z) != 1999 {
			b.Fatal(err)
		}
	}
}
