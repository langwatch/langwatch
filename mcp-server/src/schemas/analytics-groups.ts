export interface GroupByInfo {
  name: string;
  label: string;
  description: string;
}

export const analyticsGroups: GroupByInfo[] = [
  {
    name: "topics.topics",
    label: "Topic",
    description: "Group by topic classification",
  },
  {
    name: "metadata.user_id",
    label: "User",
    description: "Group by user ID",
  },
  {
    name: "metadata.thread_id",
    label: "Thread",
    description: "Group by conversation thread",
  },
  {
    name: "metadata.customer_id",
    label: "Customer ID",
    description: "Group by customer/organization",
  },
  {
    name: "metadata.labels",
    label: "Label",
    description: "Group by custom labels",
  },
  {
    name: "metadata.model",
    label: "Model",
    description: "Group by LLM model name",
  },
  {
    name: "metadata.span_type",
    label: "Span Type",
    description: "Group by span type (llm, tool, agent, etc.)",
  },
  {
    name: "sentiment.input_sentiment",
    label: "Input Sentiment",
    description: "Group by detected input sentiment (positive, negative, neutral)",
  },
  {
    name: "sentiment.thumbs_up_down",
    label: "Thumbs Up/Down",
    description: "Group by user feedback (positive, negative, neutral)",
  },
  {
    name: "events.event_type",
    label: "Event Type",
    description: "Group by event type",
  },
  {
    name: "evaluations.evaluation_passed",
    label: "Evaluation Passed",
    description: "Group by evaluation pass/fail status",
  },
  {
    name: "evaluations.evaluation_label",
    label: "Evaluation Label",
    description: "Group by evaluation label result",
  },
  {
    name: "evaluations.evaluation_processing_state",
    label: "Evaluation Processing State",
    description: "Group by evaluation processing state",
  },
  {
    name: "error.has_error",
    label: "Contains Error",
    description: "Group by whether the trace contains an error",
  },
];
