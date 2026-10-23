package codeblock

import (
	"io"
	"io/fs"
	"path"
	"sort"
	"strings"
	"sync"
	"time"

	experimentalsys "github.com/tetratelabs/wazero/experimental/sys"
	"github.com/tetratelabs/wazero/sys"
)

// workLimits bound one run's /work: bytes held, files and directories, and
// handles open at once. Past a limit the guest gets EIO, as from a full disk.
type workLimits struct {
	bytes int64
	nodes int
	open  int
}

var defaultWorkLimits = workLimits{bytes: 64 << 20, nodes: 4096, open: 256}

// workChunk is the unit /work stores and accounts: every chunk is allocated at
// exactly this size, so what the budget counts is what the engine holds.
const workChunk = 64 << 10

// maxWorkName bounds one path component, so names cannot outgrow the budget.
const maxWorkName = 255

// workFS is a run's /work: in engine memory, never on the host disk, with no
// links of any kind, so no path a guest builds can resolve outside it. The run
// reads its result from here too, so the engine never opens a guest-made path.
// One mutex guards the tree and every handle; a guest has a single thread.
type workFS struct {
	experimentalsys.UnimplementedFS

	mu      sync.Mutex
	root    *workNode
	limits  workLimits
	used    int64
	nodes   int
	open    int
	nextIno uint64
}

// workNode is a file or directory. It is released, and its bytes returned to
// the budget, only once it is neither in the tree nor open.
type workNode struct {
	ino      uint64
	dir      bool
	mode     fs.FileMode
	size     int64
	chunks   [][]byte
	children map[string]*workNode
	mtim     int64
	linked   bool
	handles  int
}

func newWorkFS(limits workLimits) *workFS {
	w := &workFS{limits: limits}
	w.root = w.newNode(true, 0o755)
	w.root.linked = true
	return w
}

func (w *workFS) newNode(dir bool, perm fs.FileMode) *workNode {
	w.nextIno++
	node := &workNode{ino: w.nextIno, dir: dir, mode: perm & fs.ModePerm, mtim: time.Now().UnixNano()}
	if dir {
		node.children = map[string]*workNode{}
	}
	return node
}

// split cleans a guest path against the mount root; ".." can never climb past it.
func split(p string) []string {
	cleaned := path.Clean("/" + p)
	if cleaned == "/" {
		return nil
	}
	return strings.Split(cleaned[1:], "/")
}

func (w *workFS) lookup(p string) (*workNode, experimentalsys.Errno) {
	node := w.root
	for _, part := range split(p) {
		if !node.dir {
			return nil, experimentalsys.ENOTDIR
		}
		child, ok := node.children[part]
		if !ok {
			return nil, experimentalsys.ENOENT
		}
		node = child
	}
	return node, 0
}

// parent resolves the directory holding p and p's own name.
func (w *workFS) parent(p string) (*workNode, string, experimentalsys.Errno) {
	parts := split(p)
	if len(parts) == 0 {
		return nil, "", experimentalsys.EINVAL
	}
	name := parts[len(parts)-1]
	if len(name) > maxWorkName {
		return nil, "", experimentalsys.ENAMETOOLONG
	}
	dir, errno := w.lookup(strings.Join(parts[:len(parts)-1], "/"))
	if errno != 0 {
		return nil, "", errno
	}
	if !dir.dir {
		return nil, "", experimentalsys.ENOTDIR
	}
	return dir, name, 0
}

func (w *workFS) addNode(dir *workNode, name string, node *workNode) experimentalsys.Errno {
	if w.nodes >= w.limits.nodes {
		return experimentalsys.EIO
	}
	w.nodes++
	node.linked = true
	dir.children[name] = node
	dir.mtim = time.Now().UnixNano()
	return 0
}

// unlink takes node out of the tree; it is released once no handle holds it.
func (w *workFS) unlink(dir *workNode, name string, node *workNode) {
	delete(dir.children, name)
	node.linked = false
	w.releaseIfUnused(node)
}

