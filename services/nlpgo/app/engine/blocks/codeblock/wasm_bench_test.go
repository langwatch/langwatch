package codeblock_test

import (
	"context"
	"testing"

	"github.com/langwatch/langwatch/services/nlpgo/app/engine/blocks/codeblock"
)

func BenchmarkWasmTrivialRun(b *testing.B) {
	e := newWasmExec(&testing.T{}, codeblock.Options{})
	for b.Loop() {
		_, _ = e.Execute(context.Background(), codeblock.Request{Code: "def execute():\n    return {'ok': 1}\n"})
	}
}

func BenchmarkSubprocessTrivialRun(b *testing.B) {
	e, _ := codeblock.New(codeblock.Options{Runtime: codeblock.RuntimeSubprocess})
	for b.Loop() {
		_, _ = e.Execute(context.Background(), codeblock.Request{Code: "def execute():\n    return {'ok': 1}\n"})
	}
}
