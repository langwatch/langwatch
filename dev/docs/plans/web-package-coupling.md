# What the web packages already import from each other

Measured 2026-09-17 on `feat/strict-feature-layout-v0`, for the surface
vocabulary question in
[ADR-148](../adr/148-declared-browser-supply.md). Re-run the commands rather
than trusting the numbers.

## The export surface today

35 web packages publish **276** export entries.

| first path segment | entries |
| --- | --- |
| `surfaces/` | 104 |
| `drawers/` | 12 |
| `testing/` | 5 |
| root (`.`) | 15 |
| **one-off namespaces** | **140** |

So a vocabulary already exists and already carries most of the weight -
`surfaces` alone is 104 of 276 - and beside it sit 140 namespaces each invented
once by one package: `./annotations`, `./api-keys`, `./auth`, `./analytics`,
`./agent-editors`, `./workflow-api`. The packages inventing the most are
`workflow` (33), `experiment` (13), `prompt` (12), `model-provider` (11),
`dataset` (9) and `evaluator` (9).

```bash
node -e 'const {readFileSync}=require("node:fs");const {execFileSync}=require("node:child_process");
const p=execFileSync("sh",["-c","ls modules/*/web/package.json"],{encoding:"utf8"}).split("\n").filter(Boolean);
const k=new Map();for(const f of p){const e=JSON.parse(readFileSync(f,"utf8")).exports||{};
for(const x of Object.keys(e)){const s=x.replace(/^\.\/?/,"").split("/")[0]||"(root)";k.set(s,(k.get(s)||0)+1)}}
console.log([...k].sort((a,b)=>b[1]-a[1]))'
```

## Cross-package imports are the status quo, not a proposal

**75** import edges already run between one module's web package and another's.
`trace` is imported by `evaluator`, `experiment`, `gateway`, `langy`, `project`,
`prompt`, `scenario` and `workflow`, and itself imports twelve other modules
including `annotation`. Any design that forbids peer-to-peer web imports is
therefore not a rule, it is a rewrite of 75 call sites.

## Nine pairs are already cyclic

```
dataset   <-> workflow      evaluator <-> workflow     evaluator <-> experiment
evaluator <-> trace         experiment <-> workflow    experiment <-> prompt
langy     <-> trace         prompt <-> workflow        scenario  <-> trace
```

This is the finding that should shape the vocabulary. A cycle is not equally bad
in every kind of export:

- **components rendered with props** - a cycle is a build-graph curiosity, since
  nothing carries state across it;
- **hooks, context and stores** - a cycle is load-order dependent at runtime, and
  that is a real defect rather than an untidiness.

And the second kind is already travelling under the first kind's name:
`experiment` imports `@langwatch/langy-web/surfaces/langy-store` and
`/surfaces/langy-context`. A store and a context are published as "surfaces",
so the existing vocabulary cannot tell the safe case from the dangerous one.

## What the measurement suggests

A closed vocabulary of entry kinds, with the kinds distinguished by what a cycle
through them costs rather than by what the code looks like:

| kind | what it holds | may cross a module boundary |
| --- | --- | --- |
| `surfaces/` | components mounted by a host, props in | yes |
| `embeddables/` | components another module renders in its own tree | yes |
| `drawers/` | drawer components, registered centrally by the shell | never peer-to-peer; the shell mounts them |
| `wiring/` | hooks, context, stores - anything holding state | **application only, not peer-to-peer** |
| `testing/` | fixtures and harnesses, never in the production graph | yes, test scope only |

The 140 one-off namespaces then sort into those five, which is mechanical. The
work that is not mechanical is the handful of current cross-module imports that
are `wiring` in substance whatever they are named - the langy store and context
being the known ones - and each of those is a decision about who owns the state,
not a rename.

```bash
# the edges and the cycles
node -e 'const {readFileSync}=require("node:fs");const {execFileSync}=require("node:child_process");
const f=execFileSync("sh",["-c","grep -rl \"@langwatch/[a-z-]*-web\" modules/*/web/src --include=*.ts --include=*.tsx"],{encoding:"utf8"}).split("\n").filter(Boolean);
const e=new Set();for(const x of f){const o=x.split("/")[1];const s=readFileSync(x,"utf8");
for(const m of s.matchAll(/from\s+"@langwatch\/([a-z-]+)-web/g))if(m[1]!==o)e.add(o+">"+m[1])}
console.log(e.size,[...e].filter(k=>{const[a,b]=k.split(">");return e.has(b+">"+a)}))'
```