func (w *workFS) releaseIfUnused(node *workNode) {
	if node.linked || node.handles > 0 {
		return
	}
	w.nodes--
	w.used -= int64(len(node.chunks)) * workChunk
	node.chunks, node.size = nil, 0
}

func (w *workFS) OpenFile(p string, flag experimentalsys.Oflag, perm fs.FileMode) (experimentalsys.File, experimentalsys.Errno) {
	w.mu.Lock()
	defer w.mu.Unlock()
	if w.open >= w.limits.open {
		return nil, experimentalsys.EIO
	}
	node, errno := w.openNode(p, flag, perm)
	if errno != 0 {
		return nil, errno
	}
	access := flag & (experimentalsys.O_RDONLY | experimentalsys.O_RDWR | experimentalsys.O_WRONLY)
	writable := access == experimentalsys.O_RDWR || access == experimentalsys.O_WRONLY
	if node.dir && writable {
		return nil, experimentalsys.EISDIR
	}
	if !node.dir && flag&experimentalsys.O_DIRECTORY != 0 {
		return nil, experimentalsys.ENOTDIR
	}
	if writable && flag&experimentalsys.O_TRUNC != 0 {
		_ = w.resize(node, 0) // shrinking never fails
	}
	w.open++
	node.handles++
	return &workFile{fs: w, node: node, readable: access != experimentalsys.O_WRONLY, writable: writable,
		appendMode: flag&experimentalsys.O_APPEND != 0}, 0
}

// openNode finds p, creating it when flag asks to. Callers hold mu.
func (w *workFS) openNode(p string, flag experimentalsys.Oflag, perm fs.FileMode) (*workNode, experimentalsys.Errno) {
	node, errno := w.lookup(p)
	create := flag&experimentalsys.O_CREAT != 0
	switch {
	case errno == experimentalsys.ENOENT && create:
		dir, name, perr := w.parent(p)
		if perr != 0 {
			return nil, perr
		}
		node = w.newNode(false, perm)
		return node, w.addNode(dir, name, node)
	case errno != 0:
		return nil, errno
	case create && flag&experimentalsys.O_EXCL != 0:
		return nil, experimentalsys.EEXIST
	}
	return node, 0
}

func (w *workFS) Stat(p string) (sys.Stat_t, experimentalsys.Errno) {
	w.mu.Lock()
	defer w.mu.Unlock()
	node, errno := w.lookup(p)
	if errno != 0 {
		return sys.Stat_t{}, errno
	}
	return node.stat(), 0
}

func (w *workFS) Lstat(p string) (sys.Stat_t, experimentalsys.Errno) { return w.Stat(p) }

func (w *workFS) Mkdir(p string, perm fs.FileMode) experimentalsys.Errno {
	w.mu.Lock()
	defer w.mu.Unlock()
	dir, name, errno := w.parent(p)
	if errno != 0 {
		return errno
	}
	if _, exists := dir.children[name]; exists {
		return experimentalsys.EEXIST
	}
	return w.addNode(dir, name, w.newNode(true, perm))
}

func (w *workFS) Chmod(p string, perm fs.FileMode) experimentalsys.Errno {
	w.mu.Lock()
	defer w.mu.Unlock()
	node, errno := w.lookup(p)
	if errno == 0 {
		node.mode = perm & fs.ModePerm
	}
	return errno
}

func (w *workFS) Rename(from, to string) experimentalsys.Errno {
	w.mu.Lock()
	defer w.mu.Unlock()
	fromDir, fromName, errno := w.parent(from)
	if errno != 0 {
		return errno
	}
	node, ok := fromDir.children[fromName]
	if !ok {
		return experimentalsys.ENOENT
	}
	toDir, toName, errno := w.parent(to)
	if errno != 0 {
		return errno
	}
	if node.dir && isWithin(toDir, node) {
		return experimentalsys.EINVAL
	}
	if existing, ok := toDir.children[toName]; ok {
		if existing == node {
			return 0
		}
		if errno := replaceable(existing, node); errno != 0 {
			return errno
		}
		w.unlink(toDir, toName, existing)
	}
	delete(fromDir.children, fromName)
	toDir.children[toName] = node
	return 0
}

