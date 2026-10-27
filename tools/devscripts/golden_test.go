package devscripts

// Fixtures and golden text below were produced by running the original Node
// script (dev/scripts/generate-modules.mjs) over the same inputs.

var generateModulesFixture = map[string]string{
	"pnpm-workspace.yaml":                             "packages:\n  - x\n",
	"modules/catalogue.json":                          "{\n  \"version\": 0,\n  \"features\": [\n    {\n      \"id\": \"alpha\",\n      \"root\": \"modules/alpha\"\n    },\n    {\n      \"id\": \"beta-mod\",\n      \"root\": \"modules/beta-mod\"\n    },\n    {\n      \"id\": \"gamma\",\n      \"root\": \"modules/gamma\"\n    },\n    {\n      \"id\": \"delta\",\n      \"root\": \"modules/delta\"\n    }\n  ]\n}\n",
	"modules/alpha/process/package.json":              "{\n  \"name\": \"@lw/alpha-process\",\n  \"version\": \"0.0.0\",\n  \"main\": \"src/index.ts\"\n}\n",
	"modules/alpha/process/src/alpha.module.ts":       "export const alphaProcessModule = {};\n",
	"modules/alpha/process/src/index.ts":              "export { alphaProcessModule } from './alpha.module.ts';\n",
	"modules/alpha/process/src/app/alpha.app.ts":      "export class A {\n  static readonly reads = reads([\"postgres\", 'redis', `clickhouse`]);\n}\n",
	"modules/alpha/browser/package.json":              "{\n  \"name\": \"@lw/alpha-browser\",\n  \"exports\": {\n    \"./declaration\": \"./src/alpha.web.ts\"\n  }\n}\n",
	"modules/alpha/browser/src/alpha.web.ts":          "export const alphaWeb = { name: \"alpha\" };\n",
	"modules/alpha/contract/package.json":             "{\n  \"name\": \"@lw/alpha-contract\"\n}\n",
	"modules/alpha/contract/src/alpha.config.ts":      "export const alphaServerConfigSchema = {};\n",
	"modules/alpha/contract/src/index.ts":             "export * from \"./alpha.config.ts\";\n",
	"modules/beta-mod/process/package.json":           "{\n  \"name\": \"@lw/beta\",\n  \"version\": \"1.0.0\"\n}\n",
	"modules/beta-mod/process/src/beta-mod.module.ts": "export const betaModProcessModule = {};\n",
	"modules/beta-mod/process/src/index.ts":           "export const betaModProcessModule = 1;\n",
	"modules/beta-mod/process/src/app/beta.app.ts":    "export class B { static readonly reads = [\"redis\", \"clickhouse\"] as const; }\n",
	"modules/gamma/process/package.json":              "{\n  \"name\": \"@lw/gamma-process\"\n}\n",
	"modules/gamma/process/src/gamma.module.ts":       "export const other = 1;\n",
	"modules/gamma/process/src/index.ts":              "export const gammaServerish = 1;\n",
	"modules/gamma/process/src/app/gamma.app.ts":      "export class G {}\n",
	"modules/gamma/browser/package.json":              "{\n  \"name\": \"@lw/gamma-browser\",\n  \"exports\": {\n    \"./declaration\": {\n      \"langwatch-declaration-source\": \"./src/gamma.web.ts\",\n      \"default\": \"./x\"\n    }\n  }\n}\n",
	"modules/gamma/browser/src/gamma.web.ts":          "export const gammaWeb = { name: \"gamma\" };\n",
	"modules/delta/process/package.json":              "{\n  \"name\": \"@lw/delta-process\"\n}\n",
	"apps/api/package.json":                           "{\n  \"name\": \"@lw/api\",\n  \"dependencies\": {\n    \"@lw/alpha-process\": \"workspace:*\",\n    \"zod\": \"catalog:\"\n  },\n  \"scripts\": {\n    \"typecheck\": \"tsc\"\n  }\n}\n",
	"apps/worker/package.json":                        "{\n  \"name\": \"@lw/worker\",\n  \"private\": true\n}\n",
	"apps/tasks/package.json":                         "{\n  \"name\": \"@lw/tasks\",\n  \"dependencies\": {\n    \"aaa\": \"workspace:*\"\n  }\n}\n",
	"apps/ui/package.json":                            "{\n  \"name\": \"@lw/ui\",\n  \"private\": true\n}\n",
}

