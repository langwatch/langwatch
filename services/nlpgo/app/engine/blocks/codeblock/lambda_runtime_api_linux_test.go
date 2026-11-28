//go:build linux

package codeblock_test

import (
	"context"
	"net"
	"os"
	"sync/atomic"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/langwatch/langwatch/services/nlpgo/app/engine/blocks/codeblock"
)

// runtimeAPIReach is user code that tries every route this interpreter offers
// to the Lambda runtime API, and one ordinary loopback service it may reach.
const runtimeAPIReach = `import ctypes, os, socket, subprocess, urllib.request

def attempt(fn):
    try:
        fn()
        return "reached"
    except Exception as e:
        return type(e).__name__

def execute(api, other):
    host, port = api.rsplit(":", 1)
    port = int(port)
    url = f"http://{api}/2018-06-01/runtime/invocation/next"

    def by_name():
        with socket.socket() as s:
            s.settimeout(2)
            s.connect(("localhost", port))

    def fast_open():
        with socket.socket() as s:
            s.settimeout(2)
            s.sendto(b"GET / HTTP/1.0\r\n\r\n", getattr(socket, "MSG_FASTOPEN", 0x20000000), (host, port))

    def native():
        libc = ctypes.CDLL(None)
        fd = libc.socket(socket.AF_INET, socket.SOCK_STREAM, 0)
        raise OSError(f"native socket {fd} opened")

    class Disguised(socket.socket):
        family = socket.AF_UNIX

    def disguised():
        with Disguised(socket.AF_INET, socket.SOCK_STREAM) as s:
            s.settimeout(2)
            socket.socket.connect(s, (host, port))

    def patched_parser():
        import ipaddress
        ipaddress.ip_address = lambda _: ipaddress.IPv4Address("8.8.8.8")
        socket.inet_pton = lambda *_: bytes(4)
        socket.create_connection((host, port), timeout=2).close()

    def mapped_unspecified():
        with socket.socket(socket.AF_INET6, socket.SOCK_STREAM) as s:
            s.settimeout(2)
            s.connect(("::ffff:0.0.0.0", port))

    def unaudited_exec():
        import _posixsubprocess
        _posixsubprocess.fork_exec

    def reimported_exec():
        import sys
        sys.modules.pop("_posixsubprocess", None)
        import _posixsubprocess
        _posixsubprocess.fork_exec

    def child_process(method):
        import multiprocessing
        context = multiprocessing.get_context(method)
        child = context.Process(target=socket.create_connection, args=((host, port),))
        child.start()
        child.join(5)

    def forked():
        pid = os.fork()
        if pid == 0:
            try:
                socket.create_connection((host, port), timeout=2)
            finally:
                os._exit(0)
        os.waitpid(pid, 0)

    def subinterpreter():
        import _xxsubinterpreters as interpreters
        interpreters.run_string(interpreters.create(), f"import socket; socket.create_connection(('{host}', {port}), timeout=2)")

    def recreated_builtin():
        import _imp, importlib.machinery as machinery
        fresh = _imp.create_builtin(machinery.ModuleSpec("_posixsubprocess", machinery.BuiltinImporter))
        fresh.fork_exec

    def extension_loader():
        import glob, importlib.machinery as machinery, importlib.util as util
        paths = glob.glob("/usr/**/_posixsubprocess*.so", recursive=True)
        if not paths:
            raise ImportError("_posixsubprocess is built in here")
        spec = util.spec_from_loader("pkg._posixsubprocess", machinery.ExtensionFileLoader("pkg._posixsubprocess", paths[0]))
        util.module_from_spec(spec).fork_exec

    def connected_sendmsg():
        with socket.create_connection(("127.0.0.1", int(other)), timeout=2) as s:
            s.sendmsg([b"ping"])

    def shell():
        if os.system(f"exec 3<>/dev/tcp/{host}/{port}") != 0:
            raise OSError("the shell could not connect")

    return {"outcomes": {
        "urllib": attempt(lambda: urllib.request.urlopen(url, timeout=2).read()),
        "create_connection": attempt(lambda: socket.create_connection((host, port), timeout=2).close()),
        "by_name": attempt(by_name),
        "fast_open": attempt(fast_open),
        "link_local": attempt(lambda: socket.create_connection(("169.254.1.1", 9001), timeout=2).close()),
        "native": attempt(native),
        "program": attempt(lambda: subprocess.run(["curl", "-s", "-m", "2", url], check=True)),
        "shell": attempt(shell),
        "unspecified": attempt(lambda: socket.create_connection(("0.0.0.0", port), timeout=2).close()),
        "disguised": attempt(disguised),
        "patched_parser": attempt(patched_parser),
        "mapped_unspecified": attempt(mapped_unspecified),
        "unaudited_exec": attempt(unaudited_exec),
        "reimported_exec": attempt(reimported_exec),
        "forked_child": attempt(lambda: child_process("fork")),
        "spawned_child": attempt(lambda: child_process("spawn")),
        "forked": attempt(forked),
        "subinterpreter": attempt(subinterpreter),
        "recreated_builtin": attempt(recreated_builtin),
        "extension_loader": attempt(extension_loader),
        "connected_sendmsg": attempt(connected_sendmsg),
        "other_service": attempt(lambda: socket.create_connection(("127.0.0.1", int(other)), timeout=2).close()),
    }}
`

