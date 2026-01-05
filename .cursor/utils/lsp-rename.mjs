#!/usr/bin/env node
/**
 * LSP Rename Utility
 *
 * Uses TypeScript Language Server to perform intelligent renames.
 * Supports symbol renaming, file renaming, and combined renames.
 *
 * Usage:
 *   Symbol rename:
 *     node lsp-rename.mjs symbol <file> <line> <column> <newName>
 *     Example: node lsp-rename.mjs symbol src/utils.ts 10 5 newFunctionName
 *
 *   File rename:
 *     node lsp-rename.mjs file <oldPath> <newPath>
 *     Example: node lsp-rename.mjs file src/old-name.ts src/new-name.ts
 *
 *   Combined rename (symbol + file):
 *     node lsp-rename.mjs combined <file> <line> <column> <newSymbolName> <newFilePath>
 *     Example: node lsp-rename.mjs combined src/OldComponent.tsx 5 17 NewComponent src/NewComponent.tsx
 *     This renames the symbol first (updating all references), then renames the file.
 */

import { spawn } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { glob } from 'fs/promises';

const SERVER_PATH = '/Users/rchaves/Library/pnpm/typescript-language-server';
const WORKSPACE_PATH = '/Users/rchaves/Projects/langwatch-saas/langwatch/langwatch';
const TIMEOUT_MS = 120000;
const PROCESS_DELAY_MS = 1000;
const INDEX_DELAY_MS = 5000;

class LSPClient {
  constructor(workspacePath) {
    this.workspacePath = workspacePath;
    this.messageId = 0;
    this.buffer = '';
    this.pendingRequests = new Map();
    this.server = null;
    this.openedDocuments = new Set();
  }

  async start() {
    return new Promise((resolve, reject) => {
      this.server = spawn(SERVER_PATH, ['--stdio'], {
        cwd: this.workspacePath,
      });

      this.server.stdout.on('data', (data) => this.handleData(data));
      this.server.stderr.on('data', (data) => {
        // Suppress stderr unless debugging
        if (process.env.DEBUG) {
          console.error('[STDERR]', data.toString());
        }
      });

      this.server.on('error', reject);
      this.server.on('close', (code) => {
        if (code !== 0 && code !== null) {
          console.error(`Server exited with code ${code}`);
        }
      });

      // Initialize the server
      this.sendRequest('initialize', {
        processId: process.pid,
        rootUri: `file://${this.workspacePath}`,
        workspaceFolders: [{ uri: `file://${this.workspacePath}`, name: path.basename(this.workspacePath) }],
        capabilities: {
          textDocument: {
            rename: {
              dynamicRegistration: true,
              prepareSupport: true,
            },
            synchronization: {
              willSave: true,
              willSaveWaitUntil: true,
              didSave: true,
            },
            references: {
              dynamicRegistration: true,
            },
          },
          workspace: {
            workspaceFolders: true,
            fileOperations: {
              willRename: true,
            },
          },
        },
        initializationOptions: {
          preferences: {
            includePackageJsonAutoImports: 'auto',
          },
        },
      }).then((result) => {
        this.sendNotification('initialized', {});
        resolve(result);
      }).catch(reject);
    });
  }

  handleData(data) {
    this.buffer += data.toString();

    while (true) {
      const headerEnd = this.buffer.indexOf('\r\n\r\n');
      if (headerEnd === -1) break;

      const header = this.buffer.slice(0, headerEnd);
      const contentLengthMatch = header.match(/Content-Length: (\d+)/);
      if (!contentLengthMatch) break;

      const contentLength = parseInt(contentLengthMatch[1], 10);
      const messageStart = headerEnd + 4;
      const messageEnd = messageStart + contentLength;

      if (this.buffer.length < messageEnd) break;

      const messageStr = this.buffer.slice(messageStart, messageEnd);
      this.buffer = this.buffer.slice(messageEnd);

      try {
        const message = JSON.parse(messageStr);
        this.handleMessage(message);
      } catch (e) {
        console.error('Parse error:', e);
      }
    }
  }

  handleMessage(message) {
    // Handle notifications (no id)
    if (!message.id) {
      if (process.env.DEBUG) {
        console.log(`[NOTIFY] ${message.method}`);
      }
      return;
    }

    // Handle responses
    const pending = this.pendingRequests.get(message.id);
    if (pending) {
      this.pendingRequests.delete(message.id);
      if (message.error) {
        pending.reject(new Error(message.error.message));
      } else {
        pending.resolve(message.result);
      }
    }
  }

