package main

import (
	"bufio"
	"flag"
	"fmt"
	"maps"
	"os"
	"os/exec"
	"slices"
	"sort"
	"strings"
	"sync"
	"time"

	"github.com/muesli/termenv"
)

var examples = map[string]string{
	"threads":             "./threads/main.go",
	"filtered-spans":      "./filtered-spans/main.go",
	"custom-input-output": "./custom-input-output/main.go",
	"streaming":           "./streaming/main.go",
	"simple":              "./simple/main.go",
	"responses":           "./responses/main.go",
}

// runExample executes a single example in a subprocess and streams its output.
// It concurrently reads from both stdout and stderr to avoid blocking.
func runExample(name, path string, ciMode bool, wg *sync.WaitGroup, outputCh chan<- string) {
	defer wg.Done()

	fmt.Fprintf(os.Stderr, "[INFO] Starting example: %s\n", name)

	cmd := exec.Command("go", "run", path)
	cmd.Env = os.Environ()

	stdout, _ := cmd.StdoutPipe()
	stderr, _ := cmd.StderrPipe()

	// readPipe handles concurrent reading from a pipe to prevent blocking.
	// Both stdout and stderr are read simultaneously to avoid deadlock.
	readPipe := func(pipe interface{ Read([]byte) (int, error) }, wg *sync.WaitGroup) {
		defer wg.Done()
		scanner := bufio.NewScanner(pipe)
		for scanner.Scan() {
			line := scanner.Text()

			var formattedLine string
			if ciMode {
				formattedLine = fmt.Sprintf("[%s] %s\n", name, line)
			} else {
				formattedLine = line + "\n"
			}

			outputCh <- fmt.Sprintf("%s:%s", name, formattedLine)
		}
	}

	err := cmd.Start()
	if err != nil {
		outputCh <- fmt.Sprintf("%s:ERROR: failed to start: %v", name, err)
		return
	}

	// Start concurrent readers for stdout and stderr to prevent blocking
	var readerWg sync.WaitGroup
	readerWg.Add(2)
	go readPipe(stdout, &readerWg)
	go readPipe(stderr, &readerWg)

	cmdErr := cmd.Wait()
	readerWg.Wait()

	if cmdErr != nil {
		outputCh <- fmt.Sprintf("%s:ERROR: %v", name, cmdErr)
	}
}

// parseArgs parses command-line flags and arguments.
func parseArgs() (cmd string, args []string, ciMode bool) {
	ciFlag := flag.Bool("ci", false, "Enable CI-friendly output with prefixed lines")
	flag.Parse()

	args = flag.Args()
	ciMode = *ciFlag

	if len(args) < 1 {
		fmt.Println("Usage: go run cmd/main.go [--ci] run-example <name> | run-examples")
		os.Exit(1)
	}

	cmd = args[0]
	return
}

// formatHeader returns a styled terminal header for an example section.
func formatHeader(name string) string {
	profile := termenv.ColorProfile()
	return termenv.String(fmt.Sprintf("=== %s ===", name)).Bold().Foreground(profile.Color("33")).String()
}

