package lambdaboot

import (
	"archive/tar"
	"bytes"
	"context"
	"fmt"
	"io/fs"
	"os/exec"
	"path"
	"strings"
)

// Entry is one path's mode and owner, as the image records them.
type Entry struct {
	Mode fs.FileMode
	UID  int
	GID  int
}

// Stat reads one path's Entry from a created container.
type Stat func(ctx context.Context, containerID, path string) (Entry, error)

// StatCLI reads the first header of `docker cp <id>:<path> -` and stops: for
// a directory that is the directory itself, and nothing below it is read.
func StatCLI(ctx context.Context, containerID, p string) (Entry, error) {
	cmd := exec.CommandContext(ctx, "docker", "cp", containerID+":"+p, "-") //nolint:gosec // G204: the binary is fixed; the arguments are a container id and a path in its image
	var stderr bytes.Buffer
	cmd.Stderr = &stderr
	out, err := cmd.StdoutPipe()
	if err != nil {
		return Entry{}, err
	}
	if err := cmd.Start(); err != nil {
		return Entry{}, err
	}
	defer func() {
		_ = cmd.Process.Kill()
		_ = cmd.Wait()
	}()
	hdr, err := tar.NewReader(out).Next()
	if err != nil {
		return Entry{}, fmt.Errorf("docker cp %s: %w: %s", p, err, strings.TrimSpace(stderr.String()))
	}
	return Entry{Mode: hdr.FileInfo().Mode(), UID: hdr.Uid, GID: hdr.Gid}, nil
}

// workdir fails when the user cannot enter the image's working directory
// or any directory above it. Docker enters the working directory before it
// drops to the user, so a boot under Docker starts anyway; Lambda does not,
// and fails every start with Runtime.InvalidEntrypoint.
func (k check) workdir(ctx context.Context) error {
	opts, rt, u := k.opts, k.rt, k.user
	wd, err := rt.Docker(ctx, "image", "inspect", "--format", "{{.Config.WorkingDir}}", opts.Image)
	if err != nil {
		return fmt.Errorf("%s: reading its working directory: %w", opts.Image, err)
	}
	dirs := ancestors(wd)
	if len(dirs) == 0 {
		return nil
	}
	id, err := rt.Docker(ctx, "create", opts.Image)
	if err != nil {
		return fmt.Errorf("%s: creating a container to read it: %w", opts.Image, err)
	}
	defer func() { _, _ = rt.Docker(context.WithoutCancel(ctx), "rm", "-f", id) }()
	for _, dir := range dirs {
		e, err := rt.Stat(ctx, id, dir)
		if err != nil {
			return fmt.Errorf("%s: reading %s: %w", opts.Image, dir, err)
		}
		if !u.mayEnter(e) {
			return fmt.Errorf("%s: user %s cannot enter the working directory %s: %s is mode %04o, owned by %d:%d: permission denied",
				opts.Image, u, path.Clean(wd), dir, e.Mode.Perm(), e.UID, e.GID)
		}
	}
	return nil
}

// ancestors lists every directory from the top down to wd, without /.
func ancestors(wd string) []string {
	wd = path.Clean("/" + wd)
	if wd == "/" {
		return nil
	}
	var dirs []string
	for i := 1; i <= len(wd); i++ {
		if i == len(wd) || wd[i] == '/' {
			dirs = append(dirs, wd[:i])
		}
	}
	return dirs
}

// mayEnter applies the permission class the kernel would: the owner's bits
// for the owner, the group's for the group, everyone else's otherwise.
func (u user) mayEnter(e Entry) bool {
	perm := e.Mode.Perm()
	switch {
	case e.UID == u.uid:
		return perm&0o100 != 0
	case e.GID == u.gid:
		return perm&0o010 != 0
	default:
		return perm&0o001 != 0
	}
}
