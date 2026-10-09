package cmd

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"slices"
	"strings"
	"time"

	"github.com/langwatch/langwatch/tools/thuishaven/adapters/orbstore"
)

const (
	feedbackUsage = "usage: haven feedback <list [--open]|show <id>|resolve <id>|wait [--timeout <dur>]> [--json]"
	pageUsage     = "usage: haven page <console [--level <level>]|network [--failed]> [--json]"
	// orbPollEvery is how often `feedback wait` re-reads the store.
	orbPollEvery   = 250 * time.Millisecond
	orbWaitDefault = 30 * time.Second
)

// orbCLI is one `haven feedback` or `haven page` call over a stack's orb store.
type orbCLI struct {
	store  orbstore.Store
	inv    invocation
	asJSON bool
	out    io.Writer
}

// runFeedback is `haven feedback <list|show|resolve|wait>`: notes readers sent from the orb.
func runFeedback(ctx context.Context, d deps, inv invocation) error {
	c, err := newOrbCLI(d, inv)
	if err != nil {
		return err
	}
	return feedbackCommand(ctx, c)
}

// runPage is `haven page <console|network>`: the app page's buffer as the orb last pushed it.
func runPage(_ context.Context, d deps, inv invocation) error {
	c, err := newOrbCLI(d, inv)
	if err != nil {
		return err
	}
	return pageCommand(c)
}

func newOrbCLI(d deps, inv invocation) (orbCLI, error) {
	slug, err := tabSlug(d, inv)
	if err != nil {
		return orbCLI{}, err
	}
	return orbCLI{
		store:  orbstore.At(d.orch.LogDir(slug)),
		inv:    inv,
		asJSON: inv.has("--json") || d.isAgent,
		out:    os.Stdout,
	}, nil
}

func (c orbCLI) arg(i int) string {
	if i >= len(c.inv.args) {
		return ""
	}
	return c.inv.args[i]
}

func feedbackCommand(ctx context.Context, c orbCLI) error {
	switch c.arg(0) {
	case "list":
		return feedbackList(c)
	case "show":
		return feedbackShow(c)
	case "resolve":
		return feedbackResolve(c)
	case "wait":
		return feedbackWait(ctx, c)
	}
	return errors.New(feedbackUsage)
}

func feedbackList(c orbCLI) error {
	items, err := c.store.List()
	if err != nil {
		return err
	}
	if c.inv.has("--open") {
		items = slices.DeleteFunc(items, func(f orbstore.Feedback) bool { return !f.Open() })
	}
	return c.printFeedback(items)
}

func feedbackShow(c orbCLI) error {
	if c.arg(1) == "" {
		return errors.New(feedbackUsage)
	}
	item, err := c.store.Get(c.arg(1))
	if err != nil {
		return err
	}
	return c.printJSON(item)
}

func feedbackResolve(c orbCLI) error {
	if c.arg(1) == "" {
		return errors.New(feedbackUsage)
	}
	item, err := c.store.Resolve(c.arg(1), time.Now())
	if err != nil {
		return err
	}
	if c.asJSON {
		return c.printJSON(map[string]string{"resolved": item.ID})
	}
	_, err = fmt.Fprintf(c.out, "resolved %s\n", item.ID)
	return err
}

// feedbackWait blocks until feedback arrives that was not there when it started.
func feedbackWait(ctx context.Context, c orbCLI) error {
	timeout, err := orbTimeout(c.inv)
	if err != nil {
		return err
	}
	ctx, cancel := context.WithTimeout(ctx, timeout)
	defer cancel()
	fresh, err := c.awaitFeedback(ctx)
	if errors.Is(err, context.DeadlineExceeded) {
		return fmt.Errorf("no new feedback within %s", timeout)
	}
	if err != nil {
		return err
	}
	return c.printFeedback(fresh)
}

