package codeblock_test

import (
	"context"
	"os/exec"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/langwatch/langwatch/services/nlpgo/app/engine/blocks/codeblock"
)

// requirePython skips the test if python3 isn't available.
func requirePython(t *testing.T) {
	t.Helper()
	if _, err := exec.LookPath("python3"); err != nil {
		t.Skip("python3 not installed; skipping code-block subprocess tests")
	}
}

func newExec(t *testing.T) *codeblock.Executor {
	t.Helper()
	e, err := codeblock.New(codeblock.Options{})
	require.NoError(t, err)
	return e
}

func TestCodeBlock_HappyPath(t *testing.T) {
	requirePython(t)
	res, err := newExec(t).Execute(context.Background(), codeblock.Request{
		Code: "def execute(a, b):\n    return {'sum': a + b}\n",
		Inputs: map[string]any{
			"a": float64(2),
			"b": float64(3),
		},
		DeclaredOutputs: []string{"sum"},
	})
	require.NoError(t, err)
	require.Nil(t, res.Error, "expected no error, got %+v", res.Error)
	assert.Equal(t, float64(5), res.Outputs["sum"])
}

func TestCodeBlock_StdoutCaptured(t *testing.T) {
	requirePython(t)
	res, err := newExec(t).Execute(context.Background(), codeblock.Request{
		Code:            "def execute():\n    print('hello-stdout')\n    return {'ok': True}\n",
		DeclaredOutputs: []string{"ok"},
	})
	require.NoError(t, err)
	require.Nil(t, res.Error)
	assert.Contains(t, res.Stdout, "hello-stdout")
}

func TestCodeBlock_MissingDeclaredOutput(t *testing.T) {
	requirePython(t)
	res, err := newExec(t).Execute(context.Background(), codeblock.Request{
		Code:            "def execute():\n    return {'sum': 1}\n",
		DeclaredOutputs: []string{"sum", "diff"},
	})
	require.NoError(t, err)
	require.NotNil(t, res.Error)
	assert.Contains(t, res.Error.Message, "missing_output: diff")
}

func TestCodeBlock_ExtraOutputKeysPreserved(t *testing.T) {
	// User code that returns extra keys (eg. `class Code: def __call__:
	// return {"output": ..., "dspy": repr(dspy)}`) must surface ALL
	// keys in the Studio OUTPUTS panel, not only the declared ones —
	// operators rely on undeclared diagnostic keys for debug visibility.
	// Declared-output validation is exercised separately by
	// TestCodeBlock_MissingDeclaredOutput.
	requirePython(t)
	res, err := newExec(t).Execute(context.Background(), codeblock.Request{
		Code:            "def execute():\n    return {'sum': 5, 'scratch': [1,2,3]}\n",
		DeclaredOutputs: []string{"sum"},
	})
	require.NoError(t, err)
	require.Nil(t, res.Error)
	assert.Equal(t, float64(5), res.Outputs["sum"])
	scratch, hasScratch := res.Outputs["scratch"]
	assert.True(t, hasScratch, "undeclared output keys must be preserved (legacy parity)")
	assert.Equal(t, []any{float64(1), float64(2), float64(3)}, scratch)
}

func TestCodeBlock_RaisesAreStructured(t *testing.T) {
	requirePython(t)
	res, err := newExec(t).Execute(context.Background(), codeblock.Request{
		Code: "def execute():\n    return {'x': 1/0}\n",
	})
	require.NoError(t, err)
	require.NotNil(t, res.Error)
	assert.Equal(t, "ZeroDivisionError", res.Error.Type)
	assert.Contains(t, res.Error.Traceback, "ZeroDivisionError")
}

func TestCodeBlock_SyntaxErrorReported(t *testing.T) {
	requirePython(t)
	res, err := newExec(t).Execute(context.Background(), codeblock.Request{
		Code: "def execute(:",
	})
	require.NoError(t, err)
	require.NotNil(t, res.Error)
	assert.Contains(t, res.Error.Type, "SyntaxError")
}

func TestCodeBlock_TimeoutKillsSubprocess(t *testing.T) {
	requirePython(t)
	start := time.Now()
	res, err := newExec(t).Execute(context.Background(), codeblock.Request{
		Code:    "def execute():\n    import time\n    time.sleep(10)\n    return {'ok': True}\n",
		Timeout: 500 * time.Millisecond,
	})
	elapsed := time.Since(start)
	require.NoError(t, err)
	assert.True(t, res.TimedOut)
	require.NotNil(t, res.Error)
	assert.Equal(t, "Timeout", res.Error.Type)
	assert.Less(t, elapsed, 3*time.Second, "subprocess must die promptly")
}

