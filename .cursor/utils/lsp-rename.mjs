#!/usr/bin/env node
/**
 * LSP Rename Utility
 *
 * Uses TypeScript Language Server to perform intelligent renames.
 * Supports both symbol renaming and file renaming.
 *
 * Usage:
 *   Symbol rename:
 *     node lsp-rename.mjs symbol <file> <line> <column> <newName>
 *     Example: node lsp-rename.mjs symbol src/utils.ts 10 5 newFunctionName
 *
 *   File rename:
 *     node lsp-rename.mjs file <oldPath> <newPath>
 *     Example: node lsp-rename.mjs file src/old-name.ts src/new-name.ts
 */

import { spawn } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';

const SERVER_PATH = '/Users/rchaves/Library/pnpm/typescript-language-server';
const WORKSPACE_PATH = '/Users/rchaves/Projects/langwatch-saas/langwatch/langwatch';
const TIMEOUT_MS = 60000;
const PROCESS_DELAY_MS = 3000;

class LSPClient {
  constructor(workspacePath) {
    this.workspacePath = workspacePath;
    this.messageId = 0;
    this.buffer = '';
    this.pendingRequests = new Map();
    this.server = null;
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
          },
          workspace: {
            workspaceFolders: true,
            fileOperations: {
              willRename: true,
            },
          },
        },
        initializationOptions: {},
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
    const fileContent = fs.readFileSync(filePath, 'utf-8');
    this.sendNotification('textDocument/didOpen', {
      textDocument: {
        uri: `file://${filePath}`,
        languageId: this.getLanguageId(filePath),
        version: 1,
        text: fileContent,
      },
    });
    // Wait for server to process
    await new Promise(r => setTimeout(r, PROCESS_DELAY_MS));
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

  async renameSymbol(filePath, line, character, newName) {
    console.log(`Renaming symbol at ${filePath}:${line + 1}:${character + 1} to "${newName}"...`);

    await this.openDocument(filePath);

    // First, prepare rename to verify position
    const prepareResult = await this.sendRequest('textDocument/prepareRename', {
      textDocument: { uri: `file://${filePath}` },
      position: { line, character },
    });

    if (!prepareResult) {
      throw new Error('Cannot rename at this position');
    }

    console.log(`Found symbol from ${prepareResult.start.character} to ${prepareResult.end.character}`);

    // Perform the rename
    const result = await this.sendRequest('textDocument/rename', {
      textDocument: { uri: `file://${filePath}` },
      position: { line, character },
      newName,
    });

    return result;
  }

  async renameFile(oldPath, newPath) {
    console.log(`Renaming file from ${oldPath} to ${newPath}...`);

    // Open the document first so the server knows about it
    await this.openDocument(oldPath);

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
  Symbol rename:
    node lsp-rename.mjs symbol <file> <line> <column> <newName>
    Example: node lsp-rename.mjs symbol src/utils.ts 10 5 newFunctionName

    Note: line and column are 1-indexed (like in editors)

  File rename:
    node lsp-rename.mjs file <oldPath> <newPath>
    Example: node lsp-rename.mjs file src/old-name.ts src/new-name.ts

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

    } else {
      printUsage();
      process.exit(1);
    }

    if (command === 'symbol' && result) {
      const totalEdits = applyWorkspaceEdit(result);
      console.log(`\nTotal: ${totalEdits} edit(s) applied.`);
    }

    console.log('Done!');

  } catch (error) {
    console.error('Error:', error.message);
    process.exit(1);
  } finally {
    clearTimeout(timeout);
    client.stop();
  }
};

main();

