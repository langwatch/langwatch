package devscripts

// Fixtures and golden text below were produced by running the original Node
// scripts (dev/scripts/generate-modules.mjs, sync-tsconfig-references.mjs and
// the tsconfig-references render) over the same inputs.

var generateModulesFixture = map[string]string{
	"pnpm-workspace.yaml":                             "packages:\n  - x\n",
	"modules/catalogue.json":                          "{\n  \"version\": 0,\n  \"features\": [\n    {\n      \"id\": \"alpha\",\n      \"root\": \"modules/alpha\"\n    },\n    {\n      \"id\": \"beta-mod\",\n      \"root\": \"modules/beta-mod\"\n    },\n    {\n      \"id\": \"gamma\",\n      \"root\": \"modules/gamma\"\n    },\n    {\n      \"id\": \"delta\",\n      \"root\": \"modules/delta\"\n    }\n  ]\n}\n",
	"modules/alpha/process/package.json":              "{\n  \"name\": \"@lw/alpha-process\",\n  \"version\": \"0.0.0\",\n  \"main\": \"src/index.ts\"\n}\n",
	"modules/alpha/process/src/alpha.server.ts":       "export const alphaServer = {};\n",
	"modules/alpha/process/src/index.ts":              "export { alphaServer } from './alpha.server.ts';\n",
	"modules/alpha/process/src/app/alpha.app.ts":      "export class A {\n  static readonly reads = reads([\"postgres\", 'redis', `clickhouse`]);\n}\n",
	"modules/alpha/browser/package.json":              "{\n  \"name\": \"@lw/alpha-browser\",\n  \"exports\": {\n    \"./declaration\": \"./src/alpha.web.ts\"\n  }\n}\n",
	"modules/alpha/browser/src/alpha.web.ts":          "export const alphaWeb = { name: \"alpha\" };\n",
	"modules/alpha/contract/package.json":             "{\n  \"name\": \"@lw/alpha-contract\"\n}\n",
	"modules/alpha/contract/src/alpha.config.ts":      "export const alphaServerConfigSchema = {};\n",
	"modules/alpha/contract/src/index.ts":             "export * from \"./alpha.config.ts\";\n",
	"modules/beta-mod/process/package.json":           "{\n  \"name\": \"@lw/beta\",\n  \"version\": \"1.0.0\"\n}\n",
	"modules/beta-mod/process/src/beta-mod.server.ts": "export const betaModServer = {};\n",
	"modules/beta-mod/process/src/index.ts":           "export const betaModServer = 1;\n",
	"modules/beta-mod/process/src/app/beta.app.ts":    "export class B { static readonly reads = [\"redis\", \"clickhouse\"] as const; }\n",
	"modules/gamma/process/package.json":              "{\n  \"name\": \"@lw/gamma-process\"\n}\n",
	"modules/gamma/process/src/gamma.server.ts":       "export const other = 1;\n",
	"modules/gamma/process/src/index.ts":              "export const gammaServerish = 1;\n",
	"modules/gamma/process/src/app/gamma.app.ts":      "export class G {}\n",
	"modules/gamma/browser/package.json":              "{\n  \"name\": \"@lw/gamma-browser\",\n  \"exports\": {\n    \"./declaration\": {\n      \"langwatch-declaration-source\": \"./src/gamma.web.ts\",\n      \"default\": \"./x\"\n    }\n  }\n}\n",
	"modules/gamma/browser/src/gamma.web.ts":          "export const gammaWeb = { name: \"gamma\" };\n",
	"modules/delta/process/package.json":              "{\n  \"name\": \"@lw/delta-process\"\n}\n",
	"packages/installed-server-modules/package.json":  "{\n  \"name\": \"@langwatch/installed-server-modules\",\n  \"private\": true,\n  \"dependencies\": {\n    \"stale\": \"workspace:*\"\n  },\n  \"scripts\": {\n    \"typecheck\": \"tsc\"\n  }\n}\n",
	"packages/installed-web-modules/package.json":     "{\n  \"name\": \"@langwatch/installed-web-modules\",\n  \"private\": true\n}\n",
}

