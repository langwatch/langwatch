export function MetadataFootnote() {
  return (
    <p>
      It's optional but highly recommended to pass the <code>user_id</code> on
      the metadata if you want to leverage user-specific analytics and the{" "}
      <code>thread_id</code> to group related traces together. To connect it to
      an event later on. Read more about those and other concepts{" "}
      <a
        href="https://docs.langwatch.ai/docs/concepts"
        target="_blank"
        style={{ textDecoration: "underline" }}
      >
        here
      </a>
      .
    </p>
  );
}
