package importext

import (
	"fmt"
	"io/fs"
	"os"
	"path/filepath"
	"strings"
)

// skippedDirectories are never walked: they hold generated or vendored code.
var skippedDirectories = map[string]bool{
	"node_modules": true, ".git": true, "dist": true, "build": true,
	"coverage": true, ".turbo": true, ".cache": true, ".next": true,
}

// sourceExtensions are the files importext rewrites.
var sourceExtensions = map[string]bool{".ts": true, ".tsx": true, ".mts": true}

// runner carries one walk's options, its dirty-file set and its report.
type runner struct {
	options Options
	dirty   map[string]bool
	report  *Report
}

// Execute walks every root and rewrites, or plans to rewrite, every source file.
func Execute(options Options) (*Report, error) {
	dirty, err := loadDirty(options)
	if err != nil {
		return nil, err
	}
	walk := &runner{options: options, dirty: dirty, report: newReport()}
	walk.report.Roots = options.Roots
	walk.report.DryRun = options.DryRun
	walk.report.OnlyClean = options.OnlyClean
	for _, root := range options.Roots {
		if err := walk.walkRoot(root); err != nil {
			return nil, err
		}
	}
	return walk.report, nil
}

func loadDirty(options Options) (map[string]bool, error) {
	if !options.OnlyClean {
		return map[string]bool{}, nil
	}
	dirty, err := dirtyPaths(options.Root)
	if err != nil {
		return nil, fmt.Errorf("reading git status: %w", err)
	}
	return dirty, nil
}

func (r *runner) walkRoot(root string) error {
	absolute := filepath.Join(r.options.Root, root)
	return filepath.WalkDir(absolute, func(path string, entry fs.DirEntry, err error) error {
		if err != nil {
			return err
		}
		if entry.IsDir() {
			if skippedDirectories[entry.Name()] {
				return fs.SkipDir
			}
			return nil
		}
		if !sourceExtensions[strings.ToLower(filepath.Ext(entry.Name()))] {
			return nil
		}
		return r.processFile(path)
	})
}

func (r *runner) processFile(path string) error {
	relative, err := filepath.Rel(r.options.Root, path)
	if err != nil {
		return err
	}
	slashed := filepath.ToSlash(relative)
	r.report.FilesScanned++
	if r.dirty[slashed] {
		r.report.SkippedDirty = append(r.report.SkippedDirty, slashed)
		return nil
	}
	source, err := os.ReadFile(path)
	if err != nil {
		return err
	}
	plan := &planner{source: string(source), dir: filepath.Dir(path), relativePath: slashed, report: r.report}
	rewritten, changes := plan.run()
	if len(changes) == 0 {
		return nil
	}
	r.report.FilesRewritten++
	r.report.SpecifiersRewritten += len(changes)
	r.report.Rewritten = append(r.report.Rewritten, FileRewrite{File: slashed, Changes: changes})
	return r.write(path, rewritten)
}

// write replaces the file's contents and keeps the permissions it already has.
func (r *runner) write(path, contents string) error {
	if r.options.DryRun {
		return nil
	}
	file, err := os.OpenFile(path, os.O_WRONLY|os.O_TRUNC, 0)
	if err != nil {
		return err
	}
	if _, err := file.WriteString(contents); err != nil {
		file.Close()
		return err
	}
	return file.Close()
}
