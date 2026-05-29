import { Users } from "lucide-react";
import { AddParticipants } from "~/components/traces/AddParticipants";
import type {
  ClientDef,
  ConfigFormProps,
  SavedTriggerRow,
  SummaryIdentity,
} from "../../types";
import type { AnnotationQueueActionParams } from "./shared";

export interface AnnotationQueueSlice {
  annotators: { id: string; name: string }[];
}

function initialSlice(): AnnotationQueueSlice {
  return { annotators: [] };
}

function isComplete(slice: AnnotationQueueSlice): boolean {
  return slice.annotators.length > 0;
}

function summary(slice: AnnotationQueueSlice, identity: SummaryIdentity): string {
  const name = identity.name || "(unnamed)";
  const count = slice.annotators.length;
  return `${name} → ${count} annotator${count === 1 ? "" : "s"}`;
}

function fromTriggerRow(row: SavedTriggerRow): AnnotationQueueSlice {
  const params = (row.actionParams ?? {}) as Partial<AnnotationQueueActionParams>;
  return {
    annotators: Array.isArray(params.annotators) ? params.annotators : [],
  };
}

function toActionParams(slice: AnnotationQueueSlice): AnnotationQueueActionParams {
  return { annotators: slice.annotators };
}

function AnnotationQueueConfigForm({
  slice,
  onChange,
}: ConfigFormProps<AnnotationQueueSlice>) {
  return (
    <AddParticipants
      annotators={slice.annotators}
      setAnnotators={(value) =>
        onChange({
          ...slice,
          annotators:
            typeof value === "function"
              ? (value as (
                  prev: { id: string; name: string }[],
                ) => { id: string; name: string }[])(slice.annotators)
              : value,
        })
      }
      queueDrawerOpen={{ open: false, onOpen: () => {}, onClose: () => {} }}
      isTrigger={true}
    />
  );
}

const client: ClientDef<AnnotationQueueSlice> = {
  Icon: Users,
  initialSlice,
  isComplete,
  summary,
  fromTriggerRow,
  toActionParams,
  ConfigForm: AnnotationQueueConfigForm,
};

export default client;
