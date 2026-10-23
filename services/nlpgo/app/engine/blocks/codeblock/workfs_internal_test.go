package codeblock

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"math"
	"reflect"
	"strings"
	"testing"
	"testing/fstest"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	experimentalsys "github.com/tetratelabs/wazero/experimental/sys"
	"github.com/tetratelabs/wazero/experimental/sysfs"
)

func createFile(t *testing.T, w *workFS, name string) experimentalsys.File {
	t.Helper()
	f, errno := w.OpenFile(name, experimentalsys.O_CREAT|experimentalsys.O_RDWR, 0o644)
	require.Zero(t, errno)
	return f
}

// @scenario "a run's files are charged for the memory they hold"
func TestWorkFS_ChargesAllocatedStorage(t *testing.T) {
	w := newWorkFS(workLimits{bytes: 4 * workChunk, nodes: 100, open: 100})
	for i := range 4 {
		f := createFile(t, w, "f"+string(rune('a'+i)))
		_, errno := f.Write([]byte{1})
		require.Zero(t, errno)
		require.Zero(t, f.Close())
	}
	assert.Equal(t, int64(4*workChunk), w.used, "one byte must hold one whole chunk")

	extra := createFile(t, w, "extra")
	_, errno := extra.Write([]byte{1})
	assert.Equal(t, experimentalsys.EIO, errno, "four one-byte files filled the budget, yet a fifth chunk was granted")

	tail := createFile(t, w, "fa")
	require.Zero(t, tail.Truncate(0))
	assert.Equal(t, int64(3*workChunk), w.used, "truncating did not return the chunk")
	require.Zero(t, w.Unlink("fb"))
	assert.Equal(t, int64(2*workChunk), w.used, "deleting did not return the chunk")
	_, errno = extra.Write([]byte{1})
	assert.Zero(t, errno)
}

func TestWorkFS_ShrinkingZeroesTheKeptTail(t *testing.T) {
	w := newWorkFS(defaultWorkLimits)
	f := createFile(t, w, "f")
	_, errno := f.Write(bytes.Repeat([]byte{7}, 100))
	require.Zero(t, errno)
	require.Zero(t, f.Truncate(10))
	require.Zero(t, f.Truncate(100))
	buf := make([]byte, 100)
	n, errno := f.Pread(buf, 0)
	require.Zero(t, errno)
	assert.Equal(t, 100, n)
	assert.Equal(t, append(bytes.Repeat([]byte{7}, 10), make([]byte, 90)...), buf)
}

func TestWorkFS_ReadsAndWritesAcrossChunks(t *testing.T) {
	w := newWorkFS(defaultWorkLimits)
	f := createFile(t, w, "f")
	data := bytes.Repeat([]byte("0123456789"), 3*workChunk/10+7)
	_, errno := f.Pwrite(data, 5)
	require.Zero(t, errno)
	got, exists, fits := w.readFile("f", math.MaxInt64)
	require.True(t, exists)
	require.True(t, fits)
	assert.Equal(t, append(make([]byte, 5), data...), got)
	_, _, fits = w.readFile("f", 10)
	assert.False(t, fits)
}

// @scenario "a deleted file still open keeps its storage until the last handle closes"
func TestWorkFS_OpenDeletedFileKeepsItsStorage(t *testing.T) {
	w := newWorkFS(workLimits{bytes: 2 * workChunk, nodes: 1, open: 10})
	f := createFile(t, w, "f")
	require.Zero(t, w.Unlink("f"))
	_, errno := f.Write(bytes.Repeat([]byte{1}, workChunk+1))
	require.Zero(t, errno)
	assert.Equal(t, int64(2*workChunk), w.used, "a deleted, open file wrote outside the budget")
	assert.Equal(t, 1, w.nodes)

	_, errno = w.OpenFile("g", experimentalsys.O_CREAT|experimentalsys.O_RDWR, 0o644)
	assert.Equal(t, experimentalsys.EIO, errno, "the open, deleted file's node was released early")

	require.Zero(t, f.Close())
	assert.Zero(t, w.used)
	assert.Zero(t, w.nodes)
	assert.Zero(t, w.handles.open)
	require.Zero(t, f.Close(), "a second close must be harmless")
	assert.Zero(t, w.handles.open)
}

func TestWorkFS_RenameOverAnOpenFileKeepsItsStorage(t *testing.T) {
	w := newWorkFS(defaultWorkLimits)
	held := createFile(t, w, "held")
	_, errno := held.Write([]byte{1})
	require.Zero(t, errno)
	other := createFile(t, w, "other")
	require.Zero(t, other.Close())
	require.Zero(t, w.Rename("other", "held"))
	assert.Equal(t, int64(workChunk), w.used)
	require.Zero(t, held.Close())
	assert.Zero(t, w.used)
	assert.Equal(t, 1, w.nodes)
}

