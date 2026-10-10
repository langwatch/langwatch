import { Alert } from "@chakra-ui/react";
import type { ReactNode } from "react";
import { explainHandledError } from "~/features/errors";

/**
 * The words the server answers with when a write reaches an aggregate
 * (ADR-144 decision 8), read from the code-keyed error registry so the
 * notice and the refusal always say the same thing.
 */
const READ_ONLY_COPY = explainHandledError({
  code: "aggregate_project_is_read_only",
  meta: {},
  httpStatus: 403,
  fault: "customer",
  tips: [],
  docsUrl: undefined,
  traceId: undefined,
  reasons: [],
});

/**
 * Shown in place of anything that would add data to an aggregate project: an
 * ingest key, a setup wait, a create button. The server refuses those writes
 * anyway; this says so before the reader tries.
 */
export function AggregateReadOnlyNotice() {
  return (
    <Alert.Root status="info" size="sm" variant="subtle" width="full">
      <Alert.Indicator />
      <Alert.Content>
        <Alert.Title>{READ_ONLY_COPY.title}</Alert.Title>
        {READ_ONLY_COPY.description && (
          <Alert.Description fontSize="sm">
            {READ_ONLY_COPY.description}
          </Alert.Description>
        )}
      </Alert.Content>
    </Alert.Root>
  );
}

/**
 * Renders the read-only notice in place of `children` on an aggregate
 * project, and `children` untouched everywhere else. A page whose body is
 * already a chain of states (loading, empty, sections) wraps the chain in
 * this rather than growing it by one more branch.
 */
export function AggregateReadOnlyGate({
  isAggregate,
  children,
}: {
  isAggregate: boolean;
  children: ReactNode;
}) {
  return isAggregate ? <AggregateReadOnlyNotice /> : <>{children}</>;
}
