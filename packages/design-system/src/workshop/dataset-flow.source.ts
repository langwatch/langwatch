/** The example's own text, so the docs show exactly the file that renders. */
const files = import.meta.glob("./dataset-flow.example.tsx", {
  query: "?raw",
  import: "default",
  eager: true,
});

export const datasetFlowSource: string = Object.values(files).map(String).join("");
