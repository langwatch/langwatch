package enforcer

import (
	"path/filepath"
	"regexp"
	"slices"
	"strings"

	"github.com/langwatch/langwatch/tools/internal/workspace"
)

// contract-build-config (quality/contract-build-config.ts).

var testsExclusion = regexp.MustCompile(`^(?:\*\*/)?tests(?:/\*\*(?:/\*)?)?$`)

const contractPolicy = "contract-build-config"

// sourceOnlyBuild is rootDir src, a non-empty src/-only include and a tests exclusion.
func sourceOnlyBuild(config, compilerOptions map[string]any) bool {
	include, _ := config["include"].([]any)
	sourceOnly := len(include) > 0 && !slices.ContainsFunc(include, func(p any) bool {
		text, isString := p.(string)
		return !isString || !strings.HasPrefix(text, "src/")
	})
	exclude, _ := config["exclude"].([]any)
	excludesTests := slices.ContainsFunc(exclude, func(p any) bool {
		text, isString := p.(string)
		return isString && testsExclusion.MatchString(text)
	})
	return compilerOptions["rootDir"] == "src" && sourceOnly && excludesTests
}

// objectConfig is the config and its compilerOptions when both are objects (options may be absent).
func objectConfig(raw any) (config, options map[string]any, ok bool) {
	config, ok = raw.(map[string]any)
	value, present := config["compilerOptions"]
	options, optionsOK := value.(map[string]any)
	return config, options, ok && (!present || optionsOK)
}

func contractBuildViolation(s *workspace.Snapshot, pkg *workspace.Package) *Violation {
	file := filepath.Join(pkg.Root, "tsconfig.build.json")
	_, hasBuild := pkg.Manifest.Script("build")
	if !workspace.Exists(file) {
		if !hasBuild {
			return nil
		}
		return &Violation{Policy: contractPolicy, File: file, Message: "Strict contract declaration build config is missing."}
	}
	raw, err := s.Config(file)
	if err != nil {
		return &Violation{Policy: contractPolicy, File: file, Message: "Strict contract declaration build config must be valid JSONC."}
	}
	config, options, ok := objectConfig(raw)
	if !ok {
		return &Violation{Policy: contractPolicy, File: file, Message: "Strict contract declaration build config must be a JSON object."}
	}
	if sourceOnlyBuild(config, options) {
		return nil
	}
	return &Violation{Policy: contractPolicy, File: file,
		Message: "Strict contract declaration builds require rootDir src, source-only include, and an explicit tests exclusion.",
		Allowed: "Keep declaration builds independent from package test roots."}
}

// ContractBuildConfigs is lintStrictContractBuildConfigs.
func ContractBuildConfigs(s *workspace.Snapshot) ([]Violation, error) {
	var out []Violation
	for _, pkg := range s.Packages {
		if pkg.Kind != "contract" {
			continue
		}
		if v := contractBuildViolation(s, pkg); v != nil {
			out = append(out, *v)
		}
	}
	return out, nil
}