func TestCodeBlock_NoExecuteFunctionDefined(t *testing.T) {
	requirePython(t)
	res, err := newExec(t).Execute(context.Background(), codeblock.Request{
		Code: "x = 1\n",
	})
	require.NoError(t, err)
	require.NotNil(t, res.Error)
	assert.Equal(t, "NameError", res.Error.Type)
}

// TestCodeBlock_DspyModuleSubclassInvoked covers the prod-customer
// shape: 387 of 388 surveyed code-blocks subclass `dspy.Module` and
// define a `forward` method. The runner must instantiate the class
// with no args, call `instance(**inputs)` (which dspy.Module's
// __call__ routes to forward), and surface the dict return as
// declared outputs. `import dspy` resolves to the bundled fake_dspy
// stub — no real dspy in the subprocess image.
func TestCodeBlock_DspyModuleSubclassInvoked(t *testing.T) {
	requirePython(t)
	code := `import dspy

class Code(dspy.Module):
    def forward(self, a, b):
        return {"sum": a + b}
`
	res, err := newExec(t).Execute(context.Background(), codeblock.Request{
		Code: code,
		Inputs: map[string]any{
			"a": float64(7),
			"b": float64(8),
		},
		DeclaredOutputs: []string{"sum"},
	})
	require.NoError(t, err)
	require.Nil(t, res.Error, "expected no error, got %+v", res.Error)
	assert.Equal(t, float64(15), res.Outputs["sum"])
}

// TestCodeBlock_PlainClassWithForward covers the new default template:
// a plain Python class (no dspy reference) with a `forward` method.
// The runner must find the class and call `instance.forward(**inputs)`.
func TestCodeBlock_PlainClassWithForward(t *testing.T) {
	requirePython(t)
	code := `class Code:
    def forward(self, x):
        return {"doubled": x * 2}
`
	res, err := newExec(t).Execute(context.Background(), codeblock.Request{
		Code:            code,
		Inputs:          map[string]any{"x": float64(21)},
		DeclaredOutputs: []string{"doubled"},
	})
	require.NoError(t, err)
	require.Nil(t, res.Error, "expected no error, got %+v", res.Error)
	assert.Equal(t, float64(42), res.Outputs["doubled"])
}

// TestCodeBlock_PlainClassWithCallable pins the idiomatic-Python
// shape: a plain class that defines __call__ on itself. The runner
// instantiates the class and invokes __call__ via `instance(**inputs)`.
// __call__ is a built-in Python convention (helpers can live as
// methods on the class) so it's preferred over a free-function
// `def execute()` template that would force helpers to top level.
//
// Crucial detail: the resolution check is `'__call__' in cls.__dict__`,
// not `hasattr(cls, '__call__')`. Every class has an inherited
// __call__ from `type` for instantiation, so the loose hasattr check
// would false-match any class the user defines. The dict-membership
// check matches only classes that *override* __call__ themselves.
func TestCodeBlock_PlainClassWithCallable(t *testing.T) {
	requirePython(t)
	code := `class Code:
    def __call__(self, x):
        return {"doubled": x * 2}
`
	res, err := newExec(t).Execute(context.Background(), codeblock.Request{
		Code:            code,
		Inputs:          map[string]any{"x": float64(21)},
		DeclaredOutputs: []string{"doubled"},
	})
	require.NoError(t, err)
	require.Nil(t, res.Error, "expected no error, got %+v", res.Error)
	assert.Equal(t, float64(42), res.Outputs["doubled"])
}

// TestCodeBlock_CallableTakesPriorityOverForward pins the resolution
// order: when a customer's code defines a class with both __call__
// and forward (e.g. they migrated their template but kept a legacy
// helper class around for one transition release), __call__ wins.
// Without this priority, a customer who copy-pastes our new default
// template alongside an older `forward`-shaped helper would get
// surprising behavior depending on Python dict iteration order.
func TestCodeBlock_CallableTakesPriorityOverForward(t *testing.T) {
	requirePython(t)
	code := `class Helper:
    def forward(self, x):
        return {"out": "wrong"}

class Code:
    def __call__(self, x):
        return {"out": "right"}
`
	res, err := newExec(t).Execute(context.Background(), codeblock.Request{
		Code:            code,
		Inputs:          map[string]any{"x": float64(1)},
		DeclaredOutputs: []string{"out"},
	})
	require.NoError(t, err)
	require.Nil(t, res.Error, "expected no error, got %+v", res.Error)
	assert.Equal(t, "right", res.Outputs["out"], "__call__ class must win over a forward-only helper class")
}

