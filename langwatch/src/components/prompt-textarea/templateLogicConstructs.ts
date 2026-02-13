/**
 * Static definitions for Liquid template logic constructs
 * available in the autocomplete popup.
 */

export type TemplateLogicConstruct = {
  /** The keyword that triggers/identifies this construct (e.g., "if", "for") */
  keyword: string;
  /** Short description shown in the popup */
  description: string;
  /** The text inserted into the textarea when selected.
   *  A pipe character "|" marks where the cursor should be placed after insertion.
   *  If no pipe, cursor goes to the end.
   */
  insertionTemplate: string;
};

export const TEMPLATE_LOGIC_CONSTRUCTS: TemplateLogicConstruct[] = [
  {
    keyword: "if",
    description: "Conditional block",
    insertionTemplate: "{% if | %}{% endif %}",
  },
  {
    keyword: "for",
    description: "Loop over a collection",
    insertionTemplate: "{% for | %}{% endfor %}",
  },
  {
    keyword: "assign",
    description: "Assign a value to a variable",
    insertionTemplate: "{% assign | %}",
  },
  {
    keyword: "unless",
    description: "Negative conditional block",
    insertionTemplate: "{% unless | %}{% endunless %}",
  },
  {
    keyword: "elsif",
    description: "Additional condition in an if block",
    insertionTemplate: "{% elsif | %}",
  },
  {
    keyword: "else",
    description: "Fallback branch in an if block",
    insertionTemplate: "{% else %}",
  },
  {
    keyword: "comment",
    description: "Comment block (not rendered)",
    insertionTemplate: "{% comment %}{% endcomment %}",
  },
];

/** URL to the Liquid template syntax documentation */
export const TEMPLATE_SYNTAX_DOCS_URL =
  "https://docs.langwatch.ai/prompts/template-syntax";
