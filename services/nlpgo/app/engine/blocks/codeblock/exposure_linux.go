//go:build linux

// What a code block could read that it must not, decided by looking.
//
// A code block runs as the same user as the engine and, on AWS Lambda, as the
// Lambda Web Adapter extension beside it, with no namespace between them. Any
// of those processes that the kernel still counts as dumpable has its
// environment, memory and descriptors open to the code block through /proc, and
// on Lambda that environment carries the function role's credentials.
//
// The engine asks prctl(PR_SET_DUMPABLE, 0) to close its own files, which
// Lambda's seccomp refuses. The kernel offers a second way that needs no
// syscall at all: a process that execs a file its user cannot read is marked
// non-dumpable by exec itself. The image therefore ships the engine, the
// adapter and the interpreter execute-only, and this file checks the outcome
// rather than the route: whatever the platform allowed, is anything left open?
package codeblock

import (
	"bytes"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"syscall"

	"github.com/langwatch/langwatch/pkg/cloudcredentials"
)

// prGetDumpable is PR_GET_DUMPABLE; suidDumpUser is the value it returns for a
// process whose /proc files its own user can read.
const (
	prGetDumpable = 3
	suidDumpUser  = 1
)

// ambientCredentialVariables are the variables a cloud platform puts the
// workload's own identity in. A readable process holding one of them hands it
// to every code block, so finding one disables code blocks.
var ambientCredentialVariables = cloudcredentials.Names()

// detectExposure names the first thing a code block could read that it must
// not, or returns "" when there is none. python is the interpreter the
// executor starts.
func detectExposure(python string) string {
	if !processHidden() {
		return fmt.Sprintf("the engine's own process files are readable by user code: the platform refused prctl(PR_SET_DUMPABLE) (%s) and the engine's binary is readable; ship it execute-only (mode 0711)", errnoText(hideRefusal))
	}
	if hideRefusal != 0 {
		if path, readable := interpreterReadable(python); readable {
			return fmt.Sprintf("the interpreter cannot hide a run from user code: the platform refused prctl(PR_SET_DUMPABLE) (%s) and %s is readable; ship it execute-only (mode 0711)", errnoText(hideRefusal), path)
		}
	}
	if pid, name, found := readableCredentialHolder(); found {
		return credentialHolderExposure(pid, name)
	}
	return ""
}

// credentialHolderExposure names a readable holder and the advice that fits
// it. Shipping a binary execute-only helps only a process the image starts
// beside the engine (the Lambda adapter); a shell or IDE that started the
// engine, or a process in another PID namespace, needs something else.
func credentialHolderExposure(pid int, name string) string {
	held := fmt.Sprintf("process %d holds %s and its environment is readable by user code", pid, name)
	switch {
	case startedTheEngine(pid):
		return held + "; it started the engine, so unset " + name + " in the environment the engine is started from"
	case inAnotherPIDNamespace(pid):
		return held + "; it runs in another PID namespace, so stop it or run the engine in a PID namespace of its own"
	}
	return held + "; ship its binary execute-only (mode 0711)"
}

// startedTheEngine reports whether pid is an ancestor of this process.
func startedTheEngine(pid int) bool {
	for parent, hops := os.Getppid(), 0; parent > 0 && hops < maxAncestryHops; hops++ {
		if parent == pid {
			return true
		}
		entry, ok := readProcEntry(parent)
		if !ok {
			return false
		}
		parent = entry.ppid
	}
	return false
}

// inAnotherPIDNamespace reports whether pid's PID namespace differs from this
// process's. A namespace that cannot be read is not called another.
func inAnotherPIDNamespace(pid int) bool {
	theirs, err := os.Readlink(procPath(pid, "ns/pid"))
	if err != nil {
		return false
	}
	ours, err := os.Readlink(procPath(os.Getpid(), "ns/pid"))
	return err == nil && theirs != ours
}

// processHidden reports whether this process's /proc files are closed to its
// own user. PR_GET_DUMPABLE answers directly; where the platform refuses that
// too, the owner of the files does: the kernel hands them to root once the
// process is no longer dumpable.
func processHidden() bool {
	value, _, errno := syscall.Syscall(syscall.SYS_PRCTL, prGetDumpable, 0, 0)
	if errno == 0 {
		return value != suidDumpUser
	}
	var info syscall.Stat_t
	if err := syscall.Stat(procPath(os.Getpid(), "environ"), &info); err != nil {
		return false
	}
	return int(info.Uid) != os.Geteuid()
}

// interpreterReadable resolves the interpreter and reports whether this user
// can read it. One it cannot read is one exec marks non-dumpable, so the runner
// is hidden before any of its own code runs. A missing interpreter is not an
// exposure: every run then fails to start, which says so itself.
func interpreterReadable(python string) (string, bool) {
	path, err := exec.LookPath(python)
	if err != nil {
		return python, false
	}
	if resolved, err := filepath.EvalSymlinks(path); err == nil {
		path = resolved
	}
	return path, syscall.Access(path, 4 /* R_OK */) == nil
}

// readableCredentialHolder finds a process other than this one whose
// environment this user can read and which carries an ambient credential. The
// engine reads with the same user and no more privilege than a code block, so
// what it can open here a code block can open too.
func readableCredentialHolder() (int, string, bool) {
	self := os.Getpid()
	entries, err := os.ReadDir("/proc")
	if err != nil {
		return 0, "", false
	}
	for _, entry := range entries {
		pid, err := strconv.Atoi(entry.Name())
		if err != nil || pid == self {
			continue
		}
		raw, err := os.ReadFile(procPath(pid, "environ"))
		if err != nil {
			continue
		}
		if name, found := carriesAmbientCredential(raw, ambientCredentialVariables); found {
			return pid, name, true
		}
	}
	return 0, "", false
}

// carriesAmbientCredential reports the first of names set to a non-empty value
// in a NUL-separated environment block.
func carriesAmbientCredential(environ []byte, names []string) (string, bool) {
	for _, kv := range bytes.Split(environ, []byte{0}) {
		for _, name := range names {
			if bytes.HasPrefix(kv, []byte(name+"=")) && len(kv) > len(name)+1 {
				return name, true
			}
		}
	}
	return "", false
}
