import { defineRule } from "../define-rule.mjs";

// A result names its absence contract (ADR-146): `get*` answers one or throws,
// `find*` answers an array, a derivation may answer undefined, and nothing new
// answers null. The `try*`/`require*` prefixes are `langwatch/banned-verb-prefix`'s.
const FALLIBLE_RESULT_MODULE =
  /^src\/(?!.*__tests__\/)(?!.*\.fixture\.ts$)(?!.*\.test\.ts$).*\.ts$/;

const TRY_PREFIX = /^try[A-Z]/;

// A repository answers `find*`; `get*`/`list*` is service vocabulary (ADR-146).
// Scoped by path so this stays a per-file syntactic check.
const REPOSITORY_METHOD_FILE = /\/repositories\/(?:prisma\/|memory\/)?[^/]*\.repository\.ts$/;
const REPOSITORY_SERVICE_VOCABULARY = /^(get|list)([A-Z]|$)/;
const GET_VOCABULARY = /^get([A-Z]|$)/;

// ADR-146's derivations: absence from one means "the input carried none".
// `resolve*` and `read*` stay governed and are decided per call site.
const DERIVATION_VOCABULARY =
  /^(parse|extract|build|stringify|serialize|serialise|deserialize|deserialise|format|render|normalize|normalise|coerce|decode|encode|convert|derive|compute|translate|project|visit|as|to|infer|classify|detect|pick|describe|map|fold|reduce)([A-Z]|$)/;

/** Shared with `banned-verb-prefix`, which owns the `try*` naming defect. */
export function isTryPrefixedName(name) {
  return TRY_PREFIX.test(name);
}

function promiseTypeArgument(node) {
  if (node.type !== "TSTypeReference") return undefined;
  if (node.typeName?.type !== "Identifier" || node.typeName.name !== "Promise") return undefined;
  const parameters = node.typeArguments?.params ?? [];
  return parameters.length === 1 ? parameters[0] : undefined;
}

function referencedName(node) {
  return node.type === "TSTypeReference" && node.typeName?.type === "Identifier"
    ? node.typeName.name
    : undefined;
}

/** `nullableAliases` holds this file's type aliases that answer null or undefined. */
function containsNullableType(node, nullableAliases) {
  if (!node) return false;
  if (node.type === "TSUndefinedKeyword" || node.type === "TSNullKeyword") return true;
  if (node.type === "TSParenthesizedType")
    return containsNullableType(node.typeAnnotation, nullableAliases);
  if (node.type === "TSUnionType")
    return node.types.some((type) => containsNullableType(type, nullableAliases));
  if (nullableAliases.has(referencedName(node))) return true;
  const promiseArgument = promiseTypeArgument(node);
  if (promiseArgument) return containsNullableType(promiseArgument, nullableAliases);
  return false;
}

function typeAliasesOf(program) {
  const aliases = [];
  for (const statement of program.body) {
    const declaration =
      statement.type === "ExportNamedDeclaration" ? statement.declaration : statement;
    if (declaration?.type === "TSTypeAliasDeclaration") aliases.push(declaration);
  }
  return aliases;
}

/** `type Maybe<T> = T | null`, and any alias built on one, until nothing new is found. */
function nullableAliasesOf(program) {
  const nullable = new Set();
  const pending = typeAliasesOf(program);
  let grew = true;
  while (grew) {
    grew = false;
    for (const alias of pending) {
      if (nullable.has(alias.id.name) || !containsNullableType(alias.typeAnnotation, nullable))
        continue;
      nullable.add(alias.id.name);
      grew = true;
    }
  }
  return nullable;
}

/** Whether the declared result is an array, looking through `Promise<...>`. */
function containsArrayType(node) {
  if (!node) return false;
  if (node.type === "TSArrayType") return true;
  if (node.type === "TSParenthesizedType") return containsArrayType(node.typeAnnotation);
  const name = referencedName(node);
  if (name === "Array" || name === "ReadonlyArray") return true;
  const promiseArgument = promiseTypeArgument(node);
  if (promiseArgument) return containsArrayType(promiseArgument);
  return false;
}

/** The one-or-throw shape, which is what `get` means and what a repository may keep. */
function isOneOrThrowGet(name, returnType, nullableAliases) {
  if (!GET_VOCABULARY.test(name) || !returnType) return false;
  return !containsNullableType(returnType, nullableAliases) && !containsArrayType(returnType);
}

export function isFallibleResultModule(file) {
  if (file.role !== "contract" && file.role !== "process") return false;
  if (!file.relative?.startsWith("src/")) return false;
  return FALLIBLE_RESULT_MODULE.test(file.relative);
}

