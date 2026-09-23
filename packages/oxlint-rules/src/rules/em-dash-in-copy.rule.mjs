import { defineRule } from "../define-rule.mjs";

// dev/docs/best_practices/copywriting.md bans the em dash from anything a
// customer reads - the most recognisable AI writing tic. Three narrow
// visitors cover where copy lives: JSX text, a string literal, and each
// template quasi, rather than walking every node. NO-FIX: the right
// replacement is an editorial call an unattended fixer cannot make safely.

const EM_DASH = "—";
// A bare "—" placeholder (an empty table cell) has no word character on
// either side and never matches; a run of digits or punctuation around a
// dash (an id, a range) matches this but fails the letter check below.
const EM_DASH_NEAR_WORD = /\w[^—\n]*—|—[^—\n]*\w/;
const HAS_LETTER = /[A-Za-z]/;
const CUSTOMER_FACING_TSX = /^(?:apps\/ui\/src|(?:enterprise\/)?modules\/[^/]+\/browser)\/.*\.tsx$/;
const EXCERPT_RADIUS = 20;

function isCustomerFacingTsx(file) {
  return file.isProduction && CUSTOMER_FACING_TSX.test(file.workspacePath);
}

/** Whether `text` is customer copy carrying a real em dash, not an id or a lone placeholder. */
function hasEmDashInProse(text) {
  if (!text || !text.includes(EM_DASH)) return false;
  if (!EM_DASH_NEAR_WORD.test(text)) return false;
  return HAS_LETTER.test(text);
}

/** A 40-char, whitespace-collapsed window around the first em dash in `text`. */
function excerptAround(text) {
  const index = text.indexOf(EM_DASH);
  const start = Math.max(0, index - EXCERPT_RADIUS);
  const end = Math.min(text.length, index + EXCERPT_RADIUS);
  return text.slice(start, end).replace(/\s+/g, " ").trim();
}

export const emDashInCopyRule = defineRule({
  name: "em-dash-in-copy",
  kind: "problem",
  applies: isCustomerFacingTsx,
  messages: {
    emDashInCopy: {
      what: 'This user-facing text contains an em dash: "{{excerpt}}".',
      why: "The copy guidelines ban em dashes in customer-facing prose.",
      fix: "Replace the em dash with a comma, a colon, or parentheses.",
    },
  },
  create(context, _file) {
    function check(node, text) {
      if (!hasEmDashInProse(text)) return;
      context.report({ node, messageId: "emDashInCopy", data: { excerpt: excerptAround(text) } });
    }

    return {
      JSXText(node) {
        check(node, node.value);
      },
      Literal(node) {
        if (typeof node.value !== "string") return;
        check(node, node.value);
      },
      TemplateLiteral(node) {
        for (const quasi of node.quasis) {
          const text = quasi.value.cooked ?? quasi.value.raw;
          if (text != null) check(quasi, text);
        }
      },
    };
  },
});
