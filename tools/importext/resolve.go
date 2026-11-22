package importext

import (
	"os"
	"path/filepath"
	"strings"
)

// candidateSuffixes are appended to an extensionless specifier, in the order a
// specifier is resolved.
var candidateSuffixes = []string{".ts", ".tsx", ".mts", ".d.ts", "/index.ts", "/index.tsx"}

// javaScriptExtensions are the emitted extensions a TypeScript source may name
// in place of the file that actually exists.
var javaScriptExtensions = map[string]string{".js": "", ".jsx": "", ".mjs": ""}

// assetExtensions are left alone: they are not type-stripped modules.
var assetExtensions = map[string]bool{
	".json": true, ".css": true, ".scss": true, ".svg": true, ".png": true, ".md": true,
}

// isRelative reports whether a specifier addresses a sibling file rather than a
// package, a node: builtin or a path alias.
func isRelative(specifier string) bool {
	return strings.HasPrefix(specifier, "./") || strings.HasPrefix(specifier, "../")
}

func isAlias(specifier string) bool {
	return strings.HasPrefix(specifier, "~/") || strings.HasPrefix(specifier, "@/")
}

func hasQuery(specifier string) bool {
	return strings.ContainsAny(specifier, "?#")
}

func isAsset(specifier string) bool {
	return assetExtensions[strings.ToLower(filepath.Ext(specifier))]
}

// resolve returns the specifier that names the file on disk, or "" when nothing
// on disk answers to it. dir is the directory holding the importing file.
func resolve(dir, specifier string) string {
	if isFile(filepath.Join(dir, specifier)) {
		return specifier
	}
	for _, suffix := range candidateSuffixes {
		if isFile(filepath.Join(dir, specifier+suffix)) {
			return specifier + suffix
		}
	}
	return resolveJavaScriptExtension(dir, specifier)
}

// resolveJavaScriptExtension maps a .js-family specifier onto the TypeScript
// sibling that produces it.
func resolveJavaScriptExtension(dir, specifier string) string {
	extension := strings.ToLower(filepath.Ext(specifier))
	if _, ok := javaScriptExtensions[extension]; !ok {
		return ""
	}
	stem := strings.TrimSuffix(specifier, filepath.Ext(specifier))
	for _, suffix := range []string{".ts", ".tsx", ".mts"} {
		if isFile(filepath.Join(dir, stem+suffix)) {
			return stem + suffix
		}
	}
	return ""
}

func isFile(path string) bool {
	info, err := os.Stat(path)
	return err == nil && !info.IsDir()
}
