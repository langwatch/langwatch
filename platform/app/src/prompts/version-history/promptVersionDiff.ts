/**
 * What changed between two versions of a prompt.
 *
 * The version history lists versions newest-first, so a version's predecessor
 * is the next entry in that list. Comparing the two answers the question the
 * list otherwise cannot: "what did this version actually change?".
 *
 * Deliberately free of React and of the server types — it reads the handful of
 * fields the history query already carries, so it can be exercised directly
 * and reused by any surface that lists prompt versions.
 */

export type PromptDiffMessage = {
  role: string;
  content: string;
};

/** The subset of a prompt version this comparison reads. */
export type PromptVersionSnapshot = {
  messages?: PromptDiffMessage[] | null;
  model?: string | null;
  temperature?: number | null;
  maxTokens?: number | null;
  inputs?: { identifier: string; type: string }[] | null;
  outputs?: { identifier: string; type: string }[] | null;
};

export type PromptVersionChangeStatus = "added" | "removed" | "changed";

export type PromptVersionChange = {
  /** Stable key for rendering, unique within one comparison. */
  key: string;
  /** What the reader sees above the change, e.g. "System prompt". */
  label: string;
  status: PromptVersionChangeStatus;
  /**
   * "text" is prose worth reading word by word; "value" is a single setting
   * that reads better as before to after.
   */
  kind: "text" | "value";
  before: string;
  after: string;
};

const ROLE_LABELS: Record<string, string> = {
  system: "System",
  user: "User",
  assistant: "Assistant",
  tool: "Tool",
};

const roleLabel = (role: string) =>
  ROLE_LABELS[role] ?? role.charAt(0).toUpperCase() + role.slice(1);

/**
 * Names each message the way a reader would refer to it. The first system
 * message is the prompt itself (the service hoists `prompt` into position 0),
 * so it is named for what it is rather than counted as a message.
 */
function messageLabels(messages: PromptDiffMessage[]): string[] {
  const countByRole = new Map<string, number>();

  return messages.map((message, index) => {
    if (index === 0 && message.role === "system") {
      return "System prompt";
    }
    const base = `${roleLabel(message.role)} message`;
    const count = (countByRole.get(base) ?? 0) + 1;
    countByRole.set(base, count);
    return count === 1 ? base : `${base} ${count}`;
  });
}

const formatFields = (
  fields: { identifier: string; type: string }[] | null | undefined,
) =>
  (fields ?? [])
    .map((field) => `${field.identifier} (${field.type})`)
    .join(", ");

const formatNumber = (value: number | null | undefined) =>
  value === null || value === undefined ? "" : String(value);

function compareValue({
  key,
  label,
  before,
  after,
}: {
  key: string;
  label: string;
  before: string;
  after: string;
}): PromptVersionChange | null {
  if (before === after) return null;
  return {
    key,
    label,
    kind: "value",
    status: before === "" ? "added" : after === "" ? "removed" : "changed",
    before,
    after,
  };
}

/**
 * The differences between the message that sat at one position before and the
 * message that sits there now. Either side may be absent, which is how an
 * appended or dropped message reads.
 */
function compareMessagePair({
  index,
  label,
  previousLabel,
  previous,
  current,
}: {
  index: number;
  label: string;
  previousLabel: string;
  previous?: PromptDiffMessage;
  current?: PromptDiffMessage;
}): PromptVersionChange[] {
  if (!previous && current) {
    return [
      {
        key: `message-${index}`,
        label,
        kind: "text",
        status: "added",
        before: "",
        after: current.content,
      },
    ];
  }

  if (previous && !current) {
    return [
      {
        key: `message-${index}`,
        label: previousLabel,
        kind: "text",
        status: "removed",
        before: previous.content,
        after: "",
      },
    ];
  }

  if (!previous || !current) return [];

  const changes: PromptVersionChange[] = [];

  if (previous.role !== current.role) {
    changes.push({
      key: `message-${index}-role`,
      label: `${label} role`,
      kind: "value",
      status: "changed",
      before: roleLabel(previous.role),
      after: roleLabel(current.role),
    });
  }

  if (previous.content !== current.content) {
    changes.push({
      key: `message-${index}`,
      label,
      kind: "text",
      status: "changed",
      before: previous.content,
      after: current.content,
    });
  }

  return changes;
}

function compareMessages({
  before,
  after,
}: {
  before: PromptDiffMessage[];
  after: PromptDiffMessage[];
}): PromptVersionChange[] {
  const beforeLabels = messageLabels(before);
  const afterLabels = messageLabels(after);
  const changes: PromptVersionChange[] = [];

  for (let index = 0; index < Math.max(before.length, after.length); index++) {
    const previousLabel = beforeLabels[index] ?? "Message";
    changes.push(
      ...compareMessagePair({
        index,
        label: afterLabels[index] ?? previousLabel,
        previousLabel,
        previous: before[index],
        current: after[index],
      }),
    );
  }

  return changes;
}

/**
 * Every difference between `previous` and `version`, in reading order: the
 * messages first, then the settings that shape the call.
 */
export function diffPromptVersions({
  previous,
  version,
}: {
  previous: PromptVersionSnapshot;
  version: PromptVersionSnapshot;
}): PromptVersionChange[] {
  const changes = compareMessages({
    before: previous.messages ?? [],
    after: version.messages ?? [],
  });

  const settings = [
    compareValue({
      key: "model",
      label: "Model",
      before: previous.model ?? "",
      after: version.model ?? "",
    }),
    compareValue({
      key: "temperature",
      label: "Temperature",
      before: formatNumber(previous.temperature),
      after: formatNumber(version.temperature),
    }),
    compareValue({
      key: "maxTokens",
      label: "Maximum tokens",
      before: formatNumber(previous.maxTokens),
      after: formatNumber(version.maxTokens),
    }),
    compareValue({
      key: "inputs",
      label: "Inputs",
      before: formatFields(previous.inputs),
      after: formatFields(version.inputs),
    }),
    compareValue({
      key: "outputs",
      label: "Outputs",
      before: formatFields(previous.outputs),
      after: formatFields(version.outputs),
    }),
  ];

  for (const change of settings) {
    if (change) changes.push(change);
  }

  return changes;
}
