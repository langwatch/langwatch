import { readFileSync } from "node:fs";
import { execSync } from "node:child_process";
import ts from "typescript";
const base = JSON.parse(readFileSync("packages/architecture-lint/src/service-quality-baseline.json","utf8"));
const byFile = new Map(base.services.map(s=>[s.file,s]));
const D={moduleLines:500,methodLines:80,statements:24,complexity:24,lineLength:160};
const KINDS=new Set([ts.SyntaxKind.MethodDeclaration,ts.SyntaxKind.Constructor,ts.SyntaxKind.GetAccessor,ts.SyntaxKind.SetAccessor,ts.SyntaxKind.FunctionDeclaration,ts.SyntaxKind.FunctionExpression,ts.SyntaxKind.ArrowFunction]);
const CF=new Set([ts.SyntaxKind.IfStatement,ts.SyntaxKind.ConditionalExpression,ts.SyntaxKind.ForStatement,ts.SyntaxKind.ForInStatement,ts.SyntaxKind.ForOfStatement,ts.SyntaxKind.WhileStatement,ts.SyntaxKind.DoStatement,ts.SyntaxKind.CatchClause,ts.SyntaxKind.CaseClause]);
const SC=new Set([ts.SyntaxKind.AmpersandAmpersandToken,ts.SyntaxKind.BarBarToken,ts.SyntaxKind.QuestionQuestionToken]);
function cx(node){let c=1;const v=(n)=>{if(KINDS.has(n.kind))return;const a=CF.has(n.kind);const b=ts.isBinaryExpression(n)&&SC.has(n.operatorToken.kind);if(a||b)c++;ts.forEachChild(n,v);};ts.forEachChild(node,v);return c;}
function q(path){
  const src=readFileSync(path,"utf8");
  const file=ts.createSourceFile(path,src,ts.ScriptTarget.Latest,true);
  const r={moduleLines:src.split("\n").length,methodLines:0,statements:0,complexity:0,lineLength:Math.max(...src.split("\n").map(l=>l.length),0)};
  const visit=(n)=>{ if(KINDS.has(n.kind)&&n.body&&ts.isBlock(n.body)){
    const s=file.getLineAndCharacterOfPosition(n.body.getStart(file)).line;
    const e=file.getLineAndCharacterOfPosition(n.body.end).line;
    r.methodLines=Math.max(r.methodLines,e-s+1); r.statements=Math.max(r.statements,n.body.statements.length); r.complexity=Math.max(r.complexity,cx(n.body));
  } ts.forEachChild(n,visit); };
  visit(file); return r;
}
const dirs = process.argv.slice(2);
let n=0;
for (const d of dirs) {
  const files = execSync(`find ${d} -path '*/server/src/services/*.service.ts'`,{encoding:"utf8"}).trim().split("\n").filter(Boolean);
  for (const f of files) {
    const c = byFile.get(f) ?? D;
    const v = q(f);
    const over = Object.keys(D).filter(k=>v[k]>c[k]);
    if (over.length) { n++; console.log(`${f}\n  ${over.map(k=>`${k} ${v[k]}/${c[k]}`).join(", ")}`); }
  }
}
console.log("violations:", n);
