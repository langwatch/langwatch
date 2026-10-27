/** The example's own text, so the docs show exactly the file that renders. */
const files = import.meta.glob("./settings-form.example.tsx", {
  query: "?raw",
  import: "default",
  eager: true,
});

export const settingsFormSource: string = Object.values(files).map(String).join("");
