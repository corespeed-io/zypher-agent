/**
 * ACP (Agent Client Protocol) Module
 *
 * Provides ACP protocol support for Zypher Agent, enabling integration
 * with ACP-compatible clients like Zed Editor.
 *
 * Uses the official @agentclientprotocol/sdk for protocol handling.
 *
 * @module
 */

export { type ACPServer, acpStdioServer } from "./server.ts";
export type { AgentFactory } from "./adapter.ts";
