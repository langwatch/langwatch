package rules

import (
	"math"
	"slices"
)

// NormedVector is a vector with its norm, so each norm is computed once.
type NormedVector struct {
	Values []float64
	Norm   float64
}

// Normed pairs v with its Norm.
func Normed(v []float64) NormedVector { return NormedVector{Values: v, Norm: Norm(v)} }

// Norm is scipy's _row_norms: sqrt of a sequential sum of squares.
func Norm(v []float64) float64 {
	var s float64
	for _, x := range v {
		s += float64(x * x)
	}
	return math.Sqrt(s)
}

// CosineDistance is scipy's cdist(..., "cosine") for one pair: clipped to
// [0, 2]; a zero vector gives NaN.
func CosineDistance(u, v NormedVector) float64 {
	c := dot(u.Values, v.Values) / (u.Norm * v.Norm)
	if math.Abs(c) > 1 {
		return 1 - math.Copysign(1, c)
	}
	return 1 - c
}

func dot(u, v []float64) float64 {
	var s float64
	for k := range u {
		s += float64(u[k] * v[k])
	}
	return s
}

// Centroid is np.mean(vectors, axis=0): a sequential sum per dimension.
func Centroid(vectors [][]float64) []float64 {
	centroid := make([]float64, len(vectors[0]))
	for _, v := range vectors {
		for k, x := range v {
			centroid[k] += x
		}
	}
	n := float64(len(vectors))
	for k := range centroid {
		centroid[k] /= n
	}
	return centroid
}

// CentroidAndP95 is calculate_centroid_and_distance: the centroid and the
// 95th percentile of each vector's cosine distance to it.
func CentroidAndP95(vectors [][]float64) (centroid []float64, p95 float64) {
	centroid = Centroid(vectors)
	c := Normed(centroid)
	distances := make([]float64, len(vectors))
	for i, v := range vectors {
		distances[i] = CosineDistance(Normed(v), c)
	}
	return centroid, Percentile95(distances)
}

// Percentile95 is numpy 1.26's percentile(d, 95), method "linear"; any NaN
// in gives NaN out.
func Percentile95(d []float64) float64 {
	if slices.ContainsFunc(d, math.IsNaN) {
		return math.NaN()
	}
	sorted := slices.Sorted(slices.Values(d))
	n := len(sorted)
	index := float64(n-1) * 0.95
	if index >= float64(n-1) {
		return sorted[n-1]
	}
	floor := math.Floor(index)
	a, b := sorted[int(floor)], sorted[int(floor)+1]
	gamma := index - floor
	diff := b - a
	if gamma >= 0.5 {
		return b - float64(diff*(1-gamma))
	}
	return a + float64(diff*gamma)
}

// Mean is np.mean over a 1-D list (numpy's pairwise sum); empty gives NaN.
func Mean(values []float64) float64 {
	return pairwiseSum(values) / float64(len(values))
}

// pairwiseSum is numpy's pairwise_sum for float64 (block size 128).
func pairwiseSum(a []float64) float64 {
	switch n := len(a); {
	case n < 8:
		return sequentialSum(0, a)
	case n <= 128:
		return unrolledSum(a)
	}
	half := len(a) / 2
	half -= half % 8
	return pairwiseSum(a[:half]) + pairwiseSum(a[half:])
}

func sequentialSum(s float64, a []float64) float64 {
	for _, x := range a {
		s += x
	}
	return s
}

// unrolledSum is pairwise_sum's 8-accumulator block for 8 to 128 values.
func unrolledSum(a []float64) float64 {
	var r [8]float64
	copy(r[:], a[:8])
	tail := len(a) - len(a)%8
	for i := 8; i < tail; i += 8 {
		for j := range r {
			r[j] += a[i+j]
		}
	}
	s := ((r[0] + r[1]) + (r[2] + r[3])) + ((r[4] + r[5]) + (r[6] + r[7]))
	return sequentialSum(s, a[tail:])
}