// replaceable reports whether a rename of node may replace existing.
func replaceable(existing, node *workNode) experimentalsys.Errno {
	switch {
	case existing.dir && !node.dir:
		return experimentalsys.EISDIR
	case !existing.dir && node.dir:
		return experimentalsys.ENOTDIR
	case existing.dir && len(existing.children) > 0:
		return experimentalsys.ENOTEMPTY
	}
	return 0
}

// isWithin reports whether dir is node or lies beneath it.
func isWithin(dir, node *workNode) bool {
	if dir == node {
		return true
	}
	for _, child := range node.children {
		if child.dir && isWithin(dir, child) {
			return true
		}
	}
	return false
}

func (w *workFS) Rmdir(p string) experimentalsys.Errno {
	w.mu.Lock()
	defer w.mu.Unlock()
	dir, name, errno := w.parent(p)
	if errno != 0 {
		return errno
	}
	node, ok := dir.children[name]
	switch {
	case !ok:
		return experimentalsys.ENOENT
	case !node.dir:
		return experimentalsys.ENOTDIR
	case len(node.children) > 0:
		return experimentalsys.ENOTEMPTY
	}
	w.unlink(dir, name, node)
	return 0
}

func (w *workFS) Unlink(p string) experimentalsys.Errno {
	w.mu.Lock()
	defer w.mu.Unlock()
	dir, name, errno := w.parent(p)
	if errno != 0 {
		return errno
	}
	node, ok := dir.children[name]
	switch {
	case !ok:
		return experimentalsys.ENOENT
	case node.dir:
		return experimentalsys.EISDIR
	}
	w.unlink(dir, name, node)
	return 0
}

// Link and Symlink are refused: /work has no links, so nothing can point out of it.
func (w *workFS) Link(_, _ string) experimentalsys.Errno    { return experimentalsys.EPERM }
func (w *workFS) Symlink(_, _ string) experimentalsys.Errno { return experimentalsys.EPERM }

func (w *workFS) Readlink(p string) (string, experimentalsys.Errno) {
	if _, errno := w.Stat(p); errno != 0 {
		return "", errno
	}
	return "", experimentalsys.EINVAL
}

func (w *workFS) Utimens(p string, _, mtim int64) experimentalsys.Errno {
	w.mu.Lock()
	defer w.mu.Unlock()
	node, errno := w.lookup(p)
	if errno == 0 && mtim >= 0 {
		node.mtim = mtim
	}
	return errno
}

// readFile returns a regular file's content up to limit bytes, and whether it
// exists and fits. The size is checked before anything is copied.
func (w *workFS) readFile(p string, limit int64) (data []byte, exists, fits bool) {
	w.mu.Lock()
	defer w.mu.Unlock()
	node, errno := w.lookup(p)
	if errno != 0 || node.dir {
		return nil, false, false
	}
	if node.size > limit {
		return nil, true, false
	}
	data = make([]byte, node.size)
	node.readAt(data, 0)
	return data, true, true
}

// resize sets node's size within the budget, allocating or freeing whole
// chunks. Bytes past the new end of a kept chunk are zeroed. Callers hold mu.
func (w *workFS) resize(node *workNode, size int64) experimentalsys.Errno {
	if size < 0 || size > w.limits.bytes {
		return experimentalsys.EIO
	}
	want := int((size + workChunk - 1) / workChunk)
	if errno := w.growChunks(node, want); errno != 0 {
		return errno
	}
	w.shrinkChunks(node, want)
	if size < node.size && want > 0 {
		clear(node.chunks[want-1][size-int64(want-1)*workChunk:])
	}
	node.size = size
	return 0
}

func (w *workFS) growChunks(node *workNode, want int) experimentalsys.Errno {
	have := len(node.chunks)
	if want <= have {
		return 0
	}
	if w.used+int64(want-have)*workChunk > w.limits.bytes {
		return experimentalsys.EIO
	}
	for range want - have {
		node.chunks = append(node.chunks, make([]byte, workChunk))
	}
	w.used += int64(want-have) * workChunk
	return 0
}

