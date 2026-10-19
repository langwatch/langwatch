package app

import (
	"fmt"
	"strings"
)

// FocusedSlug is the stack the developer is working in: the one persisted by
// `haven up`, `haven switch` or `haven focus`. Heartbeats never move it. A
// focus whose stack is gone reads as none and is cleared, so it stays none
// until one of those events sets it again.
func (o *Orchestrator) FocusedSlug() string {
	slug := o.store.ReadFocus()
	if slug == "" {
		return ""
	}
	if _, ok := o.stackBySlug(slug); ok {
		return slug
	}
	_ = o.store.WriteFocus("")
	return ""
}

// SetFocus makes a registered stack the focused one. A unique prefix of a slug
// is enough.
func (o *Orchestrator) SetFocus(query string) (string, error) {
	var hits []string
	for _, st := range o.store.Stacks() {
		if st.Slug == query {
			hits = []string{st.Slug}
			break
		}
		if strings.HasPrefix(st.Slug, query) {
			hits = append(hits, st.Slug)
		}
	}
	switch len(hits) {
	case 0:
		return "", fmt.Errorf("no registered stack matches %q (haven status lists them)", query)
	case 1:
		return hits[0], o.store.WriteFocus(hits[0])
	}
	return "", fmt.Errorf("%q matches several stacks: %s", query, strings.Join(hits, ", "))
}

// focusWorktree focuses the stack registered for dir, if there is one.
func (o *Orchestrator) focusWorktree(dir string) {
	for _, st := range o.store.Stacks() {
		if canonicalPath(st.WorktreeDir) == canonicalPath(dir) {
			_ = o.store.WriteFocus(st.Slug)
			return
		}
	}
}

// FocusWorktree is what `haven switch` calls once it has chosen a directory.
func (o *Orchestrator) FocusWorktree(dir string) { o.focusWorktree(dir) }