  sendRequest(method, params) {
    return new Promise((resolve, reject) => {
      const id = ++this.messageId;
      this.pendingRequests.set(id, { resolve, reject });

      const message = JSON.stringify({ jsonrpc: '2.0', id, method, params });
      const content = `Content-Length: ${Buffer.byteLength(message)}\r\n\r\n${message}`;

      if (process.env.DEBUG) {
        console.log(`[SEND ${id}] ${method}`);
      }

      this.server.stdin.write(content);
    });
  }

  sendNotification(method, params) {
    const message = JSON.stringify({ jsonrpc: '2.0', method, params });
    const content = `Content-Length: ${Buffer.byteLength(message)}\r\n\r\n${message}`;

    if (process.env.DEBUG) {
      console.log(`[NOTIFY] ${method}`);
    }

    this.server.stdin.write(content);
  }

  async openDocument(filePath) {
    if (this.openedDocuments.has(filePath)) {
      return;
    }

    const fileContent = fs.readFileSync(filePath, 'utf-8');
    this.sendNotification('textDocument/didOpen', {
      textDocument: {
        uri: `file://${filePath}`,
        languageId: this.getLanguageId(filePath),
        version: 1,
        text: fileContent,
      },
    });
    this.openedDocuments.add(filePath);
  }

  /**
   * Find all TypeScript/JavaScript files that might import from the target file
   * and open them so the LSP server can index references
   */
  async indexProjectReferences(targetFile) {
    console.log('Indexing project references...');

    const targetBasename = path.basename(targetFile, path.extname(targetFile));
    const extensions = ['ts', 'tsx', 'js', 'jsx', 'mts', 'mjs'];

    // Find files that might import from the target
    const filesToOpen = [];

    for (const ext of extensions) {
      try {
        const pattern = `**/*.${ext}`;
        for await (const file of glob(pattern, {
          cwd: this.workspacePath,
          ignore: ['**/node_modules/**', '**/dist/**', '**/.next/**', '**/coverage/**']
        })) {
          const fullPath = path.join(this.workspacePath, file);

          // Skip the target file itself
          if (fullPath === targetFile) continue;

          // Quick check if the file might import from target
          try {
            const content = fs.readFileSync(fullPath, 'utf-8');
            // Check if file might reference our target (by filename or export name)
            if (content.includes(targetBasename)) {
              filesToOpen.push(fullPath);
            }
          } catch (e) {
            // Skip files we can't read
          }
        }
      } catch (e) {
        if (process.env.DEBUG) {
          console.error(`Error globbing ${ext}:`, e.message);
        }
      }
    }

    // Always open the target file first
    await this.openDocument(targetFile);

    // Open files that might have references (batch for speed)
    const batchSize = 20;
    for (let i = 0; i < filesToOpen.length; i += batchSize) {
      const batch = filesToOpen.slice(i, i + batchSize);
      for (const file of batch) {
        await this.openDocument(file);
      }
      // Small delay between batches
      if (i + batchSize < filesToOpen.length) {
        await new Promise(r => setTimeout(r, 100));
      }
    }

    console.log(`Opened ${filesToOpen.length + 1} file(s) for indexing.`);

    // Wait for the server to process all documents
    console.log('Waiting for LSP server to index...');
    await new Promise(r => setTimeout(r, INDEX_DELAY_MS));
  }

  getLanguageId(filePath) {
    const ext = path.extname(filePath);
    const langMap = {
      '.ts': 'typescript',
      '.tsx': 'typescriptreact',
      '.js': 'javascript',
      '.jsx': 'javascriptreact',
      '.mjs': 'javascript',
      '.mts': 'typescript',
      '.cjs': 'javascript',
      '.cts': 'typescript',
    };
    return langMap[ext] || 'typescript';
  }

  async renameSymbol(filePath, line, character, newName, skipIndexing = false) {
    console.log(`Renaming symbol at ${filePath}:${line + 1}:${character + 1} to "${newName}"...`);

    // Index the project first to find all references
    if (!skipIndexing) {
      await this.indexProjectReferences(filePath);
    } else {
      await this.openDocument(filePath);
      await new Promise(r => setTimeout(r, PROCESS_DELAY_MS));
    }

    // First, prepare rename to verify position
    const prepareResult = await this.sendRequest('textDocument/prepareRename', {
      textDocument: { uri: `file://${filePath}` },
      position: { line, character },
    });

    if (!prepareResult) {
      throw new Error('Cannot rename at this position');
    }

    const range = prepareResult.range || prepareResult;
    console.log(`Found symbol: "${prepareResult.placeholder || 'unknown'}" at character ${range.start?.character ?? prepareResult.start?.character}`);

    // Perform the rename
    const result = await this.sendRequest('textDocument/rename', {
      textDocument: { uri: `file://${filePath}` },
      position: { line, character },
      newName,
    });

    return result;
  }

