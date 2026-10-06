/** What agent lends the studio through its declaration (ARCHITECTURE.md §3.4, rule 7). */

import { HttpConfigEditorToken, type HttpConfigEditorProps } from "@langwatch/agent-contract";
import { Lent } from "@langwatch/browser-host/lent";

/** Agent's HTTP configuration editor: endpoint, method, body, auth, headers and test. */
export function HttpConfigEditor(props: HttpConfigEditorProps) {
  return <Lent of={HttpConfigEditorToken} props={props} />;
}