var generateModulesGolden = map[string]string{
	"apps/api/src/process-modules.generated.ts":    "/** Generated from modules/catalogue.json. Do not edit by hand. */\n/** Run `pnpm generate:modules` to rewrite it. */\n\nimport { alphaProcessModule } from \"@lw/alpha-process\";\nimport { betaModProcessModule } from \"@lw/beta\";\n\n/** Every installed module's server declaration, in name order. */\nexport const processModules = [\n  alphaProcessModule,\n  betaModProcessModule,\n] as const;\n",
	"apps/api/package.json":                        "{\n  \"name\": \"@lw/api\",\n  \"dependencies\": {\n    \"@lw/alpha-process\": \"workspace:*\",\n    \"@lw/beta\": \"workspace:*\",\n    \"zod\": \"catalog:\"\n  },\n  \"scripts\": {\n    \"typecheck\": \"tsc\"\n  }\n}\n",
	"apps/worker/src/process-modules.generated.ts": "/** Generated from modules/catalogue.json. Do not edit by hand. */\n/** Run `pnpm generate:modules` to rewrite it. */\n\nimport { alphaProcessModule } from \"@lw/alpha-process\";\nimport { betaModProcessModule } from \"@lw/beta\";\n\n/** Every installed module's server declaration, in name order. */\nexport const processModules = [\n  alphaProcessModule,\n  betaModProcessModule,\n] as const;\n",
	"apps/worker/package.json":                     "{\n  \"name\": \"@lw/worker\",\n  \"private\": true,\n  \"dependencies\": {\n    \"@lw/alpha-process\": \"workspace:*\",\n    \"@lw/beta\": \"workspace:*\"\n  }\n}\n",
	"apps/tasks/src/process-modules.generated.ts":  "/** Generated from modules/catalogue.json. Do not edit by hand. */\n/** Run `pnpm generate:modules` to rewrite it. */\n\nimport { alphaProcessModule } from \"@lw/alpha-process\";\nimport { betaModProcessModule } from \"@lw/beta\";\n\n/** Every installed module's server declaration, in name order. */\nexport const processModules = [\n  alphaProcessModule,\n  betaModProcessModule,\n] as const;\n",
	"apps/tasks/package.json":                      "{\n  \"name\": \"@lw/tasks\",\n  \"dependencies\": {\n    \"@lw/alpha-process\": \"workspace:*\",\n    \"@lw/beta\": \"workspace:*\",\n    \"aaa\": \"workspace:*\"\n  }\n}\n",
	"apps/ui/src/browser-modules.generated.ts":     "/** Generated from modules/catalogue.json. Do not edit by hand. */\n/** Run `pnpm generate:modules` to rewrite it. */\n\nimport { alphaWeb } from \"@lw/alpha-browser/declaration\";\nimport { gammaWeb } from \"@lw/gamma-browser/declaration\";\n\n/** Every installed module's web declaration, in name order. */\nexport const browserModules = [\n  alphaWeb satisfies { readonly name: \"alpha\" },\n  gammaWeb satisfies { readonly name: \"gamma\" },\n] as const;\ntype PairedOnDisk = \"alpha\" | \"gamma\";\ntype ServerHalfOnDisk = \"alpha\" | \"beta-mod\";\ntype MissingWeb = Exclude<PairedOnDisk, (typeof browserModules)[number][\"name\"]>;\ntype MissingServer = Exclude<PairedOnDisk, ServerHalfOnDisk>;\nexport const webModulePairing = {} satisfies {\n  [Id in `missing web half \"${MissingWeb}\"` | `missing server half \"${MissingServer}\"`]: never;\n};\n",
	"apps/ui/package.json":                         "{\n  \"name\": \"@lw/ui\",\n  \"private\": true,\n  \"dependencies\": {\n    \"@lw/alpha-browser\": \"workspace:*\",\n    \"@lw/gamma-browser\": \"workspace:*\"\n  }\n}\n",
}

const generateModulesStdout = "Wrote apps/api/src/process-modules.generated.ts\nWrote apps/api/package.json\nWrote apps/worker/src/process-modules.generated.ts\nWrote apps/worker/package.json\nWrote apps/tasks/src/process-modules.generated.ts\nWrote apps/tasks/package.json\nWrote apps/ui/src/browser-modules.generated.ts\nWrote apps/ui/package.json\n"

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