var generateModulesGolden = map[string]string{
	"packages/installed-server-modules/src/server-modules.generated.ts":        "/** Generated from modules/catalogue.json. Do not edit by hand. */\n/** Run `pnpm generate:modules` to rewrite it. */\n\nimport { alphaServer } from \"@lw/alpha-process\";\nimport { betaModServer } from \"@lw/beta\";\n\n/** Every installed module's server declaration, in name order. */\nexport const serverModules = [\n  alphaServer,\n  betaModServer,\n] as const;\n",
	"packages/installed-web-modules/src/web-modules.generated.ts":              "/** Generated from modules/catalogue.json. Do not edit by hand. */\n/** Run `pnpm generate:modules` to rewrite it. */\n\nimport { alphaWeb } from \"@lw/alpha-browser/declaration\";\nimport { gammaWeb } from \"@lw/gamma-browser/declaration\";\n\n/** Every installed module's web declaration, in name order. */\nexport const webModules = [\n  alphaWeb satisfies { readonly name: \"alpha\" },\n  gammaWeb satisfies { readonly name: \"gamma\" },\n] as const;\ntype PairedOnDisk = \"alpha\" | \"gamma\";\ntype ServerHalfOnDisk = \"alpha\" | \"beta-mod\";\ntype MissingWeb = Exclude<PairedOnDisk, (typeof webModules)[number][\"name\"]>;\ntype MissingServer = Exclude<PairedOnDisk, ServerHalfOnDisk>;\nexport const webModulePairing = {} satisfies {\n  [Id in `missing web half \"${MissingWeb}\"` | `missing server half \"${MissingServer}\"`]: never;\n};\n",
	"packages/installed-server-modules/src/server-module-members.generated.ts": "/** Generated from modules/catalogue.json. Do not edit by hand. */\n/** Run `pnpm generate:modules` to rewrite it. */\n\n/**\n * What each installed module's App declared it reads, in name order.\n *\n * Boot builds exactly this union, plus whatever each module's chosen\n * repository tier requires, and refuses by module and member when this\n * process cannot supply one.\n */\nexport const serverModuleMembers = {\n  alpha: [\"clickhouse\", \"postgres\", \"redis\"],\n  \"beta-mod\": [\"clickhouse\", \"redis\"],\n  gamma: [],\n  delta: [],\n} as const;\n",
	"packages/installed-server-modules/package.json":                           "{\n  \"name\": \"@langwatch/installed-server-modules\",\n  \"private\": true,\n  \"dependencies\": {\n    \"@langwatch/kernel\": \"workspace:*\",\n    \"@lw/alpha-contract\": \"workspace:*\",\n    \"@lw/alpha-process\": \"workspace:*\",\n    \"@lw/beta\": \"workspace:*\"\n  },\n  \"scripts\": {\n    \"typecheck\": \"tsc\"\n  }\n}\n",
	"packages/installed-web-modules/package.json":                              "{\n  \"name\": \"@langwatch/installed-web-modules\",\n  \"private\": true,\n  \"dependencies\": {\n    \"@lw/alpha-browser\": \"workspace:*\",\n    \"@lw/gamma-browser\": \"workspace:*\"\n  }\n}\n",
}

const generateModulesStdout = "Wrote packages/installed-server-modules/src/server-modules.generated.ts\nWrote packages/installed-web-modules/src/web-modules.generated.ts\nWrote packages/installed-server-modules/src/server-module-members.generated.ts\nWrote packages/installed-server-modules/package.json\nWrote packages/installed-web-modules/package.json\n"

