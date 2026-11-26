import {
  isLangWatchQLTimeZoneParameterType,
  LWQL_DEFAULT_TIME_ZONE,
  LWQL_TIME_ZONE_PARAMETER,
} from "@langwatch/analytics-contract";

import type { LangWatchQLParameter } from "./langwatch-ql-validation-shape.rules.ts";

/** The zone a statement declaring the time zone is bound to: the surface's, else UTC. */
export function bindTimeZone({
  declared,
  timeZone,
}: {
  declared: readonly LangWatchQLParameter[];
  timeZone: string | undefined;
}): Readonly<Record<string, string>> {
  const declaresTimeZone = declared.some(
    (parameter) => parameter.name === LWQL_TIME_ZONE_PARAMETER,
  );

  return declaresTimeZone ? { [LWQL_TIME_ZONE_PARAMETER]: timeZone ?? LWQL_DEFAULT_TIME_ZONE } : {};
}

/** The declared time-zone name when its type is not `String`. */
export function mistypedTimeZoneParameter(declared: readonly LangWatchQLParameter[]): string[] {
  return declared
    .filter(
      (parameter) =>
        parameter.name === LWQL_TIME_ZONE_PARAMETER &&
        !isLangWatchQLTimeZoneParameterType(parameter.type),
    )
    .map((parameter) => parameter.name);
}
