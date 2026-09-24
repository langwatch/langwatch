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
const LIST_VOCABULARY = /^list([A-Z]|$)/;
const FIND_VOCABULARY = /^find([A-Z]|$)/;

// ADR-146's derivations: absence from one means "the input carried none".
// `resolve*` and `read*` stay governed and are decided per call site.
const DERIVATION_VOCABULARY =
  /^(parse|extract|build|stringify|serialize|serialise|deserialize|deserialise|format|render|normalize|normalise|coerce|decode|encode|convert|derive|compute|translate|project|visit|as|to|infer|classify|detect|pick|describe|map|fold|reduce)([A-Z]|$)/;

// ADR-146: a vendor's callback interface dictates its implementer's name and shape.
const INTERNAL_SPECIFIER = /^(?:\.|\/|#|@langwatch\/|langwatch(?:\/|$))/;
const TYPE_WRAPPERS = new Set(["NonNullable", "Readonly", "Required"]);
// A page (ADR-146's `list*`) is an object carrying an array and a position in the whole.
const PAGE_POSITION_MEMBER =
  /^(cursor|nextCursor|previousCursor|prevCursor|next|nextPage|nextPageToken|pageToken|nextOffset|hasMore|hasNextPage|total|totalCount|totalHits|totalItems)$/;
const OPAQUE_ANSWER = new Set([
  "TSAnyKeyword",
  "TSNeverKeyword",
  "TSUnknownKeyword",
  "TSVoidKeyword",
]);

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
  return node?.type === "TSTypeReference" && node.typeName?.type === "Identifier"
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

/** Local names bound by an import from a vendor package: not `@langwatch/*`, not relative. */
export function vendorImportedNames(program) {
  const names = new Set();
  for (const statement of program.body) {
    if (statement.type !== "ImportDeclaration") continue;
    if (INTERNAL_SPECIFIER.test(statement.source.value)) continue;
    for (const specifier of statement.specifiers) names.add(specifier.local.name);
  }
  return names;
}

function rootIdentifierName(node) {
  if (node?.type === "Identifier") return node.name;
  if (node?.type === "TSQualifiedName") return rootIdentifierName(node.left);
  if (node?.type === "MemberExpression") return rootIdentifierName(node.object);
  return undefined;
}

/** `Vendor`, `Vendor.Hook`, `Vendor["hook"]` and `NonNullable<Vendor>` all head at `Vendor`. */
function typeHeadName(node) {
  if (node?.type === "TSParenthesizedType") return typeHeadName(node.typeAnnotation);
  if (node?.type === "TSIndexedAccessType") return typeHeadName(node.objectType);
  if (node?.type !== "TSTypeReference") return undefined;
  const name = rootIdentifierName(node.typeName);
  if (!TYPE_WRAPPERS.has(name)) return name;
  return typeHeadName(node.typeArguments?.params?.[0]);
}

/** A method of a class whose every `implements`/`extends` names a vendor import. */
export function isVendorShapedMethod(method, vendorNames) {
  const owner = method.parent?.parent;
  const heritage = (owner?.implements ?? []).map((clause) => rootIdentifierName(clause.expression));
  if (owner?.superClass) heritage.push(rootIdentifierName(owner.superClass));
  return heritage.length > 0 && heritage.every((name) => vendorNames.has(name));
}

/** A `const hook: Vendor["hook"] = …` whose declared type is a vendor import. */
export function isVendorTypedDeclarator(declarator, vendorNames) {
  return vendorNames.has(typeHeadName(declarator.id?.typeAnnotation?.typeAnnotation));
}

function interfacesOf(program) {
  const interfaces = [];
  for (const statement of program.body) {
    const declaration =
      statement.type === "ExportNamedDeclaration" ? statement.declaration : statement;
    if (declaration?.type === "TSInterfaceDeclaration") interfaces.push(declaration);
  }
  return interfaces;
}

function objectMembers(node) {
  if (node?.type === "TSParenthesizedType") return objectMembers(node.typeAnnotation);
  if (node?.type === "TSTypeLiteral") return node.members;
  if (node?.type === "TSInterfaceBody") return node.body;
  return undefined;
}

function propertyName(member) {
  if (member.type !== "TSPropertySignature" || member.computed) return undefined;
  return member.key?.type === "Identifier" ? member.key.name : undefined;
}

function isPluralType(node, plural) {
  return containsArrayType(node) || plural.has(referencedName(node));
}

/** An object type with a required array member plus a cursor, next or total member. */
function isPageObject(node, { pages, plural }) {
  if (pages.has(referencedName(node))) return true;
  const members = objectMembers(node);
  if (!members) return false;
  const carriesItems = members.some(
    (member) => !member.optional && isPluralType(member.typeAnnotation?.typeAnnotation, plural),
  );
  const carriesPosition = members.some((member) =>
    PAGE_POSITION_MEMBER.test(propertyName(member) ?? ""),
  );
  return carriesItems && carriesPosition;
}

function pageAliasesOf(program, plural) {
  const pages = new Set();
  const shapes = { pages, plural };
  for (const declaration of interfacesOf(program)) {
    if (isPageObject(declaration.body, shapes)) pages.add(declaration.id.name);
  }
  for (const alias of typeAliasesOf(program)) {
    if (isPageObject(alias.typeAnnotation, shapes)) pages.add(alias.id.name);
  }
  return pages;
}

/** This file's type aliases that answer null or undefined, an array, or a page. */
export function aliasShapesOf(program) {
  const plural = new Set();
  for (const alias of typeAliasesOf(program)) {
    if (containsArrayType(alias.typeAnnotation)) plural.add(alias.id.name);
  }
  return { nullable: nullableAliasesOf(program), plural, pages: pageAliasesOf(program, plural) };
}

function answerMembers(node) {
  if (node?.type === "TSParenthesizedType") return answerMembers(node.typeAnnotation);
  if (node?.type === "TSUnionType") return node.types.flatMap(answerMembers);
  const promiseArgument = promiseTypeArgument(node);
  return promiseArgument ? answerMembers(promiseArgument) : [node];
}

function isOneValue(node, { nullable, plural }) {
  if (OPAQUE_ANSWER.has(node.type) || node.type === "TSTupleType" || containsArrayType(node))
    return false;
  const name = referencedName(node);
  return !nullable.has(name) && !plural.has(name);
}

function presentAnswerMembers(returnType) {
  return answerMembers(returnType).filter(
    (member) => member.type !== "TSNullKeyword" && member.type !== "TSUndefinedKeyword",
  );
}

/** Whether the declared answer, null and undefined set aside, is a page (`{ items, cursor }`). */
export function answersPage(returnType, aliasShapes) {
  if (!returnType) return false;
  const present = presentAnswerMembers(returnType);
  return present.length > 0 && present.every((member) => isPageObject(member, aliasShapes));
}

/** Whether the declared answer, null and undefined set aside, is one value and never an array. */
export function answersOneValue(returnType, aliasShapes) {
  if (!returnType) return false;
  const present = presentAnswerMembers(returnType);
  return present.length > 0 && present.every((member) => isOneValue(member, aliasShapes));
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

/** `getById` -> `ById`, so `get{{rest}}` names the one-or-throw read. */
export function oneValueRest(name) {
  return name.slice("get".length);
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

/** A named, non-computed method the naming rules govern: not a vendor callback. */
export function isGovernedMethod(node, vendorNames) {
  if (node.kind !== "method" || node.computed) return false;
  return !isVendorShapedMethod(node, vendorNames);
}

/** The function a module-scope const holds, unless a vendor type dictates it. */
export function governedDeclaratorFunction(node, vendorNames) {
  const init = node.init;
  if (init?.type !== "ArrowFunctionExpression" && init?.type !== "FunctionExpression") return;
  if (!isModuleScopeDeclarator(node) || isVendorTypedDeclarator(node, vendorNames)) return;
  return init;
}

// ADR-146: a repository's unpaged `list*` becomes `find*`, its page stays `list*`,
// and a one-value `get*` keeps its verb.
function reportRepositoryVocabulary(context, { key, oneValue }) {
  const name = key.name;
  if (oneValue && GET_VOCABULARY.test(name)) {
    const data = { name, rest: oneValueRest(name) };
    context.report({ node: key, messageId: "repositoryOneValue", data });
    return;
  }
  const data = { name, rest: repositoryVocabularyRest(name) };
  context.report({ node: key, messageId: "repositoryServiceVocabulary", data });
}

function isPagedList(name, returnType, aliasShapes) {
  return LIST_VOCABULARY.test(name) && answersPage(returnType, aliasShapes);
}

function reportResult(context, { aliasShapes, key, repositoryVocabulary, returnType }) {
  const name = key.name;
  const nullableAliases = aliasShapes.nullable;
  if (FIND_VOCABULARY.test(name) && answersPage(returnType, aliasShapes)) {
    const data = { name, rest: name.slice("find".length) };
    context.report({ node: key, messageId: "findAnswersPage", data });
    return;
  }
  const oneValue = answersOneValue(returnType, aliasShapes);
  const isRepositoryVocabularyName =
    repositoryVocabulary &&
    REPOSITORY_SERVICE_VOCABULARY.test(name) &&
    !isOneOrThrowGet(name, returnType, nullableAliases) &&
    !isPagedList(name, returnType, aliasShapes);
  if (isRepositoryVocabularyName) reportRepositoryVocabulary(context, { key, oneValue });
  const scope = { isRepositoryVocabularyName, nullableAliases };
  if (returnType && shouldReportNullableWithoutFind(name, returnType, scope)) {
    const messageId = oneValue ? "nullableOneValue" : "nullableWithoutFind";
    context.report({ node: key, messageId, data: { name } });
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
    nullableOneValue: {
      what: "`{{name}}` answers one value or null or undefined, which is not a shape new code writes.",
      why: "`find` states cardinality: it answers an array, and this answers one value.",
      fix:
        "Make it one-or-throw: name it `get<Noun>` — or `getBy<Key>` when the key is what" +
        " distinguishes it — throw the domain error when the value does not exist, and drop" +
        " null and undefined from the return type. If absence means something other than" +
        " not-found, return an explicit result union naming that outcome instead. Do not" +
        " rename it `find*`: `find` answers an array.",
    },
    repositoryServiceVocabulary: {
      what: "Repository method `{{name}}` uses service vocabulary; repositories answer `find*`, services answer `get*`.",
      fix: "Rename it `find{{rest}}` here and in the repository interface this class implements.",
    },
    findAnswersPage: {
      what: "`{{name}}` answers a page, and `find` answers an array.",
      why: "A page carries a position in a larger whole; `find` promises the whole answer, empty when there is none.",
      fix:
        "Rename it `list{{rest}}` here, in the interface it implements and at every caller:" +
        " a page is `list*` in a service or a repository. If it really answers every match," +
        " drop the cursor or total and return the array under `find{{rest}}`.",
    },
    repositoryOneValue: {
      what: "Repository method `{{name}}` answers one value, which a repository names `get*` and answers or throws.",
      why: "`find` answers an array, so renaming a one-value read to `find*` misstates its cardinality.",
      fix:
        "Name it `get{{rest}}`, throw the module's not-found error when the value does not" +
        " exist and drop null and undefined from the return type, here and in the repository" +
        " interface this class implements. If absence means something other than not-found," +
        " return an explicit result union naming that outcome instead. Do not rename it" +
        " `find{{rest}}`.",
    },
  },
  create(context, file) {
    const isRepositoryVocabularyFile = REPOSITORY_METHOD_FILE.test(file.workspacePath ?? "");
    let aliasShapes = { nullable: new Set(), plural: new Set(), pages: new Set() };
    let vendorNames = new Set();

    const check = (key, returnType, { accessibility, allowRepositoryVocabulary = false } = {}) => {
      if (key?.type !== "Identifier" || accessibility === "private") return;
      reportResult(context, {
        aliasShapes,
        key,
        repositoryVocabulary: allowRepositoryVocabulary && isRepositoryVocabularyFile,
        returnType,
      });
    };

    const checkMethod = (node) => {
      if (!isGovernedMethod(node, vendorNames)) return;
      check(node.key, node.value?.returnType?.typeAnnotation, {
        accessibility: node.accessibility,
        allowRepositoryVocabulary: true,
      });
    };

    return {
      Program(node) {
        aliasShapes = aliasShapesOf(node);
        vendorNames = vendorImportedNames(node);
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
        const init = governedDeclaratorFunction(node, vendorNames);
        if (init) check(node.id, init.returnType?.typeAnnotation);
      },
    };
  },
});