var syncReferencesFixture = map[string]string{
	"pnpm-workspace.yaml":                    "packages:\n  - \"pkgs/*\"\n  - 'modules/*/*'\n  - skipped\n\ncatalog:\n  - nope\n",
	"pkgs/a/package.json":                    "{\n  \"name\": \"@f/a\",\n  \"dependencies\": {\n    \"@f/b\": \"workspace:*\",\n    \"ext\": \"^1\"\n  },\n  \"scripts\": {\n    \"typecheck\": \"tsc\"\n  }\n}\n",
	"pkgs/a/tsconfig.json":                   "{\n  // comment\n  \"extends\": \"./tsconfig.build.json\",\n  \"references\": [{ \"path\": \"./stale\" }],\n}\n",
	"pkgs/a/tsconfig.build.json":             "{\n  \"compilerOptions\": { \"composite\": true },\n  \"references\": []\n}\n",
	"pkgs/b/package.json":                    "{\n  \"name\": \"@f/b\",\n  \"dependencies\": {\n    \"@f/a\": \"workspace:*\"\n  },\n  \"devDependencies\": {\n    \"@f/c\": \"workspace:*\"\n  },\n  \"scripts\": {\n    \"typecheck\": \"tsc\"\n  }\n}\n",
	"pkgs/b/tsconfig.json":                   "{\n\t\"extends\": \"./tsconfig.build.json\"\n}\n",
	"pkgs/b/tsconfig.test.json":              "{\n\t\"extends\": \"./tsconfig.json\",\n\t\"langwatchExtraReferences\": [{ \"path\": \"./extra.json\" }]\n}\n",
	"pkgs/b/tsconfig.build.json":             "{\n  \"compilerOptions\": { \"composite\": true }\n}\n",
	"pkgs/c/package.json":                    "{\n  \"name\": \"@f/c\",\n  \"dependencies\": {\n    \"@f/b\": \"workspace:*\"\n  }\n}\n",
	"pkgs/c/tsconfig.json":                   "{ \"extends\": \"./tsconfig.build.json\" }\n",
	"pkgs/c/tsconfig.build.json":             "{ \"compilerOptions\": { \"declaration\": false } }\n",
	"pkgs/c/tsconfig.declarations.json":      "{\r\n  \"compilerOptions\": {},\r\n  \"references\": [{ \"path\": \"../a/tsconfig.build.json\" }]\r\n}\r\n",
	"modules/m/contract/package.json":        "{\n  \"name\": \"@f/m-contract\",\n  \"dependencies\": {\n    \"@f/a\": \"workspace:*\"\n  },\n  \"scripts\": {\n    \"typecheck\": \"tsc\"\n  }\n}\n",
	"modules/m/contract/tsconfig.json":       "{}\n",
	"modules/m/contract/tsconfig.build.json": "{\n  \"compilerOptions\": { \"composite\": true }\n}\n",
	"tsconfig.json":                          "{\n  \"files\": [],\n  \"langwatchExtraReferences\": [{ \"path\": \"./preview/tsconfig.json\" }],\n  \"references\": []\n}\n",
}

