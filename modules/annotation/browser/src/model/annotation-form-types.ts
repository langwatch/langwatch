import type {
  AnnotationScoreDataType,
  PopoverAnnotationFormInput,
} from "@langwatch/annotation-contract";
import type { ReactNode } from "react";

export interface AnnotationScoreOption {
  label: string;
  value: number | string;
}

export interface ScoreChipProps {
  name: string;
  description?: string | null;
  dataType: AnnotationScoreDataType;
  options: AnnotationScoreOption[];
  value: string | string[] | undefined;
  reason: string;
  onChange: (value: string | string[], reason?: string) => void;
}

export interface AnnotationPopoverRenderProps extends PopoverAnnotationFormInput {
  trigger: ReactNode;
  triggerTooltip?: string;
  thread?: ReactNode;
}