// displayOutput handles real-time display of example outputs with different modes:
// - Non-CI grouped: Shows spinners and live-updating grouped output
// - CI mode: Streams output immediately with optional summary
// - Single example: Simple streaming output
func displayOutput(outputCh <-chan string, showHeaders bool, ciMode bool) bool {
	var failed bool
	outputs := make(map[string][]string)
	var mu sync.Mutex
	startedExamples := make(map[string]bool)

	if !ciMode && showHeaders {
		var exampleNames []string
		for name := range examples {
			exampleNames = append(exampleNames, name)
		}

		frames := []string{"⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"}
		frameIndex := 0
		ticker := time.NewTicker(80 * time.Millisecond)
		defer ticker.Stop()

		fmt.Print("\033[?25l") // Hide cursor for cleaner animation
		defer fmt.Print("\033[?25h")

		// renderDisplay redraws the entire screen with current state.
		// This approach prevents flickering from concurrent updates.
		renderDisplay := func() {
			mu.Lock()
			defer mu.Unlock()

			term := termenv.NewOutput(os.Stdout)
			term.ClearScreen()
			term.MoveCursor(1, 1)

			var names []string
			for _, name := range exampleNames {
				names = append(names, name)
			}
			sort.Strings(names)

			for _, name := range names {
				header := formatHeader(name)
				fmt.Printf("%s\n", header)

				if startedExamples[name] && len(outputs[name]) > 0 {
					for _, line := range outputs[name] {
						fmt.Print(line)
					}
				} else if !startedExamples[name] {
					fmt.Printf("%s Running...\n", frames[frameIndex])
				}
				fmt.Println()
			}
		}

		// Single render loop prevents screen flickering from competing updates
		go func() {
			for {
				select {
				case <-ticker.C:
					frameIndex = (frameIndex + 1) % len(frames)
					renderDisplay()
				}
			}
		}()

		renderDisplay()

		for output := range outputCh {
			parts := splitOutput(output)
			name, content := parts[0], parts[1]

			if strings.Contains(content, "ERROR:") {
				failed = true
				continue
			}

			if !startedExamples[name] {
				startedExamples[name] = true
			}

			mu.Lock()
			if outputs[name] == nil {
				outputs[name] = make([]string, 0)
			}
			outputs[name] = append(outputs[name], content)
			mu.Unlock()
		}

		renderDisplay()
	} else {
		// CI mode: immediate streaming with pretty summary
		ciOutputs := make(map[string][]string)
		var ciMu sync.Mutex

		for output := range outputCh {
			parts := splitOutput(output)
			name, content := parts[0], parts[1]

			if strings.Contains(content, "ERROR:") {
				failed = true
				continue
			}

			// Stream output immediately for real-time feedback
			if ciMode {
				fmt.Print(content)
			} else {
				fmt.Print(content)
			}

			// Also accumulate for final summary in CI mode
			if ciMode && showHeaders {
				ciMu.Lock()
				if ciOutputs[name] == nil {
					ciOutputs[name] = make([]string, 0)
				}
				ciOutputs[name] = append(ciOutputs[name], content)
				ciMu.Unlock()
			}
		}

		// Render grouped summary at end for CI mode
		if ciMode && showHeaders && len(ciOutputs) > 0 {
			fmt.Println("\n" + strings.Repeat("=", 80))
			fmt.Println("SUMMARY")
			fmt.Println(strings.Repeat("=", 80))

			var names []string
			for name := range ciOutputs {
				names = append(names, name)
			}
			sort.Strings(names)

			for _, name := range names {
				lines := ciOutputs[name]
				if len(lines) > 0 {
					header := formatHeader(name)
					fmt.Printf("%s\n", header)
					for _, line := range lines {
						fmt.Print(line)
					}
					fmt.Println()
				}
			}
		}
	}

	return failed
}

// splitOutput parses the "name:content" format, handling colons in content.
// This avoids splitting on colons that are part of timestamps or log content.
func splitOutput(output string) []string {
	for exampleName := range examples {
		prefix := exampleName + ":"
		if len(output) > len(prefix) && output[:len(prefix)] == prefix {
			return []string{exampleName, output[len(prefix):]}
		}
	}

	for i, r := range output {
		if r == ':' {
			return []string{output[:i], output[i+1:]}
		}
	}
	return []string{output, ""}
}

func main() {
	cmd, args, ciMode := parseArgs()

	switch cmd {
	case "run-example":
		if len(args) < 2 {
			fmt.Println("Usage: go run cmd/main.go [--ci] run-example <name>")
			os.Exit(1)
		}

		example := args[1]
		path, ok := examples[example]
		if !ok {
			fmt.Printf("Unknown example: %s\n", example)
			fmt.Printf("Available examples: %s\n", strings.Join(slices.Sorted(maps.Keys(examples)), ", "))
			os.Exit(1)
		}

		var wg sync.WaitGroup
		outputCh := make(chan string, 10)

		wg.Add(1)
		go runExample(example, path, ciMode, &wg, outputCh)

		go func() {
			wg.Wait()
			close(outputCh)
		}()

		failed := displayOutput(outputCh, false, ciMode)
		if failed {
			os.Exit(1)
		}

	case "run-examples":
		var wg sync.WaitGroup
		outputCh := make(chan string, len(examples)*10)

		for name, path := range examples {
			wg.Add(1)
			go runExample(name, path, ciMode, &wg, outputCh)
		}

		go func() {
			wg.Wait()
			close(outputCh)
		}()

		failed := displayOutput(outputCh, true, ciMode)
		if failed {
			os.Exit(1)
		}

	default:
		fmt.Printf("Unknown command: %s\n", cmd)
		os.Exit(1)
	}
}