var syncReferencesGolden = map[string]string{
	"pkgs/a/tsconfig.json":                   "{\n  // comment\n  \"extends\": \"./tsconfig.build.json\",\n  \"references\": [\n    {\n      \"path\": \"tsconfig.build.json\"\n    },\n    {\n      \"path\": \"../b/tsconfig.build.json\"\n    }\n  ],\n}\n",
	"pkgs/a/tsconfig.build.json":             "{\n  \"compilerOptions\": { \"composite\": true },\n  \"references\": []\n}\n",
	"pkgs/b/tsconfig.json":                   "{\n\t\"extends\": \"./tsconfig.build.json\",\n\t\"references\": [\n\t\t{\n\t\t\t\"path\": \"tsconfig.build.json\"\n\t\t},\n\t\t{\n\t\t\t\"path\": \"../a/tsconfig.build.json\"\n\t\t},\n\t\t{\n\t\t\t\"path\": \"../c/tsconfig.declarations.json\"\n\t\t}\n\t]\n}\n",
	"pkgs/b/tsconfig.test.json":              "{\n\t\"extends\": \"./tsconfig.json\",\n\t\"langwatchExtraReferences\": [{ \"path\": \"./extra.json\" }],\n\t\"references\": [\n\t\t{\n\t\t\t\"path\": \"tsconfig.build.json\"\n\t\t},\n\t\t{\n\t\t\t\"path\": \"../a/tsconfig.build.json\"\n\t\t},\n\t\t{\n\t\t\t\"path\": \"../c/tsconfig.declarations.json\"\n\t\t},\n\t\t{\n\t\t\t\"path\": \"extra.json\"\n\t\t}\n\t]\n}\n",
	"pkgs/b/tsconfig.build.json":             "{\n  \"compilerOptions\": { \"composite\": true },\n  \"references\": [\n    {\n      \"path\": \"../a/tsconfig.build.json\"\n    }\n  ]\n}\n",
	"pkgs/c/tsconfig.json":                   "{ \"extends\": \"./tsconfig.build.json\",\n  \"references\": [\n    {\n      \"path\": \"tsconfig.declarations.json\"\n    },\n    {\n      \"path\": \"../b/tsconfig.build.json\"\n    }\n  ]\n}\n",
	"pkgs/c/tsconfig.build.json":             "{ \"compilerOptions\": { \"declaration\": false } }\n",
	"pkgs/c/tsconfig.declarations.json":      "{\r\n  \"compilerOptions\": {},\r\n  \"references\": [\n    {\n      \"path\": \"../b/tsconfig.build.json\"\n    }\n  ]\r\n}\r\n",
	"modules/m/contract/tsconfig.json":       "{\n  \"references\": [\n    {\n      \"path\": \"tsconfig.build.json\"\n    },\n    {\n      \"path\": \"../../../pkgs/a/tsconfig.build.json\"\n    }\n  ]\n}\n",
	"modules/m/contract/tsconfig.build.json": "{\n  \"compilerOptions\": { \"composite\": true },\n  \"references\": [\n    {\n      \"path\": \"../../../pkgs/a/tsconfig.build.json\"\n    }\n  ]\n}\n",
	"tsconfig.json":                          "{\n  \"files\": [],\n  \"langwatchExtraReferences\": [{ \"path\": \"./preview/tsconfig.json\" }],\n  \"references\": [\n    {\n      \"path\": \"pkgs/a/tsconfig.json\"\n    },\n    {\n      \"path\": \"pkgs/b/tsconfig.test.json\"\n    },\n    {\n      \"path\": \"modules/m/contract/tsconfig.json\"\n    },\n    {\n      \"path\": \"preview/tsconfig.json\"\n    }\n  ]\n}\n",
	"tsconfig.build.json":                    "// The build solution: the module contracts, in one project graph, so their\n// declarations are emitted by a single `tsc -b` instead of one compiler\n// process per package. `pnpm build:types` runs it.\n//\n// Generated by `pnpm sync:references` (tools/devscripts). Do not edit: add a\n// package to the workspace and re-run `pnpm sync:references`.\n{\n  \"files\": [],\n  \"references\": [\n    {\n      \"path\": \"modules/m/contract/tsconfig.build.json\"\n    }\n  ]\n}\n",
}

