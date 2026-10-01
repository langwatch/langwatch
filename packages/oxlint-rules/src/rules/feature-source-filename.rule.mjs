import {
  CANONICAL_ARTIFACTS,
  isLowerKebabFilename,
  isStrictProcessFilename,
  PROCESS_QUALIFIERS,
  QUALIFIED_ARTIFACTS,
} from "../../grammar/feature-layout-policy.mjs";
import { defineRule } from "../define-rule.mjs";

const ALLOWED_ARTIFACTS = [...CANONICAL_ARTIFACTS].toSorted().join(", ");

function extensionOf(name) {
  return name.match(/\.[cm]?[jt]sx?$/)?.[0];
}

function toKebabWords(text) {
  return text
    .replace(/([a-z0-9])([A-Z])/g, "$1-$2")
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1-$2")
    .replace(/[_\s]+/g, "-")
    .replace(/-+/g, "-")
    .toLowerCase();
}

// `prisma-agent.repository.ts` is refused only because the qualifier is
// hyphen-joined to the subject; `prisma.agent.repository.ts` is always the fix.
function qualifierPrefixRename(name) {
  const extension = extensionOf(name);
  if (!extension) return undefined;
  const parts = name.slice(0, -extension.length).split(".");
  if (parts.length !== 2 || !QUALIFIED_ARTIFACTS.has(parts[1])) return undefined;
  const qualifier = PROCESS_QUALIFIERS.find((candidate) => parts[0].startsWith(`${candidate}-`));
  if (!qualifier) return undefined;
  return `${qualifier}.${parts[0].slice(qualifier.length + 1)}.${parts[1]}${extension}`;
}

// A casing/shape violation (`AgentService.service.ts`, `AgentService.ts`,
// `agent_service.ts`): kebab-case every word and drop a subject word that
// only repeats the artifact, e.g. `AgentService.service.ts` -> `agent.service.ts`.
function kebabCaseRename(name) {
  const extension = extensionOf(name);
  if (!extension) return undefined;
  const rawParts = name.slice(0, -extension.length).split(".");
  const lastRaw = rawParts.at(-1)?.toLowerCase();

  let artifact;
  let subjectWords;
  if (rawParts.length > 1 && CANONICAL_ARTIFACTS.has(lastRaw)) {
    artifact = lastRaw;
    subjectWords = toKebabWords(rawParts.slice(0, -1).join("-")).split("-").filter(Boolean);
  } else {
    const words = toKebabWords(rawParts.join("-")).split("-").filter(Boolean);
    const tail = words.at(-1);
    if (words.length < 2 || !CANONICAL_ARTIFACTS.has(tail)) return undefined;
    artifact = tail;
    subjectWords = words.slice(0, -1);
  }

  if (subjectWords.length > 1 && subjectWords.at(-1) === artifact) {
    subjectWords = subjectWords.slice(0, -1);
  }
  if (subjectWords.length === 0) return undefined;

  return `${subjectWords.join("-")}.${artifact}${extension}`;
}

function suggestFilename(source) {
  if (source.role === "process") {
    const qualifierFix = qualifierPrefixRename(source.name);
    if (qualifierFix) return qualifierFix;
  }
  return kebabCaseRename(source.name);
}

export const featureSourceFilenameRule = defineRule({
  name: "feature-source-filename",
  kind: "problem",
  messages: {
    filename: {
      what: "`{{name}}` is not `<subject>.<artifact>.ts` in lower kebab case.",
      fix: "{{instruction}}",
    },
  },
  create(context, file) {
    const source = file.strictSource;
    if (!source) return {};
    if (!/\.[cm]?[jt]sx?$/.test(source.name)) return {};
    const valid =
      source.role === "process"
        ? isStrictProcessFilename(source.name)
        : isLowerKebabFilename(source.name);
    if (valid) return {};

    const suggested = suggestFilename(source);
    const instruction = suggested
      ? `Rename the file to \`${suggested}\` (a file rename, not an edit inside it).`
      : `Rename the file to \`<subject>.<artifact>.ts\` in lower kebab case, picking one artifact from ${ALLOWED_ARTIFACTS}.`;

    return {
      Program(node) {
        context.report({
          node,
          messageId: "filename",
          data: { artifacts: ALLOWED_ARTIFACTS, instruction, name: source.name },
        });
      },
    };
  },
});
