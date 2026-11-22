// Package simconsole embeds the apps/sims Vite build (ADR-160): one page per
// simulator at dist/<page>/index.html, beside the assets the pages share.
package simconsole

import (
	"embed"
	"io/fs"
	"path"
)

// BuildCommand is what a not-built console tells a developer to run.
const BuildCommand = "pnpm --filter @langwatch/sims build"

// files is the build. Only dist/.gitkeep is committed, so a binary built
// before the bundle embeds no page and serves the not-built page instead.
//
//go:embed all:dist
var files embed.FS

// Page is one simulator's console: its own index.html at the root and every
// other file from the shared build, so each sim serves it at the URL it
// always has.
func Page(name string) fs.FS {
	dist, err := fs.Sub(files, "dist")
	if err != nil {
		panic(err) // the path is a constant that go:embed has already resolved
	}
	return page{dist: dist, index: path.Join(name, "index.html")}
}

type page struct {
	dist  fs.FS
	index string
}

func (p page) Open(name string) (fs.File, error) {
	if name == "index.html" {
		name = p.index
	}
	return p.dist.Open(name)
}