const (
	syncReferencesCheckStdout = "--- a/pkgs/a/tsconfig.json\n+++ b/pkgs/a/tsconfig.json\n@@ -4,1 +4,8 @@\n-  \"references\": [{ \"path\": \"./stale\" }],\n+  \"references\": [\n+    {\n+      \"path\": \"tsconfig.build.json\"\n+    },\n+    {\n+      \"path\": \"../b/tsconfig.build.json\"\n+    }\n+  ],\n\n--- a/pkgs/b/tsconfig.build.json\n+++ b/pkgs/b/tsconfig.build.json\n@@ -2,1 +2,6 @@\n-  \"compilerOptions\": { \"composite\": true }\n+  \"compilerOptions\": { \"composite\": true },\n+  \"references\": [\n+    {\n+      \"path\": \"../a/tsconfig.build.json\"\n+    }\n+  ]\n\n--- a/pkgs/b/tsconfig.json\n+++ b/pkgs/b/tsconfig.json\n@@ -2,1 +2,12 @@\n-\t\"extends\": \"./tsconfig.build.json\"\n+\t\"extends\": \"./tsconfig.build.json\",\n+\t\"references\": [\n+\t\t{\n+\t\t\t\"path\": \"tsconfig.build.json\"\n+\t\t},\n+\t\t{\n+\t\t\t\"path\": \"../a/tsconfig.build.json\"\n+\t\t},\n+\t\t{\n+\t\t\t\"path\": \"../c/tsconfig.declarations.json\"\n+\t\t}\n+\t]\n\n--- a/pkgs/b/tsconfig.test.json\n+++ b/pkgs/b/tsconfig.test.json\n@@ -3,1 +3,15 @@\n-\t\"langwatchExtraReferences\": [{ \"path\": \"./extra.json\" }]\n+\t\"langwatchExtraReferences\": [{ \"path\": \"./extra.json\" }],\n+\t\"references\": [\n+\t\t{\n+\t\t\t\"path\": \"tsconfig.build.json\"\n+\t\t},\n+\t\t{\n+\t\t\t\"path\": \"../a/tsconfig.build.json\"\n+\t\t},\n+\t\t{\n+\t\t\t\"path\": \"../c/tsconfig.declarations.json\"\n+\t\t},\n+\t\t{\n+\t\t\t\"path\": \"extra.json\"\n+\t\t}\n+\t]\n\n--- a/pkgs/c/tsconfig.json\n+++ b/pkgs/c/tsconfig.json\n@@ -1,1 +1,10 @@\n-{ \"extends\": \"./tsconfig.build.json\" }\n+{ \"extends\": \"./tsconfig.build.json\",\n+  \"references\": [\n+    {\n+      \"path\": \"tsconfig.declarations.json\"\n+    },\n+    {\n+      \"path\": \"../b/tsconfig.build.json\"\n+    }\n+  ]\n+}\n\n--- a/pkgs/c/tsconfig.declarations.json\n+++ b/pkgs/c/tsconfig.declarations.json\n@@ -3,1 +3,5 @@\n-  \"references\": [{ \"path\": \"../a/tsconfig.build.json\" }]\r\n+  \"references\": [\n+    {\n+      \"path\": \"../b/tsconfig.build.json\"\n+    }\n+  ]\r\n\n--- a/modules/m/contract/tsconfig.build.json\n+++ b/modules/m/contract/tsconfig.build.json\n@@ -2,1 +2,6 @@\n-  \"compilerOptions\": { \"composite\": true }\n+  \"compilerOptions\": { \"composite\": true },\n+  \"references\": [\n+    {\n+      \"path\": \"../../../pkgs/a/tsconfig.build.json\"\n+    }\n+  ]\n\n--- a/modules/m/contract/tsconfig.json\n+++ b/modules/m/contract/tsconfig.json\n@@ -1,1 +1,10 @@\n-{}\n+{\n+  \"references\": [\n+    {\n+      \"path\": \"tsconfig.build.json\"\n+    },\n+    {\n+      \"path\": \"../../../pkgs/a/tsconfig.build.json\"\n+    }\n+  ]\n+}\n\n--- a/tsconfig.json\n+++ b/tsconfig.json\n@@ -4,1 +4,14 @@\n-  \"references\": []\n+  \"references\": [\n+    {\n+      \"path\": \"pkgs/a/tsconfig.json\"\n+    },\n+    {\n+      \"path\": \"pkgs/b/tsconfig.test.json\"\n+    },\n+    {\n+      \"path\": \"modules/m/contract/tsconfig.json\"\n+    },\n+    {\n+      \"path\": \"preview/tsconfig.json\"\n+    }\n+  ]\n\n--- a/tsconfig.build.json\n+++ b/tsconfig.build.json\n@@ -1,0 +1,14 @@\n+// The build solution: the module contracts, in one project graph, so their\n+// declarations are emitted by a single `tsc -b` instead of one compiler\n+// process per package. `pnpm build:types` runs it.\n+//\n+// Generated by `pnpm sync:references` (tools/devscripts). Do not edit: add a\n+// package to the workspace and re-run `pnpm sync:references`.\n+{\n+  \"files\": [],\n+  \"references\": [\n+    {\n+      \"path\": \"modules/m/contract/tsconfig.build.json\"\n+    }\n+  ]\n+}\n\nUndeducible reference in pkgs/a/tsconfig.json: stale. Keep it under langwatchExtraReferences.\nUndeducible reference in pkgs/c/tsconfig.declarations.json: ../a/tsconfig.build.json. Keep it under langwatchExtraReferences.\n10 of 10 tsconfig files differ; 2 undeducible entries.\n"
	syncReferencesCheckCode   = 1
	syncReferencesWriteStdout = "Wrote 10 of 10 tsconfig files.\nUndeducible reference in pkgs/a/tsconfig.json: stale. Keep it under langwatchExtraReferences.\nUndeducible reference in pkgs/c/tsconfig.declarations.json: ../a/tsconfig.build.json. Keep it under langwatchExtraReferences.\n10 of 10 tsconfig files differ; 2 undeducible entries.\n"
)

