import { defineRule } from "../define-rule.mjs";

export const serviceMemberSpacingRule = defineRule({
  name: "service-member-spacing",
  kind: "layout",
  fixable: "whitespace",
  applies: (file) => file.isServiceModule,
  messages: {
    memberSpacing: {
      what: "Consecutive service methods, constructors, and accessors need one blank line between them.",
      fix: "Add a blank line.",
    },
  },
  create(context) {
    const source = context.sourceCode.text;
    const newline = source.includes("\r\n") ? "\r\n" : "\n";

    return {
      ClassBody(node) {
        const methods = node.body.filter(
          (member) => member.type === "MethodDefinition" && member.range,
        );
        for (let index = 1; index < methods.length; index += 1) {
          const previous = methods[index - 1];
          const member = methods[index];
          if (!previous?.range || !member?.range) continue;
          const between = source.slice(previous.range[1], member.range[0]);
          if (/\r?\n[ \t]*\r?\n/.test(between)) continue;
          context.report({
            node: member,
            messageId: "memberSpacing",
            fix(fixer) {
              return fixer.insertTextAfterRange(previous.range, newline);
            },
          });
        }
      },
    };
  },
});
