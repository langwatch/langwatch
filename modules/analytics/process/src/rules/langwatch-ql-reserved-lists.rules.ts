import {
  isLangWatchQLListParameter,
  isLangWatchQLListParameterType,
  LWQL_SOURCES_PARAMETER,
} from "@langwatch/analytics-contract";

import type { LangWatchQLParameter } from "./langwatch-ql-validation-shape.rules.ts";

/** The declared list names whose type is not `Array(String)`. */
export function mistypedListParameters(declared: readonly LangWatchQLParameter[]): string[] {
  return declared
    .filter(
      (parameter) =>
        isLangWatchQLListParameter(parameter.name) &&
        !isLangWatchQLListParameterType(parameter.type),
    )
    .map((parameter) => parameter.name);
}

/**
 * What the two list names mean for a statement: whether it declares the sources list, and the
 * values to bind for each list it declares and the surface has a value for.
 */
export function bindListParameters({
  declared,
  lists,
}: {
  declared: readonly LangWatchQLParameter[];
  lists: Readonly<{ sources: readonly string[]; projects: readonly string[] }> | undefined;
}): { followsSources: boolean; bound: Readonly<Record<string, readonly string[]>> } {
  const declaredLists = declared.filter((parameter) => isLangWatchQLListParameter(parameter.name));
  const entries = declaredLists.flatMap((parameter) => {
    const value = parameter.name === LWQL_SOURCES_PARAMETER ? lists?.sources : lists?.projects;
    return value === undefined ? [] : [[parameter.name, value] as const];
  });

  return {
    followsSources: declaredLists.some((parameter) => parameter.name === LWQL_SOURCES_PARAMETER),
    bound: Object.fromEntries(entries),
  };
}