// countingListener accepts on loopback and counts every connection made to it.
func countingListener(t *testing.T) (string, *atomic.Int32) {
	t.Helper()
	ln, err := net.Listen("tcp", "127.0.0.1:0")
	require.NoError(t, err)
	t.Cleanup(func() { _ = ln.Close() })
	var accepted atomic.Int32
	go func() {
		for {
			conn, err := ln.Accept()
			if err != nil {
				return
			}
			accepted.Add(1)
			_ = conn.Close()
		}
	}()
	return ln.Addr().String(), &accepted
}

// @scenario "on AWS Lambda, the runner refuses user code the usual routes to the Lambda runtime API"
func TestLambdaCredentials_UserCodeCannotReachTheRuntimeAPI(t *testing.T) {
	runInLambdaSandbox(t, "lambda-runtime-api", lambdaSandbox{execOnly: true})
}

// @scenario "on AWS Lambda, the runner refuses user code the usual routes to the Lambda runtime API"
func TestLambdaCredentials_UserCodeCannotReachTheRuntimeAPIUnconfined(t *testing.T) {
	runInLambdaSandbox(t, "lambda-runtime-api-unconfined", lambdaSandbox{execOnly: true})
}

// runRuntimeAPIFence stands a listener in for the runtime API, names it the
// way Lambda does, and requires that no route user code takes reaches it.
func runRuntimeAPIFence(t *testing.T) {
	t.Helper()
	api, reachedAPI := countingListener(t)
	other, _ := countingListener(t)
	_, otherPort, _ := net.SplitHostPort(other)
	require.NoError(t, os.Setenv("AWS_LAMBDA_RUNTIME_API", api))

	exe, err := codeblock.New(codeblock.Options{Python: os.Getenv(lambdaPythonEnv)})
	require.NoError(t, err)
	res, err := exe.Execute(context.Background(), codeblock.Request{
		Code:            runtimeAPIReach,
		Inputs:          map[string]any{"api": api, "other": otherPort},
		DeclaredOutputs: []string{"outcomes"},
		Timeout:         60 * time.Second,
	})
	require.NoError(t, err)
	require.Nil(t, res.Error, "%+v\nstderr: %s", res.Error, res.Stderr)

	outcomes, _ := res.Outputs["outcomes"].(map[string]any)
	assert.Equal(t, "reached", outcomes["other_service"], "an ordinary loopback service stays reachable")
	assert.Equal(t, "URLError", outcomes["urllib"], "urllib wraps the refusal: %v", outcomes)
	for _, route := range []string{"create_connection", "by_name", "fast_open", "link_local", "native", "program", "shell", "unspecified", "disguised", "patched_parser", "mapped_unspecified"} {
		assert.Equal(t, "PermissionError", outcomes[route], "route %s: %v", route, outcomes)
	}
	assert.Equal(t, "AttributeError", outcomes["unaudited_exec"], "fork_exec raises no audit event, so it is gone: %v", outcomes)
	assert.Equal(t, "ImportError", outcomes["reimported_exec"], "a fresh import would bring fork_exec back: %v", outcomes)
	assert.NotEqual(t, "reached", outcomes["spawned_child"], "a spawned interpreter would start without the hook: %v", outcomes)
	assert.Equal(t, "ImportError", outcomes["subinterpreter"], "a sub-interpreter starts without the hook: %v", outcomes)
	assert.Equal(t, "ImportError", outcomes["recreated_builtin"], "a fresh built-in module would bring fork_exec back: %v", outcomes)
	assert.Equal(t, "ImportError", outcomes["extension_loader"], "a renamed extension module would bring fork_exec back: %v", outcomes)
	assert.Equal(t, "reached", outcomes["connected_sendmsg"], "sendmsg on a connected socket is judged at its connect: %v", outcomes)
	// A forked child keeps the hook, so forked and forked_child return; the
	// listener's count below is what proves their connection was refused.
	time.Sleep(200 * time.Millisecond)
	assert.Zero(t, reachedAPI.Load(), "nothing user code ran may connect to the runtime API: %v", outcomes)
}
