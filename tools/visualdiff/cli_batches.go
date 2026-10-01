package visualdiff

import (
	"context"
	"flag"
	"fmt"
	"os"
	"path/filepath"
	"slices"
	"time"
)

// batchReviewCommand is `visualdiff batch-review <dir>`: a sealed batch's REVIEW.md.
func batchReviewCommand(args []string, streams Streams) int {
	if len(args) != 1 {
		fmt.Fprintln(streams.Err, "usage: visualdiff batch-review <batch-dir>")
		return ExitOperational
	}
	if !fileExists(filepath.Join(args[0], BatchReadyFile)) {
		fmt.Fprintf(streams.Err, "visualdiff batch-review: %s is not ready (no %s)\n", args[0], BatchReadyFile)
		return ExitOperational
	}
	review, err := os.ReadFile(filepath.Join(args[0], BatchReviewFile)) // #nosec G304 -- the batch named.
	if err != nil {
		fmt.Fprintln(streams.Err, "visualdiff batch-review:", err)
		return ExitOperational
	}
	fmt.Fprint(streams.Out, string(review))
	return ExitClean
}

// batchesCommand is `visualdiff batches`: every ready batch's path, or with -wait
// the first ready one numbered after -after, blocking until it is sealed.
func batchesCommand(ctx context.Context, args []string, streams Streams) int {
	flags := flag.NewFlagSet("batches", flag.ContinueOnError)
	flags.SetOutput(streams.Err)
	dir := flags.String("dir", filepath.Join(".visualdiff", "check"), "the check or run output directory")
	wait := flags.Bool("wait", false, "block until the next ready batch, then print its path")
	after := flags.Int("after", 0, "with -wait, the last batch number already reviewed")
	timeout := flags.Duration("timeout", 30*time.Minute, "with -wait, give up after this long")
	if err := flags.Parse(args); err != nil {
		return ExitOperational
	}
	root := filepath.Join(*dir, BatchesDir)
	if !*wait {
		for _, path := range readyBatches(root, 0) {
			fmt.Fprintln(streams.Out, path)
		}
		return ExitClean
	}
	waitCtx, cancel := context.WithTimeout(ctx, *timeout)
	defer cancel()
	path, err := waitForBatch(waitCtx, root, *after, time.Second)
	if err != nil {
		fmt.Fprintln(streams.Err, "visualdiff batches:", err)
		return ExitOperational
	}
	fmt.Fprintln(streams.Out, path)
	return ExitClean
}

// readyBatches are the batch directories under root numbered after after that hold
// READY, lowest first.
func readyBatches(root string, after int) []string {
	numbers := batchNumbers(root)
	var names []string
	for name, number := range numbers {
		if number > after && fileExists(filepath.Join(root, name, BatchReadyFile)) {
			names = append(names, name)
		}
	}
	slices.SortFunc(names, func(a, b string) int { return numbers[a] - numbers[b] })
	paths := make([]string, 0, len(names))
	for _, name := range names {
		paths = append(paths, filepath.Join(root, name))
	}
	return paths
}

// waitForBatch polls root every poll until a batch after after is ready.
func waitForBatch(ctx context.Context, root string, after int, poll time.Duration) (string, error) {
	ticker := time.NewTicker(poll)
	defer ticker.Stop()
	for {
		if ready := readyBatches(root, after); len(ready) > 0 {
			return ready[0], nil
		}
		select {
		case <-ctx.Done():
			return "", fmt.Errorf("no batch after %d became ready: %w", after, ctx.Err())
		case <-ticker.C:
		}
	}
}