// shrinkChunks drops chunks past want, copying the slice so none stay reachable.
func (w *workFS) shrinkChunks(node *workNode, want int) {
	have := len(node.chunks)
	if want >= have {
		return
	}
	node.chunks = append([][]byte(nil), node.chunks[:want]...)
	w.used -= int64(have-want) * workChunk
}

func (n *workNode) readAt(buf []byte, off int64) int {
	if off >= n.size {
		return 0
	}
	end := min(off+int64(len(buf)), n.size)
	read := 0
	for pos := off; pos < end; {
		chunk, within := pos/workChunk, pos%workChunk
		copied := copy(buf[read:end-off], n.chunks[chunk][within:])
		read += copied
		pos += int64(copied)
	}
	return read
}

func (n *workNode) writeAt(buf []byte, off int64) {
	written := 0
	for written < len(buf) {
		pos := off + int64(written)
		chunk, within := pos/workChunk, pos%workChunk
		written += copy(n.chunks[chunk][within:], buf[written:])
	}
}

func (n *workNode) stat() sys.Stat_t {
	mode := n.mode
	nlink := uint64(1)
	if n.dir {
		mode |= fs.ModeDir
		nlink = 2
	}
	return sys.Stat_t{Ino: n.ino, Mode: mode, Nlink: nlink, Size: n.size, Atim: n.mtim, Mtim: n.mtim, Ctim: n.mtim}
}

// workFile is one open handle on a workFS node. Its state is guarded by the
// filesystem's mutex, like the tree.
type workFile struct {
	experimentalsys.UnimplementedFile

	fs         *workFS
	node       *workNode
	offset     int64
	readable   bool
	writable   bool
	appendMode bool
	closed     bool
	dirents    []experimentalsys.Dirent
	listed     bool
}

func (f *workFile) Ino() (sys.Inode, experimentalsys.Errno) { return f.node.ino, 0 }
func (f *workFile) IsDir() (bool, experimentalsys.Errno)    { return f.node.dir, 0 }
func (f *workFile) IsNonblock() bool                        { return false }
func (f *workFile) Sync() experimentalsys.Errno             { return 0 }
func (f *workFile) Datasync() experimentalsys.Errno         { return 0 }

func (f *workFile) IsAppend() bool {
	f.fs.mu.Lock()
	defer f.fs.mu.Unlock()
	return f.appendMode
}

func (f *workFile) SetAppend(enable bool) experimentalsys.Errno {
	f.fs.mu.Lock()
	defer f.fs.mu.Unlock()
	f.appendMode = enable
	return 0
}

func (f *workFile) SetNonblock(bool) experimentalsys.Errno { return 0 }

func (f *workFile) Stat() (sys.Stat_t, experimentalsys.Errno) {
	f.fs.mu.Lock()
	defer f.fs.mu.Unlock()
	return f.node.stat(), 0
}

func (f *workFile) Read(buf []byte) (int, experimentalsys.Errno) {
	f.fs.mu.Lock()
	defer f.fs.mu.Unlock()
	n, errno := f.pread(buf, f.offset)
	f.offset += int64(n)
	return n, errno
}

func (f *workFile) Pread(buf []byte, off int64) (int, experimentalsys.Errno) {
	f.fs.mu.Lock()
	defer f.fs.mu.Unlock()
	return f.pread(buf, off)
}

func (f *workFile) pread(buf []byte, off int64) (int, experimentalsys.Errno) {
	switch {
	case f.node.dir:
		return 0, experimentalsys.EISDIR
	case !f.readable:
		return 0, experimentalsys.EBADF
	case off < 0:
		return 0, experimentalsys.EINVAL
	}
	return f.node.readAt(buf, off), 0
}

