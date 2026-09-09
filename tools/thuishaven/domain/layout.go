package domain

// Layout is the source shape of a checkout: which packages it has, and so
// which processes a stack of it is made of. This branch is modular (apps/ui +
// apps/api, two Node lanes); origin/main is the monolith (platform/app, one
// Node process for both). apidiff and visualdiff boot a base ref as its own
// haven stack, so haven starts what the checkout defines, not this worktree.
type Layout string

const (
	// LayoutModular is apps/ui + apps/api: the ui and backend lanes.
	LayoutModular Layout = "modular"
	// LayoutMonolith is platform/app: one Node lane, named app.
	LayoutMonolith Layout = "monolith"
)

// The directories that tell the two layouts apart. A checkout is modular when
// BOTH application packages are there, because a half-renamed tree is not a
// stack haven can start either way.
const (
	// ModularUIDir and ModularAPIDir are the two application packages.
	ModularUIDir  = "apps/ui"
	ModularAPIDir = "apps/api"
	// MonolithDir is the single package that serves the UI and the API.
	MonolithDir = "platform/app"
)

// MonolithAppLane is the one Node lane a monolith checkout runs, named after
// the routed `app` hostname: one process sits behind it, so `haven logs app`
// and `haven restart app` name the thing a person can actually see.
const MonolithAppLane = "app"

// MonolithPackage is the workspace package a monolith checkout serves from.
// haven runs its scripts: `dev:app` for the lane, and `start:prepare:db` for
// the migration job, which that checkout's workspace root does not define.
const MonolithPackage = "@langwatch/web"

// DetectLayout resolves a checkout's layout from the directories it has.
// `exists` answers for a path relative to the checkout root, so the decision
// is testable without a tree on disk. Neither shape reads as modular: a
// checkout haven cannot recognize fails on its own lane's error rather than
// on a guess made here.
func DetectLayout(exists func(rel string) bool) Layout {
	if exists(ModularUIDir) && exists(ModularAPIDir) {
		return LayoutModular
	}
	if exists(MonolithDir) {
		return LayoutMonolith
	}
	return LayoutModular
}

// IsMonolith reports whether this layout runs the single app lane. The zero
// value is a stack recorded before layouts existed, which was always modular.
func (l Layout) IsMonolith() bool { return l == LayoutMonolith }

// OrModular is the layout with the zero value resolved, for reporting.
func (l Layout) OrModular() Layout {
	if l.IsMonolith() {
		return LayoutMonolith
	}
	return LayoutModular
}