var renderReferencesCases = []struct {
	name, in string
	refs     []string
	want     string
}{
	{"replace", "{\n  \"extends\": \"./a.json\",\n  \"references\": [\n    { \"path\": \"./old\" }\n  ],\n  \"include\": [\"src\"]\n}\n", []string{"../a/tsconfig.json", "./b\"q"}, "{\n  \"extends\": \"./a.json\",\n  \"references\": [\n    {\n      \"path\": \"../a/tsconfig.json\"\n    },\n    {\n      \"path\": \"./b\\\"q\"\n    }\n  ],\n  \"include\": [\"src\"]\n}\n"},
	{"insert", "{\n\t\"extends\": \"./a.json\"\n}\n", []string{"../a/tsconfig.json", "./b\"q"}, "{\n\t\"extends\": \"./a.json\",\n\t\"references\": [\n\t\t{\n\t\t\t\"path\": \"../a/tsconfig.json\"\n\t\t},\n\t\t{\n\t\t\t\"path\": \"./b\\\"q\"\n\t\t}\n\t]\n}\n"},
	{"insertAfterComma", "{\n  \"a\": 1,\n}\n", []string{"../a/tsconfig.json", "./b\"q"}, "{\n  \"a\": 1,,\n  \"references\": [\n    {\n      \"path\": \"../a/tsconfig.json\"\n    },\n    {\n      \"path\": \"./b\\\"q\"\n    }\n  ]\n}\n"},
	{"comments", "// c\n{\n  /* x */ \"references\": [ // t\n    {\"path\": \"a\"},\n  ],\n  \"b\": 2\n}\n", []string{"../a/tsconfig.json", "./b\"q"}, "// c\n{\n  /* x */ \"references\": [\n  {\n    \"path\": \"../a/tsconfig.json\"\n  },\n  {\n    \"path\": \"./b\\\"q\"\n  }\n],\n  \"b\": 2\n}\n"},
	{"empty", "{\n  \"references\": [{\"path\":\"x\"}]\n}\n", []string{}, "{\n  \"references\": []\n}\n"},
	{"crlf", "{\r\n  \"extends\": \"x\",\r\n  \"references\": []\r\n}\r\n", []string{"../a/tsconfig.json", "./b\"q"}, "{\r\n  \"extends\": \"x\",\r\n  \"references\": [\n    {\n      \"path\": \"../a/tsconfig.json\"\n    },\n    {\n      \"path\": \"./b\\\"q\"\n    }\n  ]\r\n}\r\n"},
	{"nested", "{\n  \"compilerOptions\": { \"references\": 1 },\n  \"references\": []\n}\n", []string{"../a/tsconfig.json", "./b\"q"}, "{\n  \"compilerOptions\": { \"references\": 1 },\n  \"references\": [\n    {\n      \"path\": \"../a/tsconfig.json\"\n    },\n    {\n      \"path\": \"./b\\\"q\"\n    }\n  ]\n}\n"},
}

var localeCompareCases = []struct {
	a, b string
	want int
}{
	{"apiKeyServer", "agentServer", 1},
	{"authServer", "auditLogServer", 1},
	{"a-b", "ab", -1},
	{"ab", "Ab", -1},
	{"Ab", "ab", 1},
	{"a", "B", -1},
	{"B", "a", 1},
	{"api-key", "apikey", -1},
	{"x1", "x10", -1},
	{"x2", "x10", 1},
	{"a.ts", "a.tsx", -1},
	{"browser-drawers.ts", "browserDrawers.ts", -1},
	{"A", "a", 1},
	{"", "a", -1},
	{"abc", "ab", 1},
	{"a_b", "a-b", -1},
	{"a b", "a-b", -1},
	{"Zed", "apple", 1},
	{"api-key", "api-keys", -1},
	{"model-provider", "modelProvider", -1},
	{"_a", "a", -1},
}