export function withoutPrefix(name, prefix) {
  const rest = name.slice(prefix.length);
  return rest.charAt(0).toLowerCase() + rest.slice(1);
}

/** `getById` -> `ById` (so `find{{rest}}` reads `findById`); a bare `get`/`list` -> `All`. */
export function repositoryVocabularyRest(name) {
  if (name === "get" || name === "list") return "All";
  return name.startsWith("get") ? name.slice("get".length) : name.slice("list".length);
}

// A `try*` name's rename belongs to `banned-verb-prefix`, and a repository
// get*/list* name's to `repositoryServiceVocabulary` — each prescribes it once.
function shouldReportNullableWithoutFind(
  name,
  returnType,
  { isRepositoryVocabularyName, nullableAliases },
) {
  if (!containsNullableType(returnType, nullableAliases)) return false;
  if (/^find[A-Z]?/.test(name) || isTryPrefixedName(name)) return false;
  if (isRepositoryVocabularyName) return false;
  return !DERIVATION_VOCABULARY.test(name);
}

function isModuleScopeDeclarator(node) {
  const owner = node.parent?.parent;
  return owner?.type === "Program" || owner?.type === "ExportNamedDeclaration";
}

function reportResult(context, { key, nullableAliases, repositoryVocabulary, returnType }) {
  const name = key.name;
  const isRepositoryVocabularyName =
    repositoryVocabulary &&
    REPOSITORY_SERVICE_VOCABULARY.test(name) &&
    !isOneOrThrowGet(name, returnType, nullableAliases);
  if (isRepositoryVocabularyName) {
    const rest = repositoryVocabularyRest(name);
    context.report({ node: key, messageId: "repositoryServiceVocabulary", data: { name, rest } });
  }
  const scope = { isRepositoryVocabularyName, nullableAliases };
  if (returnType && shouldReportNullableWithoutFind(name, returnType, scope)) {
    context.report({ node: key, messageId: "nullableWithoutFind", data: { name } });
  }
}

export const fallibleResultNamingRule = defineRule({
  name: "fallible-result-naming",
  kind: "problem",
  applies: isFallibleResultModule,
  messages: {
    nullableWithoutFind: {
      what: "`{{name}}` answers null or undefined, which is not a shape new code writes.",
      why: "A caller cannot tell whether absence here is an ordinary answer or a failure.",
      fix:
        "Decide what the absence means. If it is one thing that may not exist, name it" +
        " `get<Noun>` — or `getBy<Key>` when the key is what distinguishes it — and" +
        " throw the domain error, dropping null and undefined from the return type, so" +
        " the caller gets the answer or the reason there is none. If it is really none" +
        " or many, return an array and name it `find<Noun>`: the empty array is the" +
        " absence. If it is a write whose target may normally be absent, return an" +
        " explicit result union. Do not answer this by adding a nullable `find*` —" +
        " `find` states cardinality, and the existing nullable ones are left as they" +
        " are rather than joined by new ones.",
    },
    repositoryServiceVocabulary: {
      what: "Repository method `{{name}}` uses service vocabulary; repositories answer `find*`, services answer `get*`.",
      fix: "Rename it `find{{rest}}` here and in the repository interface this class implements.",
    },
  },
  create(context, file) {
    const isRepositoryVocabularyFile = REPOSITORY_METHOD_FILE.test(file.workspacePath ?? "");
    let nullableAliases = new Set();

    const check = (key, returnType, { accessibility, allowRepositoryVocabulary = false } = {}) => {
      if (key?.type !== "Identifier" || accessibility === "private") return;
      reportResult(context, {
        key,
        nullableAliases,
        repositoryVocabulary: allowRepositoryVocabulary && isRepositoryVocabularyFile,
        returnType,
      });
    };

    const checkMethod = (node) => {
      if (node.kind !== "method" || node.computed) return;
      check(node.key, node.value?.returnType?.typeAnnotation, {
        accessibility: node.accessibility,
        allowRepositoryVocabulary: true,
      });
    };

    return {
      Program(node) {
        nullableAliases = nullableAliasesOf(node);
      },
      MethodDefinition: checkMethod,
      TSAbstractMethodDefinition: checkMethod,
      TSMethodSignature(node) {
        if (node.computed) return;
        check(node.key, node.returnType?.typeAnnotation, { allowRepositoryVocabulary: true });
      },
      FunctionDeclaration(node) {
        check(node.id, node.returnType?.typeAnnotation);
      },
      VariableDeclarator(node) {
        const init = node.init;
        if (init?.type !== "ArrowFunctionExpression" && init?.type !== "FunctionExpression") return;
        if (isModuleScopeDeclarator(node)) check(node.id, init.returnType?.typeAnnotation);
      },
    };
  },
});
