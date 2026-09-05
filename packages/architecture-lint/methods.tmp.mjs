import { readFileSync } from "node:fs";
import ts from "typescript";
const KINDS=new Set([ts.SyntaxKind.MethodDeclaration,ts.SyntaxKind.Constructor,ts.SyntaxKind.GetAccessor,ts.SyntaxKind.SetAccessor,ts.SyntaxKind.FunctionDeclaration,ts.SyntaxKind.FunctionExpression,ts.SyntaxKind.ArrowFunction]);
const CF=new Set([ts.SyntaxKind.IfStatement,ts.SyntaxKind.ConditionalExpression,ts.SyntaxKind.ForStatement,ts.SyntaxKind.ForInStatement,ts.SyntaxKind.ForOfStatement,ts.SyntaxKind.WhileStatement,ts.SyntaxKind.DoStatement,ts.SyntaxKind.CatchClause,ts.SyntaxKind.CaseClause]);
const SC=new Set([ts.SyntaxKind.AmpersandAmpersandToken,ts.SyntaxKind.BarBarToken,ts.SyntaxKind.QuestionQuestionToken]);
function cx(node){let c=1;const v=(n)=>{if(KINDS.has(n.kind))return;const a=CF.has(n.kind);const b=ts.isBinaryExpression(n)&&SC.has(n.operatorToken.kind);if(a||b)c++;ts.forEachChild(n,v);};ts.forEachChild(node,v);return c;}
for(const f of process.argv.slice(2)){
  const src=readFileSync(f,"utf8");
  const file=ts.createSourceFile(f,src,ts.ScriptTarget.Latest,true);
  const out=[];
  const visit=(n)=>{
    if(KINDS.has(n.kind)&&n.body&&ts.isBlock(n.body)){
      const s=file.getLineAndCharacterOfPosition(n.body.getStart(file)).line;
      const e=file.getLineAndCharacterOfPosition(n.body.end).line;
      const name=n.name?n.name.getText(file):(ts.isConstructorDeclaration(n)?"constructor":"<anon>");
      out.push({name,lines:e-s+1,stmts:n.body.statements.length,cx:cx(n.body),at:s+1});
    }
    ts.forEachChild(n,visit);
  };
  visit(file);
  out.sort((a,b)=>b.lines-a.lines);
  console.log("##",f);
  for(const m of out.slice(0,6)) console.log(`  ${m.lines}L stmts=${m.stmts} cx=${m.cx} @${m.at} ${m.name}`);
}
