package domain

import (
	"testing"

	"github.com/stretchr/testify/assert"
)

func TestA2ATargetAdmit(t *testing.T) {
	cases := []struct {
		name   string
		target A2ATarget
		want   A2ADecision
	}{
		{"blocked wins over a listed key", A2ATarget{Blocked: true, Policy: &A2APolicy{AllowedVirtualKeyIDs: []string{"vk_a"}}}, A2ATargetBlocked},
		{"nil policy admits any key", A2ATarget{}, A2AAllowed},
		{"empty non-nil list denies every key", A2ATarget{Policy: &A2APolicy{AllowedVirtualKeyIDs: []string{}}}, A2ACallerNotAllowed},
		{"listed key is admitted", A2ATarget{Policy: &A2APolicy{AllowedVirtualKeyIDs: []string{"vk_b", "vk_a"}}}, A2AAllowed},
		{"unlisted key is refused", A2ATarget{Policy: &A2APolicy{AllowedVirtualKeyIDs: []string{"vk_b"}}}, A2ACallerNotAllowed},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			assert.Equal(t, tc.want, tc.target.Admit("vk_a"))
		})
	}
}