  async renameFile(oldPath, newPath, skipIndexing = false) {
    console.log(`Renaming file from ${oldPath} to ${newPath}...`);

    // Index the project first to find all import references
    if (!skipIndexing) {
      await this.indexProjectReferences(oldPath);
    } else {
      await this.openDocument(oldPath);
      await new Promise(r => setTimeout(r, PROCESS_DELAY_MS));
    }

    // Use workspace/willRenameFiles to get the edits needed
    const result = await this.sendRequest('workspace/willRenameFiles', {
      files: [
        {
          oldUri: `file://${oldPath}`,
          newUri: `file://${newPath}`,
        },
      ],
    });

    return result;
  }

  stop() {
    if (this.server) {
      this.server.kill();
    }
  }
}

const applyWorkspaceEdit = (workspaceEdit) => {
  if (!workspaceEdit) {
    console.log('No changes needed.');
    return 0;
  }

  let totalEdits = 0;

  // Handle changes (simple format)
  if (workspaceEdit.changes) {
    for (const [uri, edits] of Object.entries(workspaceEdit.changes)) {
      const filePath = uri.replace('file://', '');
      totalEdits += applyEditsToFile(filePath, edits);
    }
  }

  // Handle documentChanges (more complex format with create/rename/delete)
  if (workspaceEdit.documentChanges) {
    for (const change of workspaceEdit.documentChanges) {
      if (change.kind === 'rename') {
        const oldPath = change.oldUri.replace('file://', '');
        const newPath = change.newUri.replace('file://', '');
        console.log(`Renaming file: ${oldPath} -> ${newPath}`);

        // Ensure parent directory exists
        const newDir = path.dirname(newPath);
        if (!fs.existsSync(newDir)) {
          fs.mkdirSync(newDir, { recursive: true });
        }

        fs.renameSync(oldPath, newPath);
        totalEdits++;
      } else if (change.kind === 'create') {
        const filePath = change.uri.replace('file://', '');
        console.log(`Creating file: ${filePath}`);

        const dir = path.dirname(filePath);
        if (!fs.existsSync(dir)) {
          fs.mkdirSync(dir, { recursive: true });
        }

        fs.writeFileSync(filePath, '');
        totalEdits++;
      } else if (change.kind === 'delete') {
        const filePath = change.uri.replace('file://', '');
        console.log(`Deleting file: ${filePath}`);
        fs.unlinkSync(filePath);
        totalEdits++;
      } else if (change.textDocument && change.edits) {
        // TextDocumentEdit
        const filePath = change.textDocument.uri.replace('file://', '');
        totalEdits += applyEditsToFile(filePath, change.edits);
      }
    }
  }

  return totalEdits;
};

const applyEditsToFile = (filePath, edits) => {
  let content = fs.readFileSync(filePath, 'utf-8');
  const lines = content.split('\n');

  // Sort edits in reverse order to apply from bottom to top
  const sortedEdits = [...edits].sort((a, b) => {
    if (b.range.start.line !== a.range.start.line) {
      return b.range.start.line - a.range.start.line;
    }
    return b.range.start.character - a.range.start.character;
  });

  for (const edit of sortedEdits) {
    const { range, newText } = edit;

    if (range.start.line === range.end.line) {
      // Single line edit
      const line = lines[range.start.line];
      lines[range.start.line] =
        line.slice(0, range.start.character) +
        newText +
        line.slice(range.end.character);
    } else {
      // Multi-line edit
      const startLine = lines[range.start.line];
      const endLine = lines[range.end.line];
      const newContent = startLine.slice(0, range.start.character) +
        newText +
        endLine.slice(range.end.character);

      lines.splice(
        range.start.line,
        range.end.line - range.start.line + 1,
        ...newContent.split('\n')
      );
    }
  }

  fs.writeFileSync(filePath, lines.join('\n'));
  console.log(`Applied ${edits.length} edit(s) to ${filePath}`);
  return edits.length;
};