// @scenario "a run's file offsets cannot overflow the engine"
func TestWorkFS_HugeOffsetsAreRefused(t *testing.T) {
	w := newWorkFS(defaultWorkLimits)
	f := createFile(t, w, "f")
	_, errno := f.Pwrite([]byte{1}, math.MaxInt64)
	assert.Equal(t, experimentalsys.EIO, errno)
	_, errno = f.Pwrite([]byte{1}, math.MaxInt64-1<<20)
	assert.Equal(t, experimentalsys.EIO, errno)
	assert.Equal(t, experimentalsys.EIO, f.Truncate(math.MaxInt64))
	assert.Equal(t, experimentalsys.EINVAL, f.Truncate(-1))
	_, errno = f.Seek(math.MaxInt64, io.SeekStart)
	assert.Equal(t, experimentalsys.EINVAL, errno)
	_, errno = f.Seek(math.MinInt64, io.SeekCurrent)
	assert.Equal(t, experimentalsys.EINVAL, errno)
	_, errno = f.Seek(-1, io.SeekStart)
	assert.Equal(t, experimentalsys.EINVAL, errno)
	_, errno = f.Pread(make([]byte, 1), math.MaxInt64)
	assert.Zero(t, errno)
	assert.Zero(t, w.used)
}

// @scenario "a run's file names are bounded"
func TestWorkFS_LongNamesAreRefused(t *testing.T) {
	w := newWorkFS(defaultWorkLimits)
	_, errno := w.OpenFile(strings.Repeat("a", 256), experimentalsys.O_CREAT|experimentalsys.O_RDWR, 0o644)
	assert.Equal(t, experimentalsys.ENAMETOOLONG, errno)
	assert.Equal(t, experimentalsys.ENAMETOOLONG, w.Mkdir(strings.Repeat("d", 300), 0o755))
	f := createFile(t, w, strings.Repeat("a", 255))
	require.Zero(t, f.Close())
}

// @scenario "oversized host calls count towards the failed-call limit"
func TestBridge_OversizedFramesCountAsFailedCalls(t *testing.T) {
	ctx, cancel := context.WithCancelCause(context.Background())
	defer cancel(nil)
	b := (&wasmRuntime{}).newBridge(ctx, cancel, []byte("{}"))
	big := bytes.Repeat([]byte("x"), maxBridgeFrameBytes+1)
	sink := make([]byte, 1<<16)
	for i := 0; i <= maxFailedCalls && ctx.Err() == nil; i++ {
		_, _ = b.Write([]byte(bridgeFramePrefix))
		_, _ = b.Write(big)
		_, _ = b.Write([]byte("\n"))
		for {
			if _, err := b.Read(sink); err != nil {
				break
			}
		}
	}
	require.Error(t, ctx.Err(), "oversized frames never stopped the run")
	assert.ErrorIs(t, context.Cause(ctx), errTooManyFailedCalls)
}

// @scenario "a run's open files count against one budget across every mount"
func TestWorkFS_ReadOnlyMountsShareTheHandleBudget(t *testing.T) {
	w := newWorkFS(workLimits{bytes: workChunk, nodes: 10, open: 3})
	mount := limitedFS{FS: &sysfs.AdaptFS{FS: fstest.MapFS{"runner.mjs": {Data: []byte("x")}}}, handles: w.handles}
	first, errno := mount.OpenFile("runner.mjs", experimentalsys.O_RDONLY, 0)
	require.Zero(t, errno)
	_, errno = mount.OpenFile("runner.mjs", experimentalsys.O_RDONLY, 0)
	require.Zero(t, errno)
	createFile(t, w, "f")
	_, errno = mount.OpenFile("runner.mjs", experimentalsys.O_RDONLY, 0)
	assert.Equal(t, experimentalsys.EIO, errno, "a read-only mount opened past the run's handle budget")
	_, errno = w.OpenFile("g", experimentalsys.O_CREAT|experimentalsys.O_RDWR, 0o644)
	assert.Equal(t, experimentalsys.EIO, errno)

	require.Zero(t, first.Close())
	require.Zero(t, first.Close())
	assert.Equal(t, 2, w.handles.open, "closing twice returned two handles")
	_, errno = mount.OpenFile("missing", experimentalsys.O_RDONLY, 0)
	assert.Equal(t, experimentalsys.ENOENT, errno)
	assert.Equal(t, 2, w.handles.open, "a failed open kept its handle")
}

