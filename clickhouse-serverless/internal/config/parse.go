package config

import (
	"fmt"

	"k8s.io/apimachinery/pkg/api/resource"
)

// ParseHumanBytes converts a Kubernetes memory quantity to bytes.
// Supports: "4Gi", "512Mi", "8G", "1024M", raw bytes, etc.
func ParseHumanBytes(s string) (int64, error) {
	q, err := resource.ParseQuantity(s)
	if err != nil {
		return 0, fmt.Errorf("invalid memory quantity %q: %w", s, err)
	}
	v := q.Value()
	if v < 0 {
		return 0, fmt.Errorf("negative memory value: %s", s)
	}
	return v, nil
}

// ParseCPU converts a Kubernetes CPU quantity to whole cores (min 1).
// Supports: "2" (cores), "500m" (millicores → rounds up to 1), "1500m" → 2.
func ParseCPU(s string) (int, error) {
	q, err := resource.ParseQuantity(s)
	if err != nil {
		return 0, fmt.Errorf("invalid cpu quantity %q: %w", s, err)
	}
	millis := q.MilliValue()
	cores := int((millis + 999) / 1000)
	if cores < 1 {
		return 1, nil
	}
	return cores, nil
}
