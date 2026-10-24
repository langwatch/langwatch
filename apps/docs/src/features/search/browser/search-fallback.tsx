import { Component } from "react";
import type { ReactNode } from "react";

/** Keeps the dialog usable when rendering results fails: a message instead of an empty box. */
export class SearchFallback extends Component<{ children: ReactNode }, { failed: boolean }> {
  override state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  override render() {
    if (!this.state.failed) return this.props.children;
    return (
      <p role="alert" className="docs-search-failed" style={{ margin: 0, padding: "24px" }}>
        Search stopped working on this page. Reload the page to search again, or browse the sections
        in the sidebar.
      </p>
    );
  }
}
