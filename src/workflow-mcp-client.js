import { spawn } from "node:child_process";
import { pathToFileURL } from "node:url";

const MCP_PROTOCOL_VERSION = "2024-11-05";

function encodeMessage(message) {
  const json = JSON.stringify(message);
  const bytes = Buffer.byteLength(json, "utf8");
  return `Content-Length: ${bytes}\r\n\r\n${json}`;
}

function createResponseWaiter() {
  const pending = new Map();
  let nextId = 1;
  let closed = false;
  let buffer = Buffer.alloc(0);

  function resolvePending(id, value) {
    const entry = pending.get(id);
    if (!entry) return;
    pending.delete(id);
    clearTimeout(entry.timeout);
    entry.resolve(value);
  }

  function rejectAll(error) {
    if (closed) return;
    closed = true;
    for (const entry of pending.values()) {
      clearTimeout(entry.timeout);
      entry.reject(error);
    }
    pending.clear();
  }

  function parseMessages(chunk, onMessage) {
    buffer = Buffer.concat([buffer, chunk]);

    while (true) {
      const headerEnd = buffer.indexOf("\r\n\r\n");
      if (headerEnd === -1) return;

      const headerText = buffer.slice(0, headerEnd).toString("utf8");
      const lengthMatch = headerText.match(/Content-Length:\s*(\d+)/i);
      if (!lengthMatch) {
        throw new Error(`Invalid MCP header: ${headerText}`);
      }

      const bodyStart = headerEnd + 4;
      const bodyLength = Number(lengthMatch[1]);
      const bodyEnd = bodyStart + bodyLength;
      if (buffer.length < bodyEnd) return;

      const bodyText = buffer.slice(bodyStart, bodyEnd).toString("utf8");
      buffer = buffer.slice(bodyEnd);

      try {
        onMessage(JSON.parse(bodyText));
      } catch (err) {
        throw new Error(`Failed to parse MCP message body: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
  }

  function waitForResponse(id, timeoutMs) {
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        pending.delete(id);
        reject(new Error(`Timed out waiting for MCP response to ${id}`));
      }, timeoutMs);
      pending.set(id, { resolve, reject, timeout });
    });
  }

  async function request(proc, method, params, timeoutMs) {
    if (closed) throw new Error("MCP client is closed");
    const id = nextId++;
    const responsePromise = waitForResponse(id, timeoutMs);
    proc.stdin.write(encodeMessage({ jsonrpc: "2.0", id, method, params }));
    const response = await responsePromise;
    if (response?.error) {
      throw new Error(response.error.message ?? `MCP request ${method} failed`);
    }
    return response?.result;
  }

  return {
    parseMessages,
    request,
    resolvePending,
    rejectAll,
  };
}

export async function callWorkflowTool({
  projectRoot,
  toolName,
  toolArgs,
  timeoutMs = 30_000,
}) {
  const proc = spawn("gsd", ["--mode", "mcp"], {
    cwd: projectRoot,
    env: { ...process.env },
    stdio: ["pipe", "pipe", "pipe"],
  });

  const waiter = createResponseWaiter();
  let stderr = "";

  proc.stdout.on("data", (chunk) => {
    try {
      waiter.parseMessages(chunk, (message) => {
        if (message && typeof message === "object" && "id" in message) {
          waiter.resolvePending(Number(message.id), message);
        }
      });
    } catch (err) {
      waiter.rejectAll(err instanceof Error ? err : new Error(String(err)));
    }
  });

  proc.stderr.on("data", (chunk) => {
    stderr += chunk.toString("utf8");
  });

  proc.on("error", (err) => {
    waiter.rejectAll(err);
  });

  proc.on("close", (code) => {
    if (code !== 0) {
      waiter.rejectAll(new Error(`MCP server exited with code ${code ?? "null"}${stderr.trim() ? `: ${stderr.trim()}` : ""}`));
    }
  });

  try {
    await waiter.request(proc, "initialize", {
      protocolVersion: MCP_PROTOCOL_VERSION,
      clientInfo: { name: "gsd-split-check", version: "0.1.0" },
      capabilities: {},
      rootUri: pathToFileURL(projectRoot).href,
    }, timeoutMs);

    proc.stdin.write(encodeMessage({ jsonrpc: "2.0", method: "initialized", params: {} }));

    const result = await waiter.request(proc, "tools/call", {
      name: toolName,
      arguments: toolArgs,
    }, timeoutMs);

    return result;
  } finally {
    try {
      proc.kill("SIGTERM");
    } catch {
      // best effort
    }
  }
}