//nolint:govet // stdmethods: wazero's experimental sys.File fixes this signature.
func (f *workFile) Seek(offset int64, whence int) (int64, experimentalsys.Errno) {
	f.fs.mu.Lock()
	defer f.fs.mu.Unlock()
	var base int64
	switch whence {
	case io.SeekStart:
	case io.SeekCurrent:
		base = f.offset
	case io.SeekEnd:
		base = f.node.size
	default:
		return 0, experimentalsys.EINVAL
	}
	// Offsets past the byte budget can never be written, so refusing them
	// keeps every later sum far from overflow.
	if offset < -base || offset > f.fs.limits.bytes-base {
		return 0, experimentalsys.EINVAL
	}
	next := base + offset
	if f.node.dir && next == 0 {
		f.dirents, f.listed = nil, false
	}
	f.offset = next
	return next, 0
}

func (f *workFile) Write(buf []byte) (int, experimentalsys.Errno) {
	f.fs.mu.Lock()
	defer f.fs.mu.Unlock()
	off := f.offset
	if f.appendMode {
		off = f.node.size
	}
	n, errno := f.pwrite(buf, off)
	f.offset = off + int64(n)
	return n, errno
}

func (f *workFile) Pwrite(buf []byte, off int64) (int, experimentalsys.Errno) {
	f.fs.mu.Lock()
	defer f.fs.mu.Unlock()
	return f.pwrite(buf, off)
}

func (f *workFile) pwrite(buf []byte, off int64) (int, experimentalsys.Errno) {
	switch {
	case f.node.dir:
		return 0, experimentalsys.EISDIR
	case !f.writable:
		return 0, experimentalsys.EBADF
	case off < 0:
		return 0, experimentalsys.EINVAL
	case off > f.fs.limits.bytes || int64(len(buf)) > f.fs.limits.bytes-off:
		return 0, experimentalsys.EIO
	}
	if end := off + int64(len(buf)); end > f.node.size {
		if errno := f.fs.resize(f.node, end); errno != 0 {
			return 0, errno
		}
	}
	f.node.writeAt(buf, off)
	f.node.mtim = time.Now().UnixNano()
	return len(buf), 0
}

func (f *workFile) Truncate(size int64) experimentalsys.Errno {
	f.fs.mu.Lock()
	defer f.fs.mu.Unlock()
	switch {
	case f.node.dir:
		return experimentalsys.EISDIR
	case !f.writable:
		return experimentalsys.EBADF
	case size < 0:
		return experimentalsys.EINVAL
	}
	return f.fs.resize(f.node, size)
}

func (f *workFile) Utimens(_, mtim int64) experimentalsys.Errno {
	f.fs.mu.Lock()
	defer f.fs.mu.Unlock()
	if mtim >= 0 {
		f.node.mtim = mtim
	}
	return 0
}

func (f *workFile) Readdir(n int) ([]experimentalsys.Dirent, experimentalsys.Errno) {
	f.fs.mu.Lock()
	defer f.fs.mu.Unlock()
	if !f.node.dir {
		return nil, experimentalsys.ENOTDIR
	}
	if !f.listed {
		f.dirents, f.listed = f.list(), true
	}
	if n <= 0 || n > len(f.dirents) {
		n = len(f.dirents)
	}
	out := f.dirents[:n]
	f.dirents = f.dirents[n:]
	return out, 0
}

// list snapshots the directory's entries in name order. Callers hold mu.
func (f *workFile) list() []experimentalsys.Dirent {
	names := make([]string, 0, len(f.node.children))
	for name := range f.node.children {
		names = append(names, name)
	}
	sort.Strings(names)
	dirents := make([]experimentalsys.Dirent, 0, len(names))
	for _, name := range names {
		child := f.node.children[name]
		var kind fs.FileMode
		if child.dir {
			kind = fs.ModeDir
		}
		dirents = append(dirents, experimentalsys.Dirent{Ino: child.ino, Name: name, Type: kind})
	}
	return dirents
}

func (f *workFile) Close() experimentalsys.Errno {
	f.fs.mu.Lock()
	defer f.fs.mu.Unlock()
	if f.closed {
		return 0
	}
	f.closed = true
	f.fs.open--
	f.node.handles--
	f.fs.releaseIfUnused(f.node)
	return 0
}