const printUsage = () => {
  console.log(`
LSP Rename Utility

Usage:
  Symbol rename (updates all references across the project):
    node lsp-rename.mjs symbol <file> <line> <column> <newName>
    Example: node lsp-rename.mjs symbol src/utils.ts 10 5 newFunctionName

    Note: line and column are 1-indexed (like in editors)

  File rename (updates import paths):
    node lsp-rename.mjs file <oldPath> <newPath>
    Example: node lsp-rename.mjs file src/old-name.ts src/new-name.ts

  Combined rename (symbol + file, recommended for component renames):
    node lsp-rename.mjs combined <file> <line> <column> <newSymbolName> <newFilePath>
    Example: node lsp-rename.mjs combined src/OldComponent.tsx 5 17 NewComponent src/NewComponent.tsx

    This performs both operations in sequence:
    1. Renames the symbol (updating all import names and usages)
    2. Renames the file (updating all import paths)

Environment:
  DEBUG=1  Enable debug logging
`);
};

const main = async () => {
  const args = process.argv.slice(2);

  if (args.length < 1) {
    printUsage();
    process.exit(1);
  }

  const command = args[0];
  const client = new LSPClient(WORKSPACE_PATH);

  // Set up timeout
  const timeout = setTimeout(() => {
    console.error('Timeout!');
    client.stop();
    process.exit(1);
  }, TIMEOUT_MS);

  try {
    await client.start();
    console.log('LSP server initialized.');

    let result;

    if (command === 'symbol') {
      if (args.length < 5) {
        printUsage();
        process.exit(1);
      }

      const filePath = path.resolve(args[1]);
      const line = parseInt(args[2], 10) - 1; // Convert to 0-indexed
      const character = parseInt(args[3], 10) - 1; // Convert to 0-indexed
      const newName = args[4];

      result = await client.renameSymbol(filePath, line, character, newName);

      if (result) {
        const totalEdits = applyWorkspaceEdit(result);
        console.log(`\nTotal: ${totalEdits} edit(s) applied.`);
      }

    } else if (command === 'file') {
      if (args.length < 3) {
        printUsage();
        process.exit(1);
      }

      const oldPath = path.resolve(args[1]);
      const newPath = path.resolve(args[2]);

      result = await client.renameFile(oldPath, newPath);

      // After getting the edits, actually rename the file
      if (result) {
        const totalEdits = applyWorkspaceEdit(result);
        console.log(`Applied ${totalEdits} edit(s) from LSP.`);
      }

      // Now physically rename the file
      console.log(`Moving file: ${oldPath} -> ${newPath}`);
      const newDir = path.dirname(newPath);
      if (!fs.existsSync(newDir)) {
        fs.mkdirSync(newDir, { recursive: true });
      }
      fs.renameSync(oldPath, newPath);

    } else if (command === 'combined') {
      if (args.length < 6) {
        printUsage();
        process.exit(1);
      }

      const filePath = path.resolve(args[1]);
      const line = parseInt(args[2], 10) - 1;
      const character = parseInt(args[3], 10) - 1;
      const newSymbolName = args[4];
      const newFilePath = path.resolve(args[5]);

      console.log('\n=== Step 1: Rename Symbol ===');
      const symbolResult = await client.renameSymbol(filePath, line, character, newSymbolName);

      if (symbolResult) {
        const symbolEdits = applyWorkspaceEdit(symbolResult);
        console.log(`Symbol rename: ${symbolEdits} edit(s) applied.`);
      }

      console.log('\n=== Step 2: Rename File ===');
      // Skip re-indexing since we already indexed
      const fileResult = await client.renameFile(filePath, newFilePath, true);

      if (fileResult) {
        const fileEdits = applyWorkspaceEdit(fileResult);
        console.log(`Import path updates: ${fileEdits} edit(s) applied.`);
      }

      // Now physically rename the file
      console.log(`Moving file: ${filePath} -> ${newFilePath}`);
      const newDir = path.dirname(newFilePath);
      if (!fs.existsSync(newDir)) {
        fs.mkdirSync(newDir, { recursive: true });
      }
      fs.renameSync(filePath, newFilePath);

    } else {
      printUsage();
      process.exit(1);
    }

    console.log('\nDone!');

  } catch (error) {
    console.error('Error:', error.message);
    if (process.env.DEBUG) {
      console.error(error.stack);
    }
    process.exit(1);
  } finally {
    clearTimeout(timeout);
    client.stop();
  }
};

main();
