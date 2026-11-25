package codeblock_test

import (
	"syscall"
	"testing"

	"github.com/stretchr/testify/assert"

	"github.com/langwatch/langwatch/services/nlpgo/app/engine/blocks/codeblock"
)

func TestHideModeFor(t *testing.T) {
	cases := []struct {
		name    string
		refusal syscall.Errno
		allow   bool
		want    string
	}{
		{"no refusal, setting off", 0, false, "strict"},
		{"no refusal, setting on", 0, true, "strict"},
		{"EPERM, setting on", syscall.EPERM, true, "visible-process"},
		{"EPERM, setting off", syscall.EPERM, false, "disabled"},
		{"EACCES, setting on", syscall.EACCES, true, "disabled"},
		{"EACCES, setting off", syscall.EACCES, false, "disabled"},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			assert.Equal(t, c.want, codeblock.HideModeFor(c.refusal, c.allow))
		})
	}
}