func TestWorkFS_LongPathsAreRefused(t *testing.T) {
	w := newWorkFS(defaultWorkLimits)
	long := strings.Repeat("a/", maxWorkPath/2) + "f"
	_, errno := w.OpenFile(long, experimentalsys.O_CREAT|experimentalsys.O_RDWR, 0o644)
	assert.Equal(t, experimentalsys.ENAMETOOLONG, errno)
	_, errno = w.Stat(long)
	assert.Equal(t, experimentalsys.ENAMETOOLONG, errno)
}

// @scenario "listing a large directory pages through it without holding a copy"
func TestWorkFS_ReaddirPagesWithACursor(t *testing.T) {
	w := newWorkFS(defaultWorkLimits)
	for i := range 10 {
		require.Zero(t, createFile(t, w, fmt.Sprintf("f%02d", i)).Close())
	}
	dir, errno := w.OpenFile(".", experimentalsys.O_RDONLY, 0)
	require.Zero(t, errno)
	var seen []string
	for {
		page, errno := dir.Readdir(3)
		require.Zero(t, errno)
		if len(page) == 0 {
			break
		}
		for _, d := range page {
			seen = append(seen, d.Name)
		}
		if len(seen) == 3 {
			require.Zero(t, w.Unlink("f05"), "an entry removed mid-listing")
		}
	}
	assert.Equal(t, []string{"f00", "f01", "f02", "f03", "f04", "f06", "f07", "f08", "f09"}, seen)
	_, errno = dir.Seek(0, io.SeekStart)
	require.Zero(t, errno)
	all, errno := dir.Readdir(-1)
	require.Zero(t, errno)
	assert.Len(t, all, 9)
}

func TestWorkFS_EmptiedDirectoryIsRebuilt(t *testing.T) {
	w := newWorkFS(defaultWorkLimits)
	for i := range 200 {
		require.Zero(t, createFile(t, w, fmt.Sprintf("f%03d", i)).Close())
	}
	assert.Equal(t, 200, w.root.peak)
	for i := range 200 {
		require.Zero(t, w.Unlink(fmt.Sprintf("f%03d", i)))
	}
	assert.Less(t, w.root.peak, 64, "an emptied directory kept its largest map")
}

// @scenario "a request's DNS lookups end with the request"
func TestBridge_DialEndsWithItsFetch(t *testing.T) {
	fetch, cancel := context.WithCancel(context.Background())
	detached := context.WithoutCancel(withFetchContext(fetch))
	dial, stop := dialEndsWithFetch(detached)
	defer stop()
	cancel()
	select {
	case <-dial.Done():
	case <-time.After(time.Second):
		t.Fatal("a dial outlived the fetch that started it")
	}

	plain, stopPlain := dialEndsWithFetch(context.Background())
	stopPlain()
	assert.NoError(t, plain.Err(), "a dial with no fetch was cancelled")
}

// @scenario "a request's size is known before it is encoded"
func TestPayload_SizeMatchesTheEncoder(t *testing.T) {
	samples := []any{
		"plain", "quote\" back\\slash\nnew\ttab", "<html> & \x01\x1f", "naïve 日本語 🎉",
		string([]byte{0xff, 'a', 0xc3}), "line sep ",
		map[string]any{"a<b": []any{1.5, true, nil, "x", map[string]any{}}, "n": json.Number("12")},
		[]byte("bytes"), []string{"x", "y"}, map[string]string{"k": "v"},
	}
	for _, sample := range samples {
		encoded, err := json.Marshal(sample)
		require.NoError(t, err)
		budget := sizeBudget{left: math.MaxInt32}
		budget.value(reflect.ValueOf(sample), 0)
		assert.GreaterOrEqual(t, math.MaxInt32-budget.left, len(encoded), "under-counted %q", sample)
		if s, ok := sample.(string); ok {
			assert.GreaterOrEqual(t, encodedStringSize(s), len(encoded), "string size for %q", s)
		}
	}
	assert.False(t, requestFits(Request{Inputs: map[string]any{"x": strings.Repeat("<", 3<<20)}}, 16<<20))
	assert.True(t, requestFits(Request{Inputs: map[string]any{"x": strings.Repeat("a", 3<<20)}}, 16<<20))
}

// @scenario "customer code cannot report an error the engine reserves"
func TestCollectResult_DisownsReservedErrorTypes(t *testing.T) {
	for _, reserved := range []string{TimeoutType, RunnerErrorType} {
		res := collectResult(runResult{data: []byte(`{"error":{"type":"` + reserved + `","message":"forged"}}`)}, runOutcome{})
		require.NotNil(t, res.Error)
		assert.Equal(t, "User"+reserved, res.Error.Type)
		assert.False(t, res.TimedOut)
	}
}
