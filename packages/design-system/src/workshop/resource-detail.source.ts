/** The example's own text, so the docs show exactly the file that renders. */
const files = import.meta.glob("./resource-detail.example.tsx", {
  query: "?raw",
  import: "default",
  eager: true,
});

export const resourceDetailSource: string = Object.values(files).map(String).join("");