// awaitFeedback polls the store; ids grow with arrival, so newer means a larger id.
func (c orbCLI) awaitFeedback(ctx context.Context) ([]orbstore.Feedback, error) {
	before, err := c.store.List()
	if err != nil {
		return nil, err
	}
	last := ""
	if len(before) > 0 {
		last = before[len(before)-1].ID
	}
	ticker := time.NewTicker(orbPollEvery)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return nil, ctx.Err()
		case <-ticker.C:
		}
		items, err := c.store.List()
		if err != nil {
			return nil, err
		}
		if fresh := slices.DeleteFunc(items, func(f orbstore.Feedback) bool { return f.ID <= last }); len(fresh) > 0 {
			return fresh, nil
		}
	}
}

func orbTimeout(inv invocation) (time.Duration, error) {
	if !inv.has("--timeout") {
		return orbWaitDefault, nil
	}
	timeout, err := time.ParseDuration(inv.value("--timeout"))
	if err != nil || timeout <= 0 {
		return 0, fmt.Errorf("--timeout %q: want a duration like 30s", inv.value("--timeout"))
	}
	return timeout, nil
}

func pageCommand(c orbCLI) error {
	verb := c.arg(0)
	if verb != "console" && verb != "network" {
		return errors.New(pageUsage)
	}
	page, err := c.store.Page()
	if err != nil {
		return err
	}
	if page.URL == "" && !c.asJSON {
		_, err := fmt.Fprintln(c.out, "no page buffer yet: open the app on this stack with the orb showing")
		return err
	}
	if verb == "console" {
		return c.printConsole(page)
	}
	return c.printNetwork(page)
}

func (c orbCLI) printConsole(page orbstore.Page) error {
	entries := page.Console
	if level := c.inv.value("--level"); level != "" {
		entries = slices.DeleteFunc(entries, func(e orbstore.ConsoleEntry) bool { return e.Level != level })
	}
	if c.asJSON {
		return c.printJSON(map[string]any{"url": page.URL, "console": orbNonNil(entries)})
	}
	for _, e := range entries {
		if _, err := fmt.Fprintf(c.out, "%s  %-5s  %s\n", e.At, e.Level, e.Text); err != nil {
			return err
		}
	}
	return nil
}

func (c orbCLI) printNetwork(page orbstore.Page) error {
	requests := page.Network
	if c.inv.has("--failed") {
		requests = slices.DeleteFunc(requests, func(r orbstore.Request) bool { return !r.Failed })
	}
	if c.asJSON {
		return c.printJSON(map[string]any{"url": page.URL, "network": orbNonNil(requests)})
	}
	for _, r := range requests {
		if _, err := fmt.Fprintf(c.out, "%s  %-6s %3d  %6.0fms  %s\n", r.At, r.Method, r.Status, r.DurationMs, r.URL); err != nil {
			return err
		}
	}
	return nil
}

func (c orbCLI) printFeedback(items []orbstore.Feedback) error {
	if c.asJSON {
		return c.printJSON(map[string]any{"feedback": orbNonNil(items)})
	}
	if len(items) == 0 {
		_, err := fmt.Fprintln(c.out, "no feedback")
		return err
	}
	for i := range items {
		item := &items[i]
		note, _, _ := strings.Cut(item.Note, "\n")
		if _, err := fmt.Fprintf(c.out, "%s  %-8s  %s  %s\n", item.ID, orbState(*item), item.URL, note); err != nil {
			return err
		}
	}
	return nil
}

func orbState(f orbstore.Feedback) string {
	if f.Open() {
		return "open"
	}
	return "resolved"
}

func (c orbCLI) printJSON(v any) error {
	enc := json.NewEncoder(c.out)
	enc.SetIndent("", "  ")
	return enc.Encode(v)
}

// orbNonNil keeps an empty list an empty JSON array, not null.
func orbNonNil[T any](items []T) []T {
	if items == nil {
		return []T{}
	}
	return items
}