// TestCodeBlock_DspyPredictionReturnValue covers the second-most-common
// return shape from the survey: customer code returning
// `dspy.Prediction(**kwargs)` instead of a plain dict. The fake_dspy
// stub's Prediction must surface its kwargs as dict keys so the
// declared outputs resolve.
func TestCodeBlock_DspyPredictionReturnValue(t *testing.T) {
	requirePython(t)
	code := `import dspy

class Code(dspy.Module):
    def forward(self, q):
        return dspy.Prediction(answer="42", confidence=0.9)
`
	res, err := newExec(t).Execute(context.Background(), codeblock.Request{
		Code:            code,
		Inputs:          map[string]any{"q": "anything"},
		DeclaredOutputs: []string{"answer", "confidence"},
	})
	require.NoError(t, err)
	require.Nil(t, res.Error, "expected no error, got %+v", res.Error)
	assert.Equal(t, "42", res.Outputs["answer"])
	assert.Equal(t, 0.9, res.Outputs["confidence"])
}

// TestCodeBlock_DspyMarkerImportsAreInert covers the marker-only
// surface points: dspy.InputField + dspy.OutputField + dspy.Signature.
// 4 + 2 + 2 customers reference these. The stub returns None / empty
// class — the only contract is "no AttributeError on import or
// reference."
func TestCodeBlock_DspyMarkerImportsAreInert(t *testing.T) {
	requirePython(t)
	code := `import dspy

class MySig(dspy.Signature):
    pass

class Code(dspy.Module):
    a = dspy.InputField()
    b = dspy.OutputField()

    def forward(self, x):
        # Reference markers without expecting behavior.
        _ = MySig
        return {"out": x}
`
	res, err := newExec(t).Execute(context.Background(), codeblock.Request{
		Code:            code,
		Inputs:          map[string]any{"x": "hi"},
		DeclaredOutputs: []string{"out"},
	})
	require.NoError(t, err)
	require.Nil(t, res.Error, "expected no error, got %+v", res.Error)
	assert.Equal(t, "hi", res.Outputs["out"])
}

// TestCodeBlock_DspyPredictRaises pins the deliberate-stub behavior:
// real dspy.Predict performs an LLM call; the stub raises so a
// customer relying on it sees a clear error rather than silent empty
// Predictions. Matches the survey rationale (the 2 affected customers
// should route through the workflow's signature node).
func TestCodeBlock_DspyPredictRaises(t *testing.T) {
	requirePython(t)
	code := `import dspy

class Code(dspy.Module):
    def __init__(self):
        super().__init__()
        self.predict = dspy.Predict("question -> answer")

    def forward(self, question):
        return self.predict(question=question)
`
	res, err := newExec(t).Execute(context.Background(), codeblock.Request{
		Code:            code,
		Inputs:          map[string]any{"question": "anything"},
		DeclaredOutputs: []string{"answer"},
	})
	require.NoError(t, err)
	require.NotNil(t, res.Error, "expected error from dspy.Predict invocation")
	assert.Equal(t, "RuntimeError", res.Error.Type)
	assert.Contains(t, res.Error.Message, "dspy.Predict")
}

// TestCodeBlock_RealDspyNotInImage guards against an accidental real-
// dspy bundle slipping into the subprocess image. The fake stub is a
// strict subset; if a customer code-block reaches into a name we
// didn't stub (e.g. dspy.Example), it must fail with AttributeError
// rather than silently work via a real dspy install. Pin it so a
// future dependency change doesn't quietly re-introduce dspy.
func TestCodeBlock_RealDspyNotInImage(t *testing.T) {
	requirePython(t)
	code := `import dspy

class Code(dspy.Module):
    def forward(self):
        # Example was a real-dspy primitive; never observed in
        # production code-blocks, so the stub doesn't expose it.
        return {"got": dspy.Example(a=1)}
`
	res, err := newExec(t).Execute(context.Background(), codeblock.Request{
		Code:            code,
		DeclaredOutputs: []string{"got"},
	})
	require.NoError(t, err)
	require.NotNil(t, res.Error)
	assert.Equal(t, "AttributeError", res.Error.Type)
	assert.Contains(t, res.Error.Message, "Example")
}

func TestCodeBlock_InvocationsAreIsolated(t *testing.T) {
	requirePython(t)
	exec := newExec(t)
	code := "global_count = locals().get('global_count', 0) + 1\n" +
		"def execute():\n    return {'x': global_count}\n"
	for i := 0; i < 3; i++ {
		res, err := exec.Execute(context.Background(), codeblock.Request{
			Code:            code,
			DeclaredOutputs: []string{"x"},
		})
		require.NoError(t, err)
		require.Nil(t, res.Error, "iter %d", i)
		assert.Equal(t, float64(1), res.Outputs["x"], "no global state leak between invocations")
	}
}
